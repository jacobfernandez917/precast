import { MCPClient } from '@mastra/mcp';
import { getAgentBaseToken } from './agentbase-model';
import { attachOnBehalfOf } from './request-context';

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
 * OFF AgentBase (local dev, Standalone, External) this is inert: it returns an
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
  const servers = await discoverMcpServers(agentId);
  if (servers.length === 0) return {};

  const base = mcpBaseUrl();

  const client = new MCPClient({
    // `id` keeps repeated construction (hot reload, re-resolve) from tripping
    // MCPClient's duplicate-instance guard.
    id: `agentbase-${agentId}`,
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
            const headers = new Headers(init?.headers);
            headers.set('authorization', `Bearer ${await getAgentBaseToken(agentId)}`);
            // Host-guarded inside: the subject goes to AgentBase and nowhere else.
            attachOnBehalfOf(headers, url, base);
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
    throw new Error(
      `AgentBase MCP: ${broken.length} subscribed server(s) failed to connect for "${agentId}" — ` +
        `${detail}. Refusing to run with an incomplete toolset.`,
    );
  }

  for (const [server] of authPending) {
    console.warn(
      `⚠️  AgentBase MCP: subscribed server "${server}" has no connected account for agent ` +
        `"${agentId}" (authorization required). Its tools are OMITTED until an account is ` +
        `connected in the AgentBase registry — the agent boots and serves without them.`,
    );
  }

  return tools as Record<string, unknown>;
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
    throw new Error(
      `No subscribed AgentBase MCP server has ${wanted}. Subscribed: ${inventory}.`,
    );
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
