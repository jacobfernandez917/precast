import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import nextConfig, { SECURITY_HEADERS } from '../next.config';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** WEB-025: every response carries the security headers, and no X-Powered-By. */
describe('security headers', () => {
  it('forbid framing and sniffing, and drop the framework banner', async () => {
    const byKey = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(byKey['X-Frame-Options']).toBe('DENY');
    expect(byKey['X-Content-Type-Options']).toBe('nosniff');
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(await nextConfig.headers!()).toEqual([{ source: '/:path*', headers: SECURITY_HEADERS }]);
  });
});

/** APP-029: the apps listen on this computer only, not on the network it is on. */
describe('local runs bind to 127.0.0.1', () => {
  it('pnpm poc starts both apps on 127.0.0.1, and the env defaults agree', async () => {
    const { appsFor, LOCAL_HOST } = await import('../../../scripts/poc.mjs');
    expect(LOCAL_HOST).toBe('127.0.0.1');
    const apps = appsFor({ agentsPort: 45000, webPort: 45001, localAgents: true });
    expect(apps.agents.env.MASTRA_HOST).toBe('127.0.0.1');
    expect(apps.web.env.HOSTNAME).toBe('127.0.0.1');
    const example = readFileSync(`${ROOT}.env.example`, 'utf8');
    expect(example).toMatch(/^MASTRA_HOST=127\.0\.0\.1$/m);
    expect(example).toMatch(/^WEB_HOST=127\.0\.0\.1$/m);
  });
});
