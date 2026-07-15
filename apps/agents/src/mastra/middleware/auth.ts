import type { AgentCard, SecurityScheme } from '@a2a-js/sdk';

/**
 * Mastra Hono middleware with two jobs:
 *
 *  1. **Enforce** a static bearer token (`AGENT_API_TOKEN`) on the agent API
 *     routes (`/api/a2a/*`, `/api/agents/*`). When the token is unset, auth is
 *     off — the API is open (local dev). Studio (`/`) and agent-card discovery
 *     stay readable without auth.
 *
 *  2. **Advertise** that bearer scheme on the A2A agent card when the token is
 *     set. Mastra owns the `/.well-known/:id/agent-card.json` route and emits an
 *     empty `securitySchemes`/`security` ("public agent") with no config hook,
 *     so we augment its response here — declaring the scheme with the official
 *     `@a2a-js/sdk` types for a standards-correct card. Only the *scheme* is
 *     declared; credentials never go in the card (per A2A).
 *
 * Any A2A client (JSON-RPC 2.0) invokes agents at `POST /api/a2a/:agentId` with
 * `Authorization: Bearer <AGENT_API_TOKEN>`; AgentBase injects it when proxying
 * (see docs/INTEGRATION_AGENTBASE.md §7).
 */

/** Paths that require the bearer token when `AGENT_API_TOKEN` is set. */
const PROTECTED_PATHS = ['/api/a2a', '/api/agents'];

function isProtectedPath(path: string): boolean {
  return PROTECTED_PATHS.some((prefix) => path.startsWith(prefix));
}

/** A2A agent-card discovery path: `/api/.well-known/:agentId/agent-card.json`. */
function isAgentCardPath(path: string): boolean {
  return path.startsWith('/api/.well-known/') && path.endsWith('/agent-card.json');
}

/** The static-bearer scheme this server enforces (A2A / OpenAPI `http`+`bearer`). */
const BEARER_SCHEME: SecurityScheme = {
  type: 'http',
  scheme: 'bearer',
  description: 'Static bearer token; the value must equal the server AGENT_API_TOKEN.',
};

/** Minimal slice of Hono's Context we rely on (avoids a direct `hono` dep). */
interface MinimalContext {
  req: { header: (name: string) => string | undefined; path: string };
  json: (body: Record<string, unknown>, status: number) => Response;
  res: Response;
}

/**
 * Rewrite the A2A agent-card response to declare the static-bearer security
 * scheme, using the official `@a2a-js/sdk` `AgentCard`/`SecurityScheme` types.
 * Leaves the card untouched if it isn't the expected JSON shape.
 */
async function advertiseBearerOnCard(c: MinimalContext): Promise<void> {
  try {
    const card = (await c.res.clone().json()) as AgentCard;
    if (!card || typeof card !== 'object') return;

    card.securitySchemes = { bearerAuth: BEARER_SCHEME };
    card.security = [{ bearerAuth: [] }];

    const headers = new Headers(c.res.headers);
    headers.delete('content-length'); // body length changed after the rewrite
    c.res = new Response(JSON.stringify(card), { status: c.res.status, headers });
  } catch {
    // Not JSON / unexpected shape — leave the card as Mastra produced it.
  }
}

/**
 * Create the Hono middleware handler. Matches Hono's `MiddlewareHandler`:
 * `(c, next) => Promise<Response | void>`.
 */
export function createAuthMiddleware() {
  return async (c: MinimalContext, next: () => Promise<void>): Promise<Response | void> => {
    const token = process.env.AGENT_API_TOKEN;

    // 1. Enforce the bearer on protected routes (only when a token is configured).
    if (token && isProtectedPath(c.req.path)) {
      const authHeader = c.req.header('Authorization');
      if (!authHeader || authHeader !== `Bearer ${token}`) {
        return c.json(
          {
            success: false,
            error: 'Unauthorized',
            message:
              'Missing or invalid bearer token. Provide Authorization: Bearer <AGENT_API_TOKEN>',
          },
          401,
        );
      }
    }

    await next();

    // 2. When auth is on, make the agent card advertise the bearer scheme.
    if (token && isAgentCardPath(c.req.path)) {
      await advertiseBearerOnCard(c);
    }
  };
}

/**
 * Pre-configured auth middleware instance for use in the Mastra config.
 */
export const agentAuthMiddleware = createAuthMiddleware();
