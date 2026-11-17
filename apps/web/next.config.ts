import path from 'node:path';
import type { NextConfig } from 'next';

// The pnpm workspace root (two levels up from apps/web). Turbopack needs this
// spelled out in a monorepo, and output-file tracing uses it to find deps.
const workspaceRoot = path.join(import.meta.dirname, '..', '..');

function approvedFrameAncestor(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('PRECAST_PREVIEW_FRAME_ANCESTOR must be one exact HTTPS origin.');
  return url.origin;
}

/**
 * Sent with every response. No script-src policy: Next and StyleX inject inline
 * code, and a nonce-based policy is a project of its own. Normal deployments
 * cannot be framed. A connected scaffold preview can name one operator-approved
 * Raya HTTPS origin; X-Frame-Options is omitted only then because it cannot
 * express an exact cross-origin allowlist.
 */
export function securityHeadersFor(previewFrameAncestor?: string) {
  const ancestor = approvedFrameAncestor(previewFrameAncestor);
  return [
    {
      key: 'Content-Security-Policy',
      value: `frame-ancestors ${ancestor ?? "'none'"}; base-uri 'self'; form-action 'self'; object-src 'none'`,
    },
    ...(ancestor ? [] : [{ key: 'X-Frame-Options', value: 'DENY' }]),
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    // Ignored by browsers over plain HTTP, so harmless on localhost.
    { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  ];
}

export const SECURITY_HEADERS = securityHeadersFor(process.env.PRECAST_PREVIEW_FRAME_ANCESTOR);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  // Self-contained server bundle for the Docker runtime stage (copies
  // .next/standalone + .next/static instead of the whole workspace). The
  // production build runs on webpack (`next build --webpack`): Turbopack's
  // standalone output leaves `@swc/helpers` out of the traced pnpm packages,
  // and the server then fails at startup with "Cannot find module". `next dev`
  // stays on Turbopack.
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  // pino / pino-pretty use dynamic requires that webpack shouldn't bundle;
  // keep them external so they're required from node_modules at runtime.
  serverExternalPackages: ['pino', 'pino-pretty'],
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
