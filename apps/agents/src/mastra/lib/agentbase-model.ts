import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV4 } from '@ai-sdk/provider';

/**
 * ABIMP-LLM — lets the org admin choose which LLM (and key) an IMPORTED
 * agent uses from AgentBase Studio, without ever touching this repo's
 * `.env`. AgentBase injects the vars below into the container at deploy
 * time (never present locally / in Standalone or External deployment mode):
 *
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
 * gateway when it's configured, else `fallback` unchanged — so Standalone/
 * External deployment mode and local dev keep working exactly as before
 * (direct provider call, key from this repo's own `.env`).
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

/**
 * Returns a model pointed at AgentBase's LLM gateway when the org admin has
 * configured one for `agentId`, else `fallback` unchanged (Mastra's built-in
 * model router — resolves the provider key from this repo's own `.env`).
 */
export function resolveAgentModel(agentId: string, fallback: string): string | LanguageModelV4 {
  const baseUrl = process.env.AGENTBASE_LLM_BASE_URL;
  const modelId = process.env[llmEnvVarName(agentId, 'MODEL')];
  if (!baseUrl || !modelId) return fallback;

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

/** Test-only: clear the in-memory token cache between test cases. */
export function resetAgentBaseLlmTokenCacheForTests(): void {
  tokenCache.clear();
}
