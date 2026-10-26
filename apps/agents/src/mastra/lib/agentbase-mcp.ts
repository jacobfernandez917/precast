import { createHash } from 'node:crypto';
import { MCPClient } from '@mastra/mcp';
import { getAgentBaseToken } from './agentbase-model';
import { attachOnBehalfOf, currentOnBehalfOf } from './request-context';

/**
 * MCPDISC-1 — discover this agent's MCP tools from AgentBase at runtime,
 * instead of hardcoding server URLs in `.env`.
 *
 * This is the MCP counterpart to `resolveAgentModel()` (ADR-016). An
 * AgentBase-hosted container is told:
 *
 *   AGENTBASE_HOSTED           "1" on any AgentBase-hosted container
 *   AGENTBASE_MCP_BASE_URL     the MCP proxy root, e.g. https://api/proxy/mcp
 *
 * and already carries per-agent Application credentials (the
 * `AGENTBASE_CLIENT_ID[_<AGENT_ID>]` / `AGENTBASE_CLIENT_SECRET[_<AGENT_ID>]` pair —
 * credentials are AgentBase-wide, not LLM-specific, which is exactly why this
 * file can reuse them). The
 * MCP proxy and the LLM gateway sit behind the SAME `PublicProxyGuard`, so the
 * token minted for one authenticates the other — hence `getAgentBaseToken()`
 * is reused here rather than duplicated.
 *
 * The flow:
 *   1. `GET {base}/subscriptions` → the org/slug pairs this agent may call.
 *   2. Build an `MCPClient` pointed at `{base}/:org/:slug/mcp` for each.
 *
 * Discovery uses the dedicated `GET {base}/subscriptions` endpoint rather than
 * AgentBase's native `agentbase.list_subscriptions` MCP tool: that tool resolves
 * the caller through `ownerDeveloperId`, which the per-agent service application
 * a hosted container authenticates with does not have. It answers
 * `developer_app_required`. (A developer's OWN application — e.g. a scaffold
 * using their client id/secret — should use the native tools instead.)
 *
 * Every call goes through AgentBase's proxy, which injects the real upstream
 * credential, enforces the subscription, meters, and audits. The container never
 * holds a vendor MCP secret — discovery deliberately returns no `baseUrl` and no
 * `authConfig`, so there is nothing here to route around the proxy with.
 *
 * OFF AgentBase (local dev, External) this is inert: it returns an
 * empty toolset and never throws, so nothing about local development changes.
 *
 * ONE EXCEPTION to fail-loud, and only one. A subscribed server whose connect
 * answers `mcp_server_authorization_required` (401) is not broken — it means
 * "subscribed, but nobody has connected an ACCOUNT for this identity yet". That
 * state is expected, human-actionable, and clears only when someone clicks
 * **Connect account** in the AgentBase registry; no redeploy can fix it. Failing
 * the boot on it crash-loops the container, the import's readiness probe never
 * answers, and the import fails — over a state the operator would have resolved
 * in one click had the agent been allowed to start. For on-behalf-of products
 * the service identity may legitimately NEVER hold a token, so such a container
 * could never boot at all. Those servers are therefore SKIPPED with a loud
 * warning; every other connect failure still fails the boot, because silent tool
 * loss remains the failure mode this path exists to prevent.
 *
 * SKIPPED IS NOT FOREVER, AND NOT FOR EVERYONE. Tools are resolved per caller
 * identity by `createAgentMcpToolset()`: the end-user subject a turn acts for
 * (`X-AgentBase-On-Behalf-Of`), or the container's own identity when there is
 * none. Each identity gets its own MCP client, bound to that subject, so one
 * person's connected account never serves another person's turn. An identity
 * with servers still awaiting an account is checked again every 15 s, so
 * connecting the account brings the tools in on the next turn, with no restart.
 * `resolveAgentMcpTools()` remains for code that wants one resolution now.
 */

const AUTH_ERROR_MARKERS = [
  'mcp_server_authorization_required',
  'authorization_required',
  'authorization required',
];

/**
 * Is this connect failure "no account connected yet" rather than "broken"?
 *
 * The SDK surfaces failures as `Error`s, plain strings, and nested `cause`
 * chains depending on how deep the failure happened, so all three are walked.
 * `seen` guards against a cause cycle — a self-referencing `cause` would
 * otherwise hang the boot, which would be a worse bug than the one this fixes.
 */
export function isMcpAuthError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    const message =
      current instanceof Error ? current.message : typeof current === 'string' ? current : '';
    const lower = message.toLowerCase();
    if (AUTH_ERROR_MARKERS.some((marker) => lower.includes(marker))) return true;
    if (/\b401\b|\bunauthorized\b/.test(lower)) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

/** One entry from `GET /proxy/mcp/subscriptions`. */
export interface SubscribedMcpServer {
  org: string;
  slug: string;
  title: string;
  scopes: string[];
  /** API-relative, e.g. `/proxy/mcp/acme/weather/mcp`. */
  url: string;
}

function isHostedByAgentBase(): boolean {
  return process.env.AGENTBASE_HOSTED === '1';
}

function mcpBaseUrl(): string | undefined {
  const raw = process.env.AGENTBASE_MCP_BASE_URL?.trim();
  return raw ? raw.replace(/\/+$/, '') : undefined;
}

/**
 * Ask AgentBase which MCP servers this agent may call. Hosted only.
 *
 * Throws on failure rather than returning an empty list. An agent that
 * silently loses its tools does not fail — it answers confidently without
 * them, which is the worst outcome and the hardest to notice. A container that
 * refuses to boot is visible immediately in AgentBase's build/runtime logs.
 */
export async function discoverMcpServers(agentId: string): Promise<SubscribedMcpServer[]> {
  const base = mcpBaseUrl();
  if (!isHostedByAgentBase() || !base) return [];

  const token = await getAgentBaseToken(agentId);
  const res = await fetch(`${base}/subscriptions`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(
      `AgentBase MCP discovery failed for "${agentId}": ${res.status} ${res.statusText}. ` +
        'The agent is running on AgentBase but could not determine which MCP servers it may ' +
        'call, so its toolset would be silently incomplete.',
    );
  }

  const body = (await res.json()) as { mcpServers?: SubscribedMcpServer[] };
  return body.mcpServers ?? [];
}

/**
 * The MCP toolset for this agent, ready to spread into `new Agent({ tools })`.
 *
 * Returns `{}` when there is nothing to add — off AgentBase, or hosted with no
 * MCP subscriptions. An empty result is a real answer ("you are entitled to
 * nothing"), which is why discovery is injected unconditionally on hosted
 * containers rather than only when something is configured.
 */
export async function resolveAgentMcpTools(agentId: string): Promise<Record<string, unknown>> {
  const { tools, pending } = await resolveToolset(agentId, {
    // `id` keeps repeated construction (hot reload, re-resolve) from tripping
    // MCPClient's duplicate-instance guard.
    clientId: `agentbase-${agentId}`,
  });
  for (const server of pending) warnPending(agentId, server, 'this container');
  return tools;
}

/** The parts of an MCP client this module uses. */
interface McpClientLike {
  listToolsWithErrors(): Promise<{
    tools: Record<string, unknown>;
    errors: Record<string, unknown>;
  }>;
  disconnect?(): Promise<void>;
}

interface ResolvedToolset {
  tools: Record<string, unknown>;
  /** Servers whose tools are missing only because no account is connected yet. */
  pending: string[];
  client?: McpClientLike;
}

/**
 * One resolution: discover, build a client, list tools, partition failures.
 * Throws on a discovery failure or on any connect failure that is not
 * "authorization required".
 *
 * With `bound`, the client belongs to one identity: it sends that subject and
 * refuses to send anything from a request acting for someone else. Without it,
 * the subject is read from the current request at call time (the original
 * single-client behaviour of `resolveAgentMcpTools`).
 */
async function resolveToolset(
  agentId: string,
  opts: { clientId: string; bound?: { subject: string | undefined } },
): Promise<ResolvedToolset> {
  const servers = await discoverMcpServers(agentId);
  if (servers.length === 0) return { tools: {}, pending: [] };

  const base = mcpBaseUrl();
  const bound = opts.bound;

  const client: McpClientLike = new MCPClient({
    id: opts.clientId,
    servers: Object.fromEntries(
      servers.map((s) => [
        `${s.org}__${s.slug}`.replace(/[^A-Za-z0-9_]/g, '_'),
        {
          url: new URL(`${base}/${s.org}/${s.slug}/mcp`),
          // A per-request `fetch` rather than a static `requestInit`. This
          // client is built ONCE, at agent construction — so a header fixed
          // here would carry whatever was true at boot forever. Two things
          // must be decided per call instead:
          //
          //   the SUBJECT, which differs per request and is the whole point
          //     of OBO; a boot-time value would be empty for every turn.
          //   the TOKEN, which expires — one minted at construction would go
          //     stale on a long-running container and start failing.
          fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();
            // A bound client acts for one identity only. Reaching it from a turn
            // that acts for someone else would send their call with this
            // person's account, so it fails closed instead.
            if (bound && currentOnBehalfOf() !== bound.subject) {
              throw new Error(
                `AgentBase MCP: a client bound to one caller was used in another caller's turn ` +
                  `for "${agentId}"; the call was not sent.`,
              );
            }
            const headers = new Headers(init?.headers);
            headers.set('authorization', `Bearer ${await getAgentBaseToken(agentId)}`);
            // Host-guarded inside: the subject goes to AgentBase and nowhere else.
            attachOnBehalfOf(headers, url, base, bound ? bound.subject : currentOnBehalfOf());
            return fetch(input, { ...init, headers });
          },
        },
      ]),
    ),
  });

  // `listToolsWithErrors()` rather than `listTools()`: it reports servers that
  // failed to connect instead of quietly omitting their tools. A subscription
  // that resolves but whose upstream is down must not present as "this agent
  // simply has fewer tools" — that is the silent-degradation failure this whole
  // path is designed to avoid.
  const { tools, errors } = await client.listToolsWithErrors();
  const failed = Object.entries(errors);

  // Partition, don't blanket-throw. `mcp_server_authorization_required` means a
  // human still has to connect an account — see the module header for why that
  // must not kill the container. Everything else keeps the original behaviour
  // verbatim, so the guard against silent tool loss is unchanged.
  const authPending = failed.filter(([, err]) => isMcpAuthError(err));
  const broken = failed.filter(([, err]) => !isMcpAuthError(err));

  if (broken.length > 0) {
    const detail = broken.map(([server, err]) => `${server}: ${err}`).join('; ');
    await client.disconnect?.().catch(() => undefined);
    throw new Error(
      `AgentBase MCP: ${broken.length} subscribed server(s) failed to connect for "${agentId}" — ` +
        `${detail}. Refusing to run with an incomplete toolset.`,
    );
  }

  return { tools, pending: authPending.map(([server]) => server), client };
}

function warnPending(agentId: string, server: string, who: string): void {
  console.warn(
    `⚠️  AgentBase MCP: subscribed server "${server}" has no connected account for agent ` +
      `"${agentId}" (${who}; authorization required). Its tools are OMITTED until an account ` +
      `is connected in the AgentBase registry; they appear on a later turn, with no restart.`,
  );
}

/** A label for logs and client ids that does not reveal the subject itself. */
function identityLabel(subject: string | undefined): string {
  return subject === undefined
    ? 'service'
    : `user-${createHash('sha256').update(subject).digest('hex').slice(0, 12)}`;
}

export interface AgentMcpToolset {
  /**
   * Resolve the container identity's tools once, at boot. Throws on a discovery
   * failure or a broken server, which is what makes a bad deploy fail its boot.
   */
  preflight(): Promise<void>;
  /** The MCP tools for the identity the current turn acts for. */
  current(): Promise<Record<string, unknown>>;
}

export interface AgentMcpToolsetOptions {
  /** How soon an identity with servers awaiting an account is checked again. */
  pendingRecheckMs?: number;
  /** How long a complete toolset is reused before subscriptions are read again. */
  ttlMs?: number;
  /** Identities kept at once; the least recently used is dropped beyond this. */
  maxIdentities?: number;
  /** How long a replaced client stays connected for turns already using its tools. */
  retireAfterMs?: number;
  now?: () => number;
}

interface Entry extends ResolvedToolset {
  subject: string | undefined;
  resolvedAt: number;
  checkedAt: number;
}

/**
 * MCP tools resolved per caller identity, for `new Agent({ tools: async () => … })`.
 *
 * - Keyed by the subject the turn acts for, else the container identity; each
 *   key has its own client (unique id, so one identity's refresh never
 *   disconnects another's), bound to that subject.
 * - A toolset with servers awaiting an account is re-resolved after
 *   `pendingRecheckMs` (15 s); a complete one after `ttlMs` (10 min), which also
 *   picks up new subscriptions.
 * - A failed re-check inside the TTL keeps serving the toolset it has and logs
 *   the failure; past the TTL the failure reaches the turn. Discovery errors and
 *   broken servers are never turned into "fewer tools".
 * - Concurrent turns for one identity share one resolution.
 */
export function createAgentMcpToolset(
  agentId: string,
  options: AgentMcpToolsetOptions = {},
): AgentMcpToolset {
  const pendingRecheckMs = options.pendingRecheckMs ?? 15_000;
  const ttlMs = options.ttlMs ?? 10 * 60_000;
  const maxIdentities = options.maxIdentities ?? 500;
  const retireAfterMs = options.retireAfterMs ?? 10 * 60_000;
  const now = options.now ?? Date.now;

  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<Entry>>();
  let generation = 0;

  const keyOf = (subject: string | undefined) =>
    subject === undefined ? 'service' : `obo:${subject}`;

  function retire(client: McpClientLike | undefined): void {
    if (!client?.disconnect) return;
    const timer = setTimeout(
      () => void client.disconnect?.().catch(() => undefined),
      retireAfterMs,
    );
    timer.unref?.();
  }

  function remember(key: string, entry: Entry): void {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > maxIdentities) {
      const [oldestKey, oldest] = entries.entries().next().value as [string, Entry];
      entries.delete(oldestKey);
      retire(oldest.client);
    }
  }

  async function load(subject: string | undefined, key: string, previous?: Entry): Promise<Entry> {
    generation += 1;
    const who = identityLabel(subject);
    const resolved = await resolveToolset(agentId, {
      clientId: `agentbase-${agentId}-${who}-${generation}`,
      bound: { subject },
    });
    const at = now();
    const entry: Entry = { ...resolved, subject, resolvedAt: at, checkedAt: at };

    const before = new Set(previous?.pending ?? []);
    for (const server of entry.pending) {
      if (!before.has(server)) warnPending(agentId, server, who);
    }
    for (const server of before) {
      if (!entry.pending.includes(server)) {
        console.info(
          `AgentBase MCP: "${server}" now has a connected account for agent "${agentId}" (${who}); ` +
            'its tools are available.',
        );
      }
    }

    if (previous?.client && previous.client !== entry.client) retire(previous.client);
    remember(key, entry);
    return entry;
  }

  async function current(): Promise<Record<string, unknown>> {
    const subject = currentOnBehalfOf();
    const key = keyOf(subject);
    const existing = entries.get(key);
    const at = now();

    if (existing) {
      const withinTtl = at - existing.resolvedAt < ttlMs;
      const recheckDue = existing.pending.length > 0 && at - existing.checkedAt >= pendingRecheckMs;
      if (withinTtl && !recheckDue) {
        remember(key, existing);
        return existing.tools;
      }
    }

    let running = inflight.get(key);
    if (!running) {
      running = load(subject, key, existing).finally(() => inflight.delete(key));
      inflight.set(key, running);
    }

    try {
      return (await running).tools;
    } catch (err) {
      if (existing && at - existing.resolvedAt < ttlMs) {
        existing.checkedAt = at;
        console.error(
          `AgentBase MCP: re-checking tools for agent "${agentId}" (${identityLabel(subject)}) ` +
            `failed; keeping the toolset resolved ${Math.round((at - existing.resolvedAt) / 1000)} s ago. ` +
            `${(err as Error)?.message ?? String(err)}`,
        );
        return existing.tools;
      }
      throw err;
    }
  }

  return {
    preflight: async () => {
      await current();
    },
    current,
  };
}

/**
 * MCPADDR-1 — the absolute URL of one subscribed MCP server.
 *
 * `GET {base}/subscriptions` already returns a ready-made address for every
 * attached server. Until now that list was used only to attach servers as LLM
 * tools, so a project wanting a DETERMINISTIC call — invoking a specific tool
 * itself rather than letting the model choose — had nowhere to get an address
 * and hardcoded one in an env var. That is a second copy of something the
 * platform already provides, and it goes stale the moment a server is renamed.
 *
 * Fails loudly on zero or several matches, and names what WAS found. Silently
 * picking one of two plausible servers would send a user's data to the wrong
 * place, which is far worse than an error a human reads once.
 *
 *   const url = await resolveSubscribedServer(agentId, { slug: 'slack-mcp-2e688547' });
 *   const url = await resolveSubscribedServer(agentId, { titleMatch: /slack/i });
 */
export async function resolveSubscribedServer(
  agentId: string,
  match: { slug?: string; titleMatch?: RegExp },
): Promise<string> {
  const base = mcpBaseUrl();
  if (!base) {
    throw new Error(
      'AgentBase MCP is not configured (AGENTBASE_MCP_BASE_URL is unset), so a subscribed ' +
        'server cannot be resolved. This is expected off AgentBase — guard the call with ' +
        '`AGENTBASE_HOSTED === "1"` if the path must also run locally.',
    );
  }

  const servers = await discoverMcpServers(agentId);
  const hits = servers.filter((s) =>
    match.slug ? s.slug === match.slug : match.titleMatch ? match.titleMatch.test(s.title) : false,
  );

  const wanted = match.slug ? `slug "${match.slug}"` : `title matching ${match.titleMatch}`;
  const inventory = servers.length
    ? servers.map((s) => `${s.slug} ("${s.title}")`).join(', ')
    : '(none — this agent has no MCP subscriptions)';

  if (hits.length === 0) {
    throw new Error(`No subscribed AgentBase MCP server has ${wanted}. Subscribed: ${inventory}.`);
  }
  if (hits.length > 1) {
    throw new Error(
      `${hits.length} subscribed servers match ${wanted} — refusing to guess which one you ` +
        `meant. Matched: ${hits.map((s) => s.slug).join(', ')}. Address it by exact slug.`,
    );
  }

  const only = hits[0];
  // `url` is API-relative (`/proxy/mcp/org/slug/mcp`) while `base` already ends
  // at `/proxy/mcp` — so build from org/slug rather than concatenating the two,
  // which would double the prefix.
  return `${base}/${only.org}/${only.slug}/mcp`;
}
