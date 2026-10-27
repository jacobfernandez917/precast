import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '../../../lib/auth';

/**
 * Better Auth's endpoints: sign-up, sign-in, sign-out, session, and the OIDC
 * callback when an identity provider is configured. See app/lib/auth.ts.
 */
export const GET = (request: Request) => toNextJsHandler(getAuth()).GET(request);
export const POST = (request: Request) => toNextJsHandler(getAuth()).POST(request);
