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
  return Boolean(process.env.AGENTBASE_LLM_BASE_URL && tokenUrl() && hasCreds);
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
  const baseUrl = process.env.AGENTBASE_LLM_BASE_URL;
  const modelId = agentBaseEnv(agentId, 'MODEL');

  if (baseUrl && modelId) {
    const provider = createOpenAICompatible({
      name: 'agentbase',
      baseURL: baseUrl,
      // Real auth is injected per-request below — AgentBase resolves the org's
      // actual provider key server-side and it never reaches this container.
      apiKey: 'unused',
      fetch: async (input, init) => {
        const token = await getAgentBaseToken(agentId);
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${token}`);
        return fetch(input, { ...init, headers });
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
