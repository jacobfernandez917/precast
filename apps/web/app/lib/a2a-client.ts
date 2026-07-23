/**
 * Server-only client for invoking Mastra agents over the A2A protocol
 * (JSON-RPC 2.0). The transport is chosen by the `ENABLE_AGENTBASE` env flag,
 * and **AgentBase is the default** — you must explicitly opt out to talk to
 * Mastra directly:
 *
 *   ENABLE_AGENTBASE=0   → talk directly to the Mastra agent API over A2A:
 *                          POST ${MASTRA_INTERNAL_URL}/api/a2a/:agentId
 *                          (auth: Bearer AGENT_API_TOKEN — must match the
 *                          Mastra server's token; omitted when unset)
 *   anything else / unset → proxy through AgentBase's per-agent proxy URL
 *                          (DEFAULT): POST ${AGENTBASE_AGENT_URL_<AGENT_ID>}
 *                          body: the same A2A message/send envelope direct
 *                          mode sends — AgentBase forwards it verbatim
 *                          auth:  Bearer <JWT minted via client_credentials>
 *
 * Defaulting to AgentBase is a guard rail: forgetting the flag routes through
 * the audited, zero-trust proxy rather than silently exposing Mastra directly.
 *
 * PROXY URL: each agent gets its own full AgentBase proxy URL — copy the
 * "Invocation Endpoint" straight from the agent's listing page in AgentBase
 * Studio into `AGENTBASE_AGENT_URL_<AGENT_ID>` (see .env.example). No slug or
 * skill id to resolve separately — the URL already encodes the org + agent,
 * and this endpoint routes purely by that path (skill selection is the
 * agent's own job once the message arrives).
 *
 * PROXY AUTH: still a **developer Application** identity (OAuth2
 * `client_credentials` bearer, never a long-lived static token) — see
 * `agentbase-auth.ts` for how the token is minted/cached, and
 * `docs/INTEGRATION_AGENTBASE.md` for how to create the Application and
 * subscribe it to each agent's listing (required even for your own agents).
 *
 * MULTI-AGENT: one env var per agent (`AGENTBASE_AGENT_URL_<AGENT_ID>`,
 * uppercased/underscored). Add one line per agent as you register more of
 * them on the Mastra instance — no shared endpoint or JSON mapping to keep
 * in sync.
 *
 * INVARIANT: the web app talks to agents **only over A2A** (JSON-RPC 2.0),
 * always through this util — with or without AgentBase. Both branches target an
 * A2A endpoint (`/api/a2a/:id` direct, or the agent's AgentBase proxy URL);
 * neither ever calls Mastra's native REST (`/api/agents/:id/generate|stream`),
 * listing, or Studio. All Next → Mastra traffic goes through here (via the
 * route handler) — never call Mastra or AgentBase directly from client
 * components. Enforced by `apps/web/test/a2a-only.spec.ts`.
 */

import { log } from './logger';
import { getAgentBaseAccessToken } from './agentbase-auth';

export type A2aTransport = 'agentbase' | 'direct';

/**
 * Normalized reply so callers and the UI don't depend on each transport's wire
 * format. AgentBase's proxy relays the upstream Mastra A2A response verbatim,
 * so both transports actually share the same response shape today — this type
 * (and `normalize()`) stay transport-agnostic on purpose.
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
  signal?: AbortSignal;
}

/**
 * True when the AgentBase proxy transport is enabled. AgentBase is the DEFAULT:
 * only an explicit `ENABLE_AGENTBASE=0` opts into direct Mastra A2A. A missing
 * or any other value keeps the audited proxy path (guard rail).
 */
export function isAgentBaseEnabled(): boolean {
  return process.env.ENABLE_AGENTBASE !== '0';
}

/**
 * Invoke a Mastra agent. Proxies through AgentBase by default; calls the Mastra
 * A2A endpoint directly only when `ENABLE_AGENTBASE=0`.
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

/** `example-agent` → `AGENTBASE_AGENT_URL_EXAMPLE_AGENT`. */
function envVarNameForAgent(agentId: string): string {
  return `AGENTBASE_AGENT_URL_${agentId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

// ── A2A envelope (shared by both transports — AgentBase relays it unchanged) ─

function buildA2aMessageEnvelope(text: string, sessionId?: string): unknown {
  return {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        role: 'user',
        messageId: crypto.randomUUID(),
        parts: [{ kind: 'text', text }],
        ...(sessionId ? { contextId: sessionId } : {}),
      },
    },
  };
}

async function callViaAgentBase(
  agentId: string,
  text: string,
  options?: CallOptions,
): Promise<AgentReply> {
  const envVar = envVarNameForAgent(agentId);
  const url = process.env[envVar] ?? '';

  // Guard rail: AgentBase is the default transport, so fail loudly (with a fix)
  // rather than silently POST to an unset endpoint.
  if (!url) {
    return {
      ok: false,
      text: null,
      via: 'agentbase',
      raw: null,
      error:
        `AgentBase is enabled (the default) but ${envVar} is not set. Copy the ` +
        `"Invocation Endpoint" from agent "${agentId}"'s listing in AgentBase Studio into ` +
        `${envVar}, or set ENABLE_AGENTBASE=0 to call Mastra directly over A2A.`,
    };
  }

  const tokenResult = await getAgentBaseAccessToken();
  if (!tokenResult.ok) {
    return { ok: false, text: null, via: 'agentbase', raw: null, error: tokenResult.error };
  }

  // AgentBase's per-agent proxy takes the raw A2A envelope as the body (org +
  // agent are already in the URL) — the same one direct mode sends to Mastra.
  const body = buildA2aMessageEnvelope(text, options?.sessionId);

  const raw = await postJsonRpc(url, body, tokenResult.accessToken, options?.signal);
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
  const body = buildA2aMessageEnvelope(text, options?.sessionId);

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

  // Debug-level so the full A2A wire traffic shows under `dev:verbose` /
  // LOG_LEVEL=debug, without noising up the default `info` terminal. Auth
  // header is intentionally not logged.
  log.debug({ endpoint, authenticated: Boolean(bearer) }, 'A2A → outbound request');
  const startedAt = performance.now();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    const ms = Math.round(performance.now() - startedAt);
    log.debug({ endpoint, status: res.status, ms }, 'A2A ← response');
    return res.json();
  } catch (err) {
    log.error({ endpoint, err: (err as Error).message }, 'A2A × request threw');
    throw err;
  }
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
  // Legacy AgentBase shape (pre-SRCIMP `tasks/send` proxy): result.result.message.content[].text
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

/** Pull assistant text out of either a legacy AgentBase shape or an A2A Message/Task. */
function extractText(result?: RpcResult): string | null {
  if (!result) return null;

  // Legacy AgentBase shape: result.result.message.content[].text
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
