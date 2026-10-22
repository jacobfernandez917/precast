/**
 * Server-only client for invoking Mastra agents over the A2A protocol
 * (JSON-RPC 2.0). Every call goes through the AgentBase proxy, with one
 * development exception:
 *
 *   PRECAST_LOCAL_AGENTS=1 → call the local agents app directly over A2A:
 *                            POST ${MASTRA_INTERNAL_URL}/api/a2a/:agentId
 *                            (auth: Bearer AGENT_API_TOKEN when set). For a
 *                            project that is not yet imported into AgentBase;
 *                            Compose sets it for the local stack.
 *   unset or 0 (DEFAULT)   → the agent's AgentBase proxy URL, discovered at
 *                            runtime, with a Bearer minted via client_credentials.
 *
 * `ENABLE_AGENTBASE=0` is the pre-v0.10.0 spelling of the local switch and is
 * still read for one release. There is no deployment mode without AgentBase.
 *
 * Defaulting to the proxy is a guard rail: forgetting the switch routes through
 * the audited, zero-trust proxy rather than silently exposing Mastra directly.
 *
 * PROXY URL: DISCOVERED at runtime from this Application's subscriptions —
 * see `agentbase-discovery.ts`. AgentBase mints an agent's slug at import, it
 * is not derivable from the Mastra id, and it changes on re-import, so the
 * mapping is read from the agents' own A2A cards rather than configured by
 * hand. `AGENTBASE_AGENT_URL_<AGENT_ID>` remains an override for pinning,
 * offline dev and tests. Requires `AGENTBASE_URL` (the API base).
 *
 * PROXY AUTH: still a **developer Application** identity (OAuth2
 * `client_credentials` bearer, never a long-lived static token) — see
 * `agentbase-auth.ts` for how the token is minted/cached, and
 * `docs/INTEGRATION_AGENTBASE.md` for how to create the Application and
 * subscribe it to each agent's listing (required even for your own agents).
 *
 * MULTI-AGENT: nothing to add per agent. Subscribe the Application to each
 * agent's listing and discovery picks it up on the next refresh; an id it has
 * never seen forces one immediate re-discovery, so a fresh import resolves
 * without a redeploy.
 *
 * INVARIANT: the web app talks to agents **only over A2A** (JSON-RPC 2.0),
 * always through this util — with or without AgentBase. Both branches target an
 * A2A endpoint (`/api/a2a/:id` direct, or the agent's AgentBase proxy URL);
 * neither ever calls Mastra's native REST (`/api/agents/:id/generate|stream`),
 * listing, or Studio. All Next → Mastra traffic goes through here (via the
 * route handler) — never call Mastra or AgentBase directly from client
 * components. Enforced by `apps/web/test/a2a-only.spec.ts`.
 */

import { A2UI_EXTENSION_URI, a2uiClientCapabilities, a2uiMessagesFromReply } from '@precast/a2ui';
import { log } from './logger';
import { getAgentBaseAccessToken } from './agentbase-auth';
import { resolveAgentUrl } from './agentbase-discovery';

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
  /**
   * A2UI server-to-client messages the agent attached (interactive cards), in order; empty when
   * there are none. Untrusted agent output: the browser renderer validates every component
   * against the catalog before drawing it.
   */
  a2ui: unknown[];
  /** Error message when the agent call failed. */
  error?: string;
  /** Which transport handled the call. */
  via: A2aTransport;
  /** The full underlying JSON-RPC response, for debugging. */
  raw: unknown;
}

interface CallOptions {
  /**
   * Conversation thread. Sent as the A2A `contextId`, which Mastra maps onto
   * its memory `threadId`. Omit it and the turn is stateless — Mastra only
   * passes thread/resource to the agent when a `contextId` is present.
   *
   * MUST be a server-derived, resource-namespaced id — see
   * `resolveAgentContext()` in `./agent-context`. Never pass a raw
   * client-supplied value.
   */
  threadId?: string;
  /**
   * Stable per-user id. Sent as `message.metadata.resourceId`, which scopes
   * working memory and drives Mastra's thread-ownership check.
   *
   * Omitting this is NOT neutral: Mastra falls back to the agent id, so every
   * user collapses into one shared memory bucket. Always pass the value from
   * `resolveAgentContext()`.
   */
  resourceId?: string;
  signal?: AbortSignal;
}

/**
 * True when the web app should call the local agents app directly: the
 * development switch `PRECAST_LOCAL_AGENTS=1`, or its pre-v0.10.0 spelling
 * `ENABLE_AGENTBASE=0` when the new one is unset. Anything else is the proxy.
 */
export function isLocalAgents(): boolean {
  const local = process.env.PRECAST_LOCAL_AGENTS;
  if (local !== undefined && local !== '') return local === '1';
  return process.env.ENABLE_AGENTBASE === '0';
}

/** True when calls go through the AgentBase proxy (the default). */
export function isAgentBaseEnabled(): boolean {
  return !isLocalAgents();
}

/**
 * Invoke a Mastra agent. Proxies through AgentBase by default; calls the local
 * agents app directly only when `PRECAST_LOCAL_AGENTS=1`.
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

// ── A2A envelope (shared by both transports — AgentBase relays it unchanged) ─

function buildA2aMessageEnvelope(text: string, options?: CallOptions): unknown {
  const { threadId, resourceId } = options ?? {};
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
        // contextId → Mastra threadId. Without it Mastra passes neither thread
        // nor resource to the agent, and memory stays inert.
        ...(threadId ? { contextId: threadId } : {}),
        // `resourceId` is read by Mastra's A2A handler as
        // `message.metadata.resourceId`. It defaults to the AGENT ID when absent,
        // which would put every user in one shared memory bucket — so this is
        // load-bearing, not optional. `a2uiClientCapabilities` tells the agent
        // this app draws `raya.blocks.v1` cards (see AgentCards.tsx).
        metadata: {
          ...(resourceId ? { resourceId } : {}),
          a2uiClientCapabilities: a2uiClientCapabilities(),
        },
      },
    },
  };
}

async function callViaAgentBase(
  agentId: string,
  text: string,
  options?: CallOptions,
): Promise<AgentReply> {
  // The URL is DISCOVERED (AGENTDISC-1), not configured: AgentBase mints a slug
  // at import that is not derivable from the Mastra id and changes on every
  // re-import. `AGENTBASE_AGENT_URL_<AGENT_ID>` still wins when set, so pinning
  // and offline dev keep working. Failure returns an error — never a guessed
  // URL, which would 404 while looking perfectly well-formed.
  const target = await resolveAgentUrl(agentId);
  if (!target.ok) {
    return { ok: false, text: null, a2ui: [], via: 'agentbase', raw: null, error: target.error };
  }
  const url = target.url;

  const tokenResult = await getAgentBaseAccessToken();
  if (!tokenResult.ok) {
    return {
      ok: false,
      text: null,
      a2ui: [],
      via: 'agentbase',
      raw: null,
      error: tokenResult.error,
    };
  }

  // AgentBase's per-agent proxy takes the raw A2A envelope as the body (org +
  // agent are already in the URL) — the same one direct mode sends to Mastra.
  const body = buildA2aMessageEnvelope(text, options);

  const raw = await postJsonRpc(url, body, tokenResult.accessToken, options?.signal);
  return normalize(raw, 'agentbase');
}

async function callDirect(
  agentId: string,
  text: string,
  options?: CallOptions,
): Promise<AgentReply> {
  const base = process.env.MASTRA_INTERNAL_URL ?? 'http://localhost:45000';
  const token = process.env.AGENT_API_TOKEN ?? '';

  // Mastra speaks A2A 0.3.0: `message/send` with a Message envelope. The target
  // agent is in the URL path; the bearer must match the server's AGENT_API_TOKEN.
  const body = buildA2aMessageEnvelope(text, options);

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
  // The A2UI extension, requested on every call. AgentBase forwards a validated
  // `X-A2A-Extensions` (A2UI-1); the metadata above carries the same intent.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-A2A-Extensions': A2UI_EXTENSION_URI,
  };
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
    return { ok: false, text: null, a2ui: [], error: r.error.message ?? 'Agent error', via, raw };
  }
  return { ok: true, text: extractText(r?.result), a2ui: a2uiMessagesFromReply(r), via, raw };
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
