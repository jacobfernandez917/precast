import { log } from './logger';

/**
 * Mints (and caches) an AgentBase access token via the standard OAuth2
 * `client_credentials` grant — the same flow AgentBase's own "Generate token"
 * button in Studio uses under the hood, done here so a deployed server can do
 * it itself with no human in the loop.
 *
 * Setup (once, in AgentBase Studio): create a **developer Application**, then
 * copy its `clientId` / `clientSecret` / `tokenUrl` from the Application's
 * credentials panel (the secret is shown once) into `AGENTBASE_CLIENT_ID` /
 * `AGENTBASE_CLIENT_SECRET` / `AGENTBASE_TOKEN_URL`. Your Application must also
 * be **subscribed** to each agent's registry listing — even calling your own
 * imported agent goes through the same subscription check as an external
 * consumer.
 *
 * Tokens are RS256 JWTs with a short TTL (~30 min, set by the Application's
 * Keycloak client). This module never accepts a pasted/static token — it
 * mints its own and refreshes automatically before expiry.
 */

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type?: string;
}

interface CachedToken {
  accessToken: string;
  /** Epoch ms after which the cached token is considered stale. */
  expiresAt: number;
}

// Refresh a bit early so a request never races the token's real expiry.
const REFRESH_SKEW_MS = 30_000;

let cached: CachedToken | null = null;

export type AccessTokenResult = { ok: true; accessToken: string } | { ok: false; error: string };

export async function getAgentBaseAccessToken(): Promise<AccessTokenResult> {
  const now = Date.now();
  if (cached && cached.expiresAt - REFRESH_SKEW_MS > now) {
    return { ok: true, accessToken: cached.accessToken };
  }

  const tokenUrl = process.env.AGENTBASE_TOKEN_URL ?? '';
  const clientId = process.env.AGENTBASE_CLIENT_ID ?? '';
  const clientSecret = process.env.AGENTBASE_CLIENT_SECRET ?? '';

  if (!tokenUrl || !clientId || !clientSecret) {
    return {
      ok: false,
      error:
        'AgentBase is enabled but AGENTBASE_TOKEN_URL / AGENTBASE_CLIENT_ID / AGENTBASE_CLIENT_SECRET ' +
        'are not fully set. Create an Application in AgentBase Studio and copy its credentials, ' +
        'or set ENABLE_AGENTBASE=0 to call Mastra directly over A2A.',
    };
  }

  try {
    log.debug({ tokenUrl, clientId }, 'AgentBase → minting access token');
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
      const body = await res.text().catch(() => '');
      log.error({ status: res.status, body: body.slice(0, 300) }, 'AgentBase token mint failed');
      return { ok: false, error: `AgentBase token request failed (HTTP ${res.status}).` };
    }

    const json = (await res.json()) as TokenResponse;
    cached = { accessToken: json.access_token, expiresAt: now + json.expires_in * 1000 };
    log.debug({ expiresInSec: json.expires_in }, 'AgentBase ← access token minted');
    return { ok: true, accessToken: cached.accessToken };
  } catch (err) {
    log.error({ err: (err as Error).message }, 'AgentBase token mint threw');
    return { ok: false, error: 'AgentBase token request threw an error — see server logs.' };
  }
}

/** Test-only: clear the in-memory token cache between test cases. */
export function resetAgentBaseTokenCacheForTests(): void {
  cached = null;
}
