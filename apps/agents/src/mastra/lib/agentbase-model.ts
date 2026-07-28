import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV4 } from '@ai-sdk/provider';

/**
 * ABIMP-LLM — lets the org admin choose which LLM (and key) an IMPORTED
 * agent uses from AgentBase Studio, without ever touching this repo's
 * `.env`. AgentBase injects the vars below into the container at deploy
 * time (never present locally / in Standalone or External deployment mode):
 *
 *   AGENTBASE_HOSTED                       "1" on any AgentBase-hosted container
 *   AGENTBASE_LLM_BASE_URL                 shared gateway base URL
 *   AGENTBASE_LLM_TOKEN_URL                shared Keycloak token endpoint
 *   AGENTBASE_LLM_CLIENT_ID_<AGENT_ID>      this agent's own service Application
 *   AGENTBASE_LLM_CLIENT_SECRET_<AGENT_ID>
 *   AGENTBASE_LLM_MODEL_<AGENT_ID>          "<provider>/<model>", admin-chosen
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

type LlmEnvKey = 'CLIENT_ID' | 'CLIENT_SECRET' | 'MODEL';

function llmEnvVarName(agentId: string, key: LlmEnvKey): string {
  const suffix = agentId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return `AGENTBASE_LLM_${key}_${suffix}`;
}

/** Exported for direct testing — internally called by `resolveAgentModel`'s custom fetch. */
export async function getAgentBaseLlmToken(agentId: string): Promise<string> {
  const now = Date.now();
  const cached = tokenCache.get(agentId);
  if (cached && cached.expiresAt - REFRESH_SKEW_MS > now) {
    return cached.accessToken;
  }

  const tokenUrl = process.env.AGENTBASE_LLM_TOKEN_URL ?? '';
  const clientId = process.env[llmEnvVarName(agentId, 'CLIENT_ID')] ?? '';
  const clientSecret = process.env[llmEnvVarName(agentId, 'CLIENT_SECRET')] ?? '';
  if (!tokenUrl || !clientId || !clientSecret) {
    throw new Error(
      `AgentBase LLM gateway is enabled for agent "${agentId}" but its service credentials ` +
        `(AGENTBASE_LLM_TOKEN_URL / ${llmEnvVarName(agentId, 'CLIENT_ID')} / ${llmEnvVarName(agentId, 'CLIENT_SECRET')}) are not fully set.`
    );
  }

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(`AgentBase LLM gateway token request failed (HTTP ${res.status}) for agent "${agentId}".`);
  }
  const json = (await res.json()) as TokenResponse;
  tokenCache.set(agentId, { accessToken: json.access_token, expiresAt: now + json.expires_in * 1000 });
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
export function resolveAgentModel(agentId: string, fallback: string | LanguageModelV4): string | LanguageModelV4 {
  const baseUrl = process.env.AGENTBASE_LLM_BASE_URL;
  const modelId = process.env[llmEnvVarName(agentId, 'MODEL')];

  if (baseUrl && modelId) {
    const provider = createOpenAICompatible({
      name: 'agentbase',
      baseURL: baseUrl,
      // Real auth is injected per-request below — AgentBase resolves the org's
      // actual provider key server-side and it never reaches this container.
      apiKey: 'unused',
      fetch: async (input, init) => {
        const token = await getAgentBaseLlmToken(agentId);
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
