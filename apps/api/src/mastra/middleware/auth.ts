/**
 * Mastra Hono middleware that enforces a static bearer token on agent API routes.
 *
 * Reads `AGENT_API_TOKEN` from `process.env`. When set, all requests to
 * `/api/a2a/*` and `/api/agents/*` require `Authorization: Bearer <token>`.
 * When unset, no auth is applied — the API is open (for local dev).
 *
 * The Studio playground (root `/`) and agent card discovery remain accessible
 * without auth.
 *
 * Any A2A client (JSON-RPC 2.0) can invoke the agents directly at
 * `POST /api/a2a/:agentId` by sending `Authorization: Bearer <token>` — the
 * header value MUST equal the server's `AGENT_API_TOKEN`. AgentBase is one such
 * client: it injects the token when proxying (see docs/INTEGRATION_AGENTBASE.md
 * §7). The web app never sends it directly — it always goes through AgentBase.
 */

/**
 * Paths that require authentication. The Studio playground (root `/`) and
 * agent discovery endpoints remain open for browsing.
 */
const PROTECTED_PATHS = ['/api/a2a', '/api/agents'];

/**
 * Check whether a request path should be authenticated.
 */
function isProtectedPath(path: string): boolean {
  return PROTECTED_PATHS.some((prefix) => path.startsWith(prefix));
}

/**
 * Create a Hono middleware handler that enforces a static bearer token.
 *
 * The returned function matches Hono's `MiddlewareHandler` signature:
 * `(c: Context, next: () => Promise<void>) => Promise<Response | void>`.
 * We avoid importing `hono` directly since it's a transitive dependency of
 * `@mastra/core`, not a direct dependency of this app.
 */
export function createAuthMiddleware() {
  return async (
    c: {
      req: { header: (name: string) => string | undefined; path: string };
      json: (body: Record<string, unknown>, status: number) => Response;
    },
    next: () => Promise<void>,
  ): Promise<Response | void> => {
    const token = process.env.AGENT_API_TOKEN;

    // Auth is off when token is unset.
    if (!token) {
      return next();
    }

    // Only protect agent API routes — Studio and discovery stay open.
    if (!isProtectedPath(c.req.path)) {
      return next();
    }

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

    return next();
  };
}

/**
 * Pre-configured auth middleware instance for use in the Mastra config.
 */
export const agentAuthMiddleware = createAuthMiddleware();
