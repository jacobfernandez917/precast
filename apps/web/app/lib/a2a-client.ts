/**
 * Server-only client for invoking Mastra agents over the A2A protocol
 * (JSON-RPC 2.0). AgentBase is **optional** — the transport is chosen by the
 * `ENABLE_AGENTBASE` env flag:
 *
 *   ENABLE_AGENTBASE=1   → proxy through the AgentBase A2A proxy:
 *                          POST ${AGENTBASE_URL}/a2a  (auth: Bearer AGENTBASE_TOKEN)
 *   otherwise (default)  → talk directly to the Mastra agent API over A2A:
 *                          POST ${MASTRA_INTERNAL_URL}/api/a2a/:agentId
 *                          (auth: Bearer AGENT_API_TOKEN — must match the
 *                          Mastra server's token; omitted when unset)
 *
 * All Next → Mastra traffic goes through this util (via the route handler) —
 * never call Mastra or AgentBase directly from client components.
 */

export type A2aTransport = 'agentbase' | 'direct';

/**
 * Normalized reply so callers and the UI don't depend on each transport's wire
 * format (AgentBase and direct Mastra A2A return different response shapes).
 */
export interface AgentReply {
  ok: boolean;
  /** Best-effort extracted assistant text (null if none, or on error). */
  text: string | null;
  /** Error message when the agent call failed. */
  error?: string;
  /** Which transport handled the call. */
  via: A2aTransport;
  /** The full underlying JSON-RPC response, for debugging. */
  raw: unknown;
}

interface CallOptions {
  sessionId?: string;
  skillId?: string;
  signal?: AbortSignal;
}

/** True when the AgentBase proxy transport is enabled. */
export function isAgentBaseEnabled(): boolean {
  return process.env.ENABLE_AGENTBASE === '1';
}

/**
 * Invoke a Mastra agent. Routes through AgentBase when `ENABLE_AGENTBASE=1`,
 * otherwise calls the Mastra A2A endpoint directly.
 */
export async function callAgent(
  agentId: string,
  text: string,
  options?: CallOptions,
): Promise<AgentReply> {
  return isAgentBaseEnabled()
    ? callViaAgentBase(agentId, text, options)
    : callDirect(agentId, text, options);
}

async function callViaAgentBase(
  agentId: string,
  text: string,
  options?: CallOptions,
): Promise<AgentReply> {
  const url = process.env.AGENTBASE_URL ?? 'https://agentbase.example.com';
  const token = process.env.AGENTBASE_TOKEN ?? '';

  // AgentBase's proxy resolves the target from params.agentId.
  const body = {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'tasks/send',
    params: {
      agentId,
      text,
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options?.skillId ? { skillId: options.skillId } : {}),
    },
  };

  const raw = await postJsonRpc(`${url}/a2a`, body, token, options?.signal);
  return normalize(raw, 'agentbase');
}

async function callDirect(
  agentId: string,
  text: string,
  options?: CallOptions,
): Promise<AgentReply> {
  const base = process.env.MASTRA_INTERNAL_URL ?? 'http://localhost:4111';
  const token = process.env.AGENT_API_TOKEN ?? '';

  // Mastra speaks A2A 0.3.0: `message/send` with a Message envelope. The target
  // agent is in the URL path; the bearer must match the server's AGENT_API_TOKEN.
  const body = {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        role: 'user',
        messageId: crypto.randomUUID(),
        parts: [{ kind: 'text', text }],
        ...(options?.sessionId ? { contextId: options.sessionId } : {}),
      },
    },
  };

  const raw = await postJsonRpc(
    `${base}/api/a2a/${encodeURIComponent(agentId)}`,
    body,
    token,
    options?.signal,
  );
  return normalize(raw, 'direct');
}

async function postJsonRpc(
  endpoint: string,
  body: unknown,
  bearer: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  return res.json();
}

// ── Response parsing ─────────────────────────────────────────────────────────

interface RpcPart {
  kind?: string;
  type?: string;
  text?: string;
}

interface RpcResult {
  kind?: string;
  parts?: RpcPart[];
  status?: { message?: { parts?: RpcPart[] } };
  artifacts?: Array<{ parts?: RpcPart[] }>;
  history?: Array<{ role?: string; parts?: RpcPart[] }>;
  // AgentBase's legacy shape: result.result.message.content[].text
  result?: { message?: { content?: RpcPart[] } };
}

interface RpcResponse {
  error?: { message?: string };
  result?: RpcResult;
}

function normalize(raw: unknown, via: A2aTransport): AgentReply {
  const r = (raw ?? null) as RpcResponse | null;
  if (r?.error) {
    return { ok: false, text: null, error: r.error.message ?? 'Agent error', via, raw };
  }
  return { ok: true, text: extractText(r?.result), via, raw };
}

function partsToText(parts?: RpcPart[]): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => (p?.kind === 'text' || p?.type === 'text') && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

/** Pull assistant text out of either AgentBase's shape or an A2A Message/Task. */
function extractText(result?: RpcResult): string | null {
  if (!result) return null;

  // AgentBase: result.result.message.content[].text
  const abText = partsToText(result.result?.message?.content);
  if (abText) return abText;

  // A2A Message
  if (result.kind === 'message') {
    const t = partsToText(result.parts);
    if (t) return t;
  }

  // A2A Task: final status message → artifacts → last agent turn in history
  if (result.kind === 'task') {
    const fromStatus = partsToText(result.status?.message?.parts);
    if (fromStatus) return fromStatus;

    const artifactParts = (result.artifacts ?? []).flatMap((a) => a?.parts ?? []);
    const fromArtifacts = partsToText(artifactParts);
    if (fromArtifacts) return fromArtifacts;

    const history = result.history ?? [];
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i]?.role === 'agent') {
        const ht = partsToText(history[i].parts);
        if (ht) return ht;
      }
    }
  }

  return null;
}
