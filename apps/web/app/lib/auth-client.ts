import { createAuthClient } from 'better-auth/react';

/**
 * Sign-in from the browser, against this app's own /api/auth routes. An OIDC
 * identity provider, when configured, is a social provider with the id `oidc`:
 * `authClient.signIn.social({ provider: 'oidc' })`.
 */
export const authClient = createAuthClient();
