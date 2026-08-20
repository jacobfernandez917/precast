import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV4 } from '@ai-sdk/provider';

/**
 * ABIMP-LLM — lets the org admin choose which LLM (and key) an IMPORTED
 * agent uses from AgentBase Studio, without ever touching this repo's
 * `.env`. AgentBase injects these into the container at deploy time (never
 * present locally / in Standalone or External deployment mode):
 *
 *   AGENTBASE_HOSTED                       "1" on any AgentBase-hosted container
 *   AGENTBASE_LLM_BASE_URL                 shared gateway base URL
 *   AGENTBASE_LLM_MODEL_<AGENT_ID>         "<provider>/<model>", admin-chosen
 *   AGENTBASE_LLM_TOKEN_URL                shared Keycloak token endpoint
 *   AGENTBASE_LLM_CLIENT_ID_<AGENT_ID>     this agent's own service Application
 *   AGENTBASE_LLM_CLIENT_SECRET_<AGENT_ID>
 *
 * The last three are read but no longer the names to WRITE. Credentials are not
 * LLM-specific — one Application authenticates the LLM gateway, the MCP proxy
 * and the A2A proxy alike — so the canonical names drop the infix:
 *
 *   AGENTBASE_TOKEN_URL / AGENTBASE_CLIENT_ID[_<AGENT_ID>]
 *                       / AGENTBASE_CLIENT_SECRET[_<AGENT_ID>]
 *
 * Canonical wins; the AGENTBASE_LLM_* forms remain a live fallback because the
 * platform still injects them and this repo does not control the injector (see
 * `envCandidates`). Capability-specific SETTINGS keep their infix, which is why
 * AGENTBASE_LLM_BASE_URL and AGENTBASE_LLM_MODEL are unchanged above.
 *
 * `<AGENT_ID>` is this agent's own `id` (the string passed to `new Agent({id})`),
 * uppercased/underscored — mirrors `envVarNameForAgent()` in
 * apps/web/app/lib/a2a-client.ts, since one container can host several agents.
 *
 * `resolveAgentModel(agentId, fallback)` returns a model built against that
 * gateway when the agent is configured. On an AgentBase-hosted container
 * (`AGENTBASE_HOSTED=1`), an agent with NO model configured yet gets a
 * call-time-failing model — never an env key; on AgentBase the model is set
 * per agent from the org's onboarded models. Off AgentBase (local, Standalone,
 * External), it returns `fallback` unchanged. Callers pass the result of
 * `resolveDefaultModel()` (./default-model.ts) as `fallback` — either a plain
 * `"<provider>/<model>"` string for Mastra's built-in router, or (if no
 * provider key is configured) that helper's own call-time-failing model.
 */

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const REFRESH_SKEW_MS = 30_000;
const tokenCache = new Map<string, CachedToken>();

type CredentialKey = 'CLIENT_ID' | 'CLIENT_SECRET';
type AgentBaseEnvKey = CredentialKey | 'MODEL';

function agentSuffix(agentId: string): string {
  return agentId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

/** The canonical per-agent var name, used in error messages. */
function envVarName(agentId: string, key: AgentBaseEnvKey): string {
  const prefix = key === 'MODEL' ? 'AGENTBASE_LLM' : 'AGENTBASE';
  return `${prefix}_${key}_${agentSuffix(agentId)}`;
}

/**
 * The lookup order for one setting, most specific first.
 *
 * **Credentials are not LLM-specific.** One AgentBase Application authenticates
 * every capability — the LLM gateway, the MCP proxy (see agentbase-mcp.ts,
 * which mints its token with `getAgentBaseToken`), and anything added later.
 * So the canonical names carry no capability infix: `AGENTBASE_CLIENT_ID`,
 * matching what `apps/web/app/lib/agentbase-auth.ts` has always used for the
 * A2A proxy. Settings that genuinely ARE capability-specific keep their infix
 * (`AGENTBASE_LLM_BASE_URL`, `AGENTBASE_LLM_MODEL`, `AGENTBASE_MCP_BASE_URL`).
 *
 * The `AGENTBASE_LLM_*` credential names are still read, and must stay read:
 * **AgentBase injects them** into a hosted container (ADR-016) and this repo
 * does not control the injector. Dropping them would break every hosted import
 * on its next redeploy. They are legacy for humans, live for the platform.
 *
 * Two different people set these, which fixes the precedence. AgentBase injects
 * the SUFFIXED vars per agent — the org admin's choice, made in Studio. The
 * UNSUFFIXED vars are the developer's own Application credentials, written to
 * `.env` by `pnpm bootstrap --llm-provider=agentbase`, so a project can use the
 * org's onboarded models from local dev, Standalone or External mode where
 * nothing is injected. Per-agent wins deliberately: on a hosted container the
 * admin's choice must not be overridable by a value left in the repo's `.env`.
 */
function envCandidates(agentId: string, key: AgentBaseEnvKey): string[] {
  const suffix = agentSuffix(agentId);
  if (key === 'MODEL') {
    // The model IS an LLM setting — it keeps the infix and has no legacy form.
    return [`AGENTBASE_LLM_MODEL_${suffix}`, 'AGENTBASE_LLM_MODEL'];
  }
  return [
    `AGENTBASE_${key}_${suffix}`,
    `AGENTBASE_LLM_${key}_${suffix}`,
    `AGENTBASE_${key}`,
    `AGENTBASE_LLM_${key}`,
  ];
}

function agentBaseEnv(agentId: string, key: AgentBaseEnvKey): string | undefined {
  for (const name of envCandidates(agentId, key)) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

/**
 * The OAuth2 token endpoint. Identity, not capability — so the canonical name
 * is unprefixed and shared with the web app's A2A proxy auth.
 */
function tokenUrl(): string | undefined {
  return process.env.AGENTBASE_TOKEN_URL || process.env.AGENTBASE_LLM_TOKEN_URL;
}

/**
 * Is the AgentBase gateway usable at all — by either route?
 *
 * Used for the boot-time "no LLM provider configured" warning, which would
 * otherwise fire for a project that is correctly configured against AgentBase
 * and simply holds no vendor key.
 */
export function isAgentBaseLlmConfigured(agentId?: string): boolean {
  const hasCreds = agentId
    ? Boolean(agentBaseEnv(agentId, 'CLIENT_ID') && agentBaseEnv(agentId, 'CLIENT_SECRET'))
    : Boolean(
        (process.env.AGENTBASE_CLIENT_ID || process.env.AGENTBASE_LLM_CLIENT_ID) &&
          (process.env.AGENTBASE_CLIENT_SECRET || process.env.AGENTBASE_LLM_CLIENT_SECRET),
      );
  const hasGateway = Boolean(process.env.AGENTBASE_LLM_BASE_URL?.trim()) || isLlmBaseUrlDerivable();
  return Boolean(hasGateway && tokenUrl() && hasCreds);
}

/**
 * Mint (and cache) an AgentBase access token for one agent.
 *
 * Named for AgentBase, not for the LLM: the same token authenticates the MCP
 * proxy, which is why agentbase-mcp.ts imports this rather than minting its own.
 *
 * Exported for direct testing — internally called by `resolveAgentModel`'s
 * custom fetch.
 */
export async function getAgentBaseToken(agentId: string): Promise<string> {
  const now = Date.now();
  const cached = tokenCache.get(agentId);
  if (cached && cached.expiresAt - REFRESH_SKEW_MS > now) {
    return cached.accessToken;
  }

  const url = tokenUrl() ?? '';
  const clientId = agentBaseEnv(agentId, 'CLIENT_ID') ?? '';
  const clientSecret = agentBaseEnv(agentId, 'CLIENT_SECRET') ?? '';
  if (!url || !clientId || !clientSecret) {
    throw new Error(
      `AgentBase is enabled for agent "${agentId}" but its service credentials ` +
        `(AGENTBASE_TOKEN_URL / ${envVarName(agentId, 'CLIENT_ID')} / ${envVarName(agentId, 'CLIENT_SECRET')}, ` +
        `or the account-level AGENTBASE_CLIENT_ID / AGENTBASE_CLIENT_SECRET) are not fully set.`,
    );
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `AgentBase token request failed (HTTP ${res.status}) for agent "${agentId}".`,
    );
  }
  const json = (await res.json()) as TokenResponse;
  tokenCache.set(agentId, {
    accessToken: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  });
  return json.access_token;
}


/**
 * The LLM gateway base for this agent's model — injected, or DERIVED.
 *
 * The route is per-MODEL: `{AGENTBASE_URL}/proxy/llm/<org>/<slug>/v1`. It is not
 * a fixed prefix, which is why `AGENTBASE_LLM_BASE_URL` existed as a separate
 * hand-copied value at all. But `agentbase.list_models` returns both `orgSlug`
 * and `slug`, so the URL is recoverable from the model you already named in
 * `AGENTBASE_LLM_MODEL` — the same move as AGENTDISC-1 for agent routes.
 *
 * Order:
 *   1. `AGENTBASE_LLM_BASE_URL` set → use it. On a HOSTED container AgentBase
 *      injects it, and that path must keep working untouched: a hosted service
 *      application cannot call the native MCP tools (they resolve the caller
 *      through `ownerDeveloperId` and answer `developer_app_required`), so the
 *      lookup below is not available there and is never needed there.
 *   2. Otherwise derive it from `AGENTBASE_URL` + `AGENTBASE_LLM_MODEL`, using
 *      the developer's OWN application credentials — which is exactly the
 *      account-level case this removes the manual URL for.
 *
 * Resolved lazily on the first real call rather than at construction, so boot
 * neither slows down nor fails on a registry hiccup. Cached per model string.
 */
/**
 * Placeholder base the provider is constructed with, swapped for the resolved
 * one inside `fetch`. Deliberately unroutable: if the rewrite ever failed to
 * apply, the request must die locally rather than leave the machine.
 */
const SENTINEL_BASE = 'https://agentbase.invalid/llm/v1';

const baseUrlCache = new Map<string, string>();

/** Can the base URL be looked up, without doing it? Used by sync callers. */
function isLlmBaseUrlDerivable(): boolean {
  const api = process.env.AGENTBASE_URL?.trim();
  return Boolean(api && !api.includes('example.com'));
}

/** Test hook — clears the derived-base-URL cache. */
export function resetLlmBaseUrlCacheForTests(): void {
  baseUrlCache.clear();
}

export async function resolveLlmBaseUrl(agentId: string): Promise<string> {
  const injected = process.env.AGENTBASE_LLM_BASE_URL?.trim();
  if (injected) return injected;

  const api = process.env.AGENTBASE_URL?.trim().replace(/\/+$/, '');
  const wanted = agentBaseEnv(agentId, 'MODEL')?.trim();
  if (!api || api.includes('example.com') || !wanted) {
    throw new Error(
      `AgentBase LLM gateway is not resolvable for agent "${agentId}": set AGENTBASE_LLM_BASE_URL, ` +
        'or set AGENTBASE_URL (not the .env.example placeholder) plus AGENTBASE_LLM_MODEL so it ' +
        'can be looked up.',
    );
  }

  const cached = baseUrlCache.get(wanted);
  if (cached) return cached;

  const token = await getAgentBaseToken(agentId);
  const res = await fetch(`${api}/mcp`, {
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
      params: { name: 'agentbase.list_models', arguments: {} },
    }),
  });
  if (!res.ok) {
    throw new Error(`AgentBase model lookup failed (HTTP ${res.status}) for agent "${agentId}".`);
  }
  const body = (await res.json()) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  const payload = JSON.parse(body.result?.content?.[0]?.text ?? '{}') as {
    items?: Array<{ slug?: string; modelId?: string; provider?: string; orgSlug?: string }>;
  };
  const items = payload.items ?? [];

  // `AGENTBASE_LLM_MODEL` is documented as "<provider>/<model>", but a slug or a
  // bare model id are the other two things a person reasonably types. Accept all
  // three rather than making the user learn which one this field wants.
  const match = items.find(
    (m) =>
      m.slug === wanted ||
      `${m.provider}/${m.modelId}` === wanted ||
      m.modelId === wanted,
  );
  if (!match?.orgSlug || !match.slug) {
    const known = items.map((m) => m.slug).filter(Boolean).sort();
    throw new Error(
      `No subscribed AgentBase model matches AGENTBASE_LLM_MODEL="${wanted}". ` +
        (known.length ? `Available: ${known.join(', ')}. ` : 'This application has no published models. ') +
        'Use the model slug, or "<provider>/<model-id>".',
    );
  }

  const url = `${api}/proxy/llm/${match.orgSlug}/${match.slug}/v1`;
  baseUrlCache.set(wanted, url);
  return url;
}

/** True when this container is running as an AgentBase-hosted import. */
function isHostedByAgentBase(): boolean {
  return process.env.AGENTBASE_HOSTED === '1';
}

/**
 * A model whose every call fails with a clear, actionable message. Used on an
 * AgentBase-hosted container for an agent the org admin hasn't given a model
 * yet — we deliberately do NOT fall back to an env provider key here (on
 * AgentBase the model is set per agent from the org's onboarded models). The
 * failure is at CALL time, not construction time, so the container still boots
 * and can be discovered/registered on its first deploy (before any model can
 * possibly be configured).
 */
function unconfiguredHostedModel(agentId: string): LanguageModelV4 {
  const provider = createOpenAICompatible({
    name: 'agentbase',
    // Never actually contacted — the fetch below throws first.
    baseURL: process.env.AGENTBASE_LLM_BASE_URL ?? 'https://agentbase.invalid/llm/v1',
    apiKey: 'unused',
    fetch: async () => {
      throw new Error(
        `Agent "${agentId}" is hosted on AgentBase but has no model configured. ` +
          `Set it in AgentBase Studio → the agent's "LLM configuration" card ` +
          `(pick one of your org's onboarded models), then "Pull latest & redeploy". ` +
          `AgentBase-hosted agents do not read a provider key from the environment.`,
      );
    },
  });
  return provider('unconfigured');
}

/**
 * Resolves the model for an agent:
 *
 *   - **On AgentBase, configured** → a model pointed at AgentBase's LLM gateway
 *     (the org admin's chosen onboarded model; key injected server-side, never
 *     in this container).
 *   - **On AgentBase, not yet configured** → a call-time-failing model — never
 *     an env key (see `unconfiguredHostedModel`).
 *   - **Local / Standalone / External** (not AgentBase-hosted) → `fallback`
 *     unchanged: typically the result of `resolveDefaultModel()`
 *     (./default-model.ts), which auto-detects the provider key from this
 *     repo's own `.env`.
 */
export function resolveAgentModel(
  agentId: string,
  fallback: string | LanguageModelV4,
): string | LanguageModelV4 {
  const modelId = agentBaseEnv(agentId, 'MODEL');
  // Usable if the base URL is injected, OR derivable from AGENTBASE_URL + the
  // model name (see resolveLlmBaseUrl). The derivation is deliberately NOT done
  // here: this function is called during `new Agent({...})` construction and
  // must stay synchronous, and a registry call at boot would be both slow and a
  // new way for the container to fail to start.
  const canResolveBase = Boolean(
    process.env.AGENTBASE_LLM_BASE_URL?.trim() || isLlmBaseUrlDerivable(),
  );

  if (canResolveBase && modelId) {
    const provider = createOpenAICompatible({
      name: 'agentbase',
      // A sentinel, rewritten per request below. The SDK builds request URLs by
      // appending to this, so swapping the prefix at call time is what lets the
      // real base be resolved lazily without an async constructor.
      baseURL: SENTINEL_BASE,
      // Real auth is injected per-request below — AgentBase resolves the org's
      // actual provider key server-side and it never reaches this container.
      apiKey: 'unused',
      fetch: async (input, init) => {
        const base = await resolveLlmBaseUrl(agentId);
        const url = String(input).replace(SENTINEL_BASE, base);
        const token = await getAgentBaseToken(agentId);
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${token}`);
        return fetch(url, { ...init, headers });
      },
    });
    return provider(modelId);
  }

  // On AgentBase but no model chosen for this agent yet → fail loudly at call
  // time, never fall back to an env key.
  if (isHostedByAgentBase()) return unconfiguredHostedModel(agentId);

  // Not AgentBase-hosted → env-based provider key + the agent's own model.
  return fallback;
}

/** Test-only: clear the in-memory token cache between test cases. */
export function resetAgentBaseLlmTokenCacheForTests(): void {
  tokenCache.clear();
}
