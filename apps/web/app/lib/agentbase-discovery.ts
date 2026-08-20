import { getAgentBaseAccessToken } from './agentbase-auth';
import { log } from './logger';

/**
 * AGENTDISC-1 — resolve an agent's AgentBase proxy URL at RUNTIME instead of
 * configuring one env var per agent.
 *
 * The problem this removes: AgentBase mints a slug at import
 * (`advisor-agent` → `founder-advisor-479c1de1`), the slug is not derivable
 * from the Mastra id, and it CHANGES on re-import. Any hand-maintained mapping
 * — `AGENTBASE_AGENT_URL_<AGENT_ID>` here, a slug map elsewhere — is therefore
 * stale the moment someone re-imports, and its failure is a 404 from a URL that
 * looks perfectly well-formed.
 *
 * The mapping is discoverable, and the key fact is that Mastra names its agent
 * card after the agent ID:
 *
 *   GET /api/.well-known/<agentId>/agent-card.json  ->  { "name": "<agentId>", … }
 *
 * AgentBase's `AgentCardSynthesizer` spreads the stored card and overrides only
 * `url`, `capabilities.streaming`, `supportedInterfaces[0].url`,
 * `securitySchemes` and `provider` — it never touches `name`. So the card served
 * at `{base}/proxy/a2a/{org}/{slug}/.well-known/agent.json` states the Mastra id,
 * at a path containing the slug. That response IS one row of the mapping.
 *
 * Deliberately NOT used: the `name` from `agentbase.list_subscriptions` /
 * `list_agents`. That is AgentBase's own display name, editable at import, and
 * it routinely differs from the Mastra id. Mapping on it looks like it works
 * until someone renames an agent in Studio.
 */

/** One resolved agent: where it lives on AgentBase, and how to call it. */
export interface AgentRoute {
  /** Publisher org slug — the `:org` segment. */
  org: string;
  /** AgentBase's slug for the agent — the `:agent` segment. */
  slug: string;
  /** Full invocation URL: `{base}/proxy/a2a/{org}/{slug}`. */
  url: string;
}

export type DiscoveryResult =
  | { ok: true; routes: Map<string, AgentRoute> }
  | { ok: false; error: string };

export type ResolveResult = { ok: true; url: string } | { ok: false; error: string };

/** Slugs change only on re-import, so a long TTL is safe; a miss forces a refresh anyway. */
const TTL_MS = 10 * 60_000;

interface Cache {
  routes: Map<string, AgentRoute>;
  expiresAt: number;
}

let cache: Cache | null = null;
/** Single-flight: concurrent first requests must not each run discovery. */
let inFlight: Promise<DiscoveryResult> | null = null;

/** Test hook — clears the cache and any in-flight discovery. */
export function resetDiscoveryCacheForTests(): void {
  cache = null;
  inFlight = null;
}

/** `example-agent` → `AGENTBASE_AGENT_URL_EXAMPLE_AGENT`. */
export function overrideEnvVarName(agentId: string): string {
  return `AGENTBASE_AGENT_URL_${agentId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

function apiBase(): string {
  return (process.env.AGENTBASE_URL ?? '').replace(/\/+$/, '');
}

interface SubscriptionRow {
  targetType?: string;
  targetSlug?: string;
  providerTenantSlug?: string;
  status?: string;
}

/**
 * Call one of AgentBase's native MCP tools and return its decoded payload.
 *
 * The envelope is JSON-RPC around MCP: the tool's real result is a JSON string
 * inside `result.content[0].text`, and a tool-level failure sets
 * `result.isError` while the HTTP status stays 200 — so checking `res.ok`
 * alone would read an error as success.
 */
async function callNativeTool(
  base: string,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
  } catch (err) {
    return { ok: false, error: `${name} request failed: ${(err as Error)?.message ?? String(err)}` };
  }

  if (!res.ok) return { ok: false, error: `${name} returned HTTP ${res.status} ${res.statusText}` };

  const body = (await res.json()) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
    error?: { message?: string };
  };
  if (body.error) return { ok: false, error: `${name} failed: ${body.error.message ?? 'unknown error'}` };

  const text = body.result?.content?.[0]?.text ?? '';
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: `${name} returned a non-JSON payload` };
  }
  if (body.result?.isError) {
    return { ok: false, error: `${name} failed: ${text.slice(0, 200)}` };
  }
  return { ok: true, value };
}

/** The Mastra agent id this proxied card belongs to, or null if unreadable. */
async function readCardAgentId(
  base: string,
  token: string,
  org: string,
  slug: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${base}/proxy/a2a/${org}/${slug}/.well-known/agent.json`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!res.ok) return null;
    const card = (await res.json()) as { name?: unknown };
    return typeof card.name === 'string' && card.name ? card.name : null;
  } catch {
    return null;
  }
}

/**
 * Build the Mastra-id → route map from this Application's subscriptions.
 *
 * Only ACTIVE `agent` subscriptions are considered: a revoked subscription
 * cannot be invoked, so resolving to it would hand back a URL that 403s.
 */
async function runDiscovery(): Promise<DiscoveryResult> {
  const base = apiBase();
  // The placeholder counts as unset. `.env.example` ships
  // `AGENTBASE_URL=https://api.agentbase.example.com`, which is TRUTHY — so a
  // bare `!base` check lets a fresh scaffold attempt DNS against a domain that
  // does not exist, and the user sees a network error instead of the actionable
  // message below.
  if (!base || base.includes('example.com')) {
    return {
      ok: false,
      error:
        'AgentBase is enabled (the default) but AGENTBASE_URL is not configured — it is unset ' +
        'or still the placeholder from .env.example — so agent routes cannot be discovered. ' +
        'Set AGENTBASE_URL to your AgentBase API base, or set ENABLE_AGENTBASE=0 to call ' +
        'Mastra directly over A2A.',
    };
  }

  const tokenResult = await getAgentBaseAccessToken();
  if (!tokenResult.ok) return { ok: false, error: tokenResult.error };
  const token = tokenResult.accessToken;

  const listed = await callNativeTool(base, token, 'agentbase.list_subscriptions');
  if (!listed.ok) return { ok: false, error: listed.error };

  const items = ((listed.value as { items?: SubscriptionRow[] })?.items ?? []).filter(
    (row) => row.targetType === 'agent' && row.status === 'ACTIVE' && row.targetSlug && row.providerTenantSlug,
  );

  const routes = new Map<string, AgentRoute>();
  const ambiguous = new Set<string>();

  const resolved = await Promise.all(
    items.map(async (row) => ({
      org: row.providerTenantSlug as string,
      slug: row.targetSlug as string,
      agentId: await readCardAgentId(base, token, row.providerTenantSlug as string, row.targetSlug as string),
    })),
  );

  for (const entry of resolved) {
    if (!entry.agentId) continue;
    const existing = routes.get(entry.agentId);
    if (existing && (existing.org !== entry.org || existing.slug !== entry.slug)) {
      // Two subscribed agents claim the same Mastra id. Picking one silently
      // would route traffic to an arbitrary agent, so neither is kept.
      ambiguous.add(entry.agentId);
      routes.delete(entry.agentId);
      continue;
    }
    if (ambiguous.has(entry.agentId)) continue;
    routes.set(entry.agentId, {
      org: entry.org,
      slug: entry.slug,
      url: `${base}/proxy/a2a/${entry.org}/${entry.slug}`,
    });
  }

  if (ambiguous.size > 0) {
    log.warn(
      { agentIds: [...ambiguous] },
      'agentbase discovery: several subscribed agents share one Mastra id; ' +
        'they are unresolvable until one is unsubscribed or renamed. Set the ' +
        'AGENTBASE_AGENT_URL_<AGENT_ID> override to pin the intended one.',
    );
  }

  return { ok: true, routes };
}

/**
 * The route map, cached. Concurrent callers share one in-flight discovery.
 */
export async function discoverAgentRoutes(force = false): Promise<DiscoveryResult> {
  if (!force && cache && cache.expiresAt > Date.now()) {
    return { ok: true, routes: cache.routes };
  }
  if (inFlight) return inFlight;

  inFlight = runDiscovery()
    .then((result) => {
      // Only a SUCCESSFUL discovery is cached. Caching a failure would keep the
      // app broken for a full TTL after a transient blip.
      if (result.ok) cache = { routes: result.routes, expiresAt: Date.now() + TTL_MS };
      return result;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * The invocation URL for one agent.
 *
 * Order, and each step is deliberate:
 *   1. `AGENTBASE_AGENT_URL_<AGENT_ID>` — an explicit override always wins. It
 *      keeps local dev, tests, and emergency pinning working with no network.
 *   2. The discovered map.
 *   3. A miss forces exactly ONE refresh, so a re-import is picked up without a
 *      redeploy — bounded, so an id that genuinely does not exist cannot make
 *      every request re-run discovery.
 *
 * A failure NEVER degrades to a guessed URL. Guessing `/proxy/a2a/<org>/<id>`
 * is what produces the well-formed 404 this module exists to eliminate.
 */
export async function resolveAgentUrl(agentId: string): Promise<ResolveResult> {
  const override = process.env[overrideEnvVarName(agentId)];
  if (override) return { ok: true, url: override };

  let result = await discoverAgentRoutes();
  if (!result.ok) return { ok: false, error: result.error };

  let route = result.routes.get(agentId);
  if (!route) {
    result = await discoverAgentRoutes(true);
    if (!result.ok) return { ok: false, error: result.error };
    route = result.routes.get(agentId);
  }

  if (!route) {
    const known = [...result.routes.keys()].sort();
    return {
      ok: false,
      error:
        `AgentBase has no subscribed agent whose card names it "${agentId}". ` +
        (known.length
          ? `Discovered: ${known.join(', ')}. `
          : 'This Application has no ACTIVE agent subscriptions. ') +
        `Subscribe the Application to that agent's listing in AgentBase Studio, or set ` +
        `${overrideEnvVarName(agentId)} to pin its invocation URL.`,
    };
  }

  return { ok: true, url: route.url };
}
