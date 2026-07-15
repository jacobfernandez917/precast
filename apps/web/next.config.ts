import path from 'node:path';
import type { NextConfig } from 'next';

// The pnpm workspace root (two levels up from apps/web). Turbopack needs this
// spelled out in a monorepo, and output-file tracing uses it to find deps.
const workspaceRoot = path.join(import.meta.dirname, '..', '..');

// Astryx 0.1.5 ships components compiled against React's *development* JSX
// runtime (`jsxDEV`), which React sets to `undefined` in production. That
// breaks SSR in a production build, so we alias `react/jsx-dev-runtime` to a
// shim mapping `jsxDEV` → the production `jsx`. webpack's resolve.alias applies
// across every compiler layer (incl. the react-server/SSR layer), which is why
// the production build runs on webpack; `next dev` stays on Turbopack where the
// real dev runtime is present and no shim is needed. Revisit once Astryx ships
// a production build.
const isProd = process.env.NODE_ENV === 'production';
const jsxDevShim = path.join(import.meta.dirname, 'jsx-dev-runtime.shim.ts');

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker runtime stage (copies
  // .next/standalone + .next/static instead of the whole workspace).
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  webpack: (config) => {
    if (isProd) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'react/jsx-dev-runtime': jsxDevShim,
      };
    }
    return config;
  },
};

export default nextConfig;
