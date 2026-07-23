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
 *   anything else / unset → proxy through AgentBase's internal A2A endpoint
 *                          (DEFAULT): POST ${AGENTBASE_URL}/a2a
 *                          body: { agent_slug, skill_id, arguments }
 *                          auth:  Bearer <JWT minted via client_credentials>
 *
 * Defaulting to AgentBase is a guard rail: forgetting the flag routes through
 * the audited, zero-trust proxy rather than silently exposing Mastra directly.
 *
 * PROXY AUTH: AgentBase's `/a2a` accepts a **developer Application** identity —
 * an OAuth2 `client_credentials` bearer, never a long-lived static token. See
 * `agentbase-auth.ts` for how the token is minted/cached, and
 * `docs/INTEGRATION_AGENTBASE.md` for how to create the Application and
 * subscribe it to each agent's listing (required even for your own agents).
 *
 * MULTI-AGENT: AgentBase assigns each imported agent its own registry `slug`
 * (always `<derived-name>-<random8>` — never your Mastra agent id) and each
 * agent has one or more `skill` ids. There's no per-agent URL on this internal
 * path — one shared endpoint, with the target selected per request via
 * `agent_slug` + `skill_id`. `AGENTBASE_AGENTS` (JSON) maps each local Mastra
 * agent id to its real AgentBase slug/skill — copy these from the agent's
 * listing in Studio after import; they can't be predicted ahead of time.
 *
 * INVARIANT: the web app talks to agents **only over A2A** (JSON-RPC 2.0),
 * always through this util — with or without AgentBase. Both branches target an
 * A2A endpoint (`/api/a2a/:id` direct, or AgentBase `/a2a`); neither ever calls
 * Mastra's native REST (`/api/agents/:id/generate|stream`), listing, or Studio.
 * All Next → Mastra traffic goes through here (via the route handler) — never
 * call Mastra or AgentBase directly from client components. Enforced by
 * `apps/web/test/a2a-only.spec.ts`.
 */

import { log } from './logger';
import { getAgentBaseAccessToken } from './agentbase-auth';

export type A2aTransport = 'agentbase' | 'direct';

/**
 * Normalized reply so callers and the UI don't depend on each transport's wire
 * format. AgentBase's `/a2a` relays the upstream Mastra A2A response verbatim,
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
  /** Override the skill id resolved from AGENTBASE_AGENTS (proxy mode only). */
  skillId?: string;
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

// ── AGENTBASE_AGENTS: local agent id → AgentBase (slug, skillId) ────────────

interface AgentBaseAgentEntry {
  slug: string;
  skillId: string;
}

let parsedAgentsConfig: Record<string, AgentBaseAgentEntry> | null | undefined;

/** Test-only: clear the memoized AGENTBASE_AGENTS parse between test cases. */
export function resetAgentBaseAgentsConfigForTests(): void {
  parsedAgentsConfig = undefined;
}

/** Parse+cache AGENTBASE_AGENTS once. `undefined` = not parsed yet, `null` = invalid JSON. */
function agentBaseAgentsConfig(): Record<string, AgentBaseAgentEntry> | null {
  if (parsedAgentsConfig !== undefined) return parsedAgentsConfig;
  const raw = process.env.AGENTBASE_AGENTS ?? '';
  if (!raw) {
    parsedAgentsConfig = {};
    return parsedAgentsConfig;
  }
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      parsedAgentsConfig = obj as Record<string, AgentBaseAgentEntry>;
    } else {
      parsedAgentsConfig = null;
    }
  } catch {
    parsedAgentsConfig = null;
  }
  return parsedAgentsConfig;
}

function resolveAgentBaseTarget(
  agentId: string,
  skillIdOverride?: string,
): { slug: string; skillId: string } | { error: string } {
  const config = agentBaseAgentsConfig();
  if (config === null) {
    return { error: 'AGENTBASE_AGENTS is not valid JSON — see .env.example for the expected shape.' };
  }
  const entry = config[agentId];
  const slug = entry?.slug;
  const skillId = skillIdOverride ?? entry?.skillId;
  if (!slug || !skillId) {
    return {
      error:
        `No AgentBase mapping for agent "${agentId}" in AGENTBASE_AGENTS. Add its real ` +
        `AgentBase-assigned slug + a skill id (copy both from the agent's listing in Studio — ` +
        `the slug is never the same as the Mastra agent id).`,
    };
  }
  return { slug, skillId };
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
  const url = process.env.AGENTBASE_URL ?? '';

  // Guard rail: AgentBase is the default transport, so fail loudly (with a fix)
  // rather than silently POST to an unset/placeholder host.
  if (!url || url.includes('example.com')) {
    return {
      ok: false,
      text: null,
      via: 'agentbase',
      raw: null,
      error:
        'AgentBase is enabled (the default) but AGENTBASE_URL is not configured. ' +
        'Set AGENTBASE_URL (+ the Application credentials), or set ENABLE_AGENTBASE=0 ' +
        'to call Mastra directly over A2A.',
    };
  }

  const target = resolveAgentBaseTarget(agentId, options?.skillId);
  if ('error' in target) {
    return { ok: false, text: null, via: 'agentbase', raw: null, error: target.error };
  }

  const tokenResult = await getAgentBaseAccessToken();
  if (!tokenResult.ok) {
    return { ok: false, text: null, via: 'agentbase', raw: null, error: tokenResult.error };
  }

  // AgentBase's internal /a2a proxy: caller selects the target per request via
  // agent_slug + skill_id; `arguments` is relayed to Mastra's real A2A endpoint
  // verbatim, so it must already be a valid A2A JSON-RPC envelope.
  const body = {
    agent_slug: target.slug,
    skill_id: target.skillId,
    arguments: buildA2aMessageEnvelope(text, options?.sessionId),
  };

  const raw = await postJsonRpc(`${url}/a2a`, body, tokenResult.accessToken, options?.signal);
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
