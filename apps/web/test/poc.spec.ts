import { describe, expect, it } from 'vitest';
import {
  APP_NAMES,
  MIN_NODE_MAJOR,
  appsFor,
  appsToRun,
  databaseProblem,
  isPortFree,
  portsFrom,
} from '../../../scripts/poc.mjs';
import { createServer } from 'node:net';

/**
 * APP-033: `pnpm poc` runs the apps natively, with no container runtime. The same production
 * bundles the Dockerfiles build (the Mastra output, Next's standalone server) start as two
 * Node processes; what each one is given, which ones run, and what stops a run before it
 * builds are pinned here. The live run (build, start, health, sign-in, a chat turn) is
 * SMOKE-026.
 */
describe('APP-033 the native preview', () => {
  const apps = appsFor({ agentsPort: 47900, webPort: 47901, localAgents: true });

  it('starts what the Dockerfiles start, with the same flags', () => {
    expect(apps.agents.cwd).toBe('apps/agents/.mastra/output');
    expect(apps.agents.command).toEqual([
      '--dns-result-order=ipv4first',
      '--import',
      './telemetry.mjs',
      'index.mjs',
    ]);
    expect(apps.web.cwd).toBe('apps/web/.next/standalone');
    expect(apps.web.command).toEqual(['--dns-result-order=ipv4first', 'apps/web/server.js']);
    expect(apps.agents.env).toMatchObject({
      NODE_ENV: 'production',
      MASTRA_TELEMETRY_DISABLED: '1',
    });
    expect(apps.web.env.NODE_ENV).toBe('production');
  });

  it('points the web app at the local agents port, and copies what the standalone server needs', () => {
    expect(apps.web.env.MASTRA_INTERNAL_URL).toBe('http://127.0.0.1:47900');
    expect(apps.web.env.PORT).toBe('47901');
    expect(apps.agents.env.MASTRA_PORT).toBe('47900');
    expect(apps.web.prepare).toEqual([
      ['apps/web/.next/static', 'apps/web/.next/standalone/apps/web/.next/static'],
      ['apps/web/public', 'apps/web/.next/standalone/apps/web/public'],
    ]);
  });

  it('counts a 401 from the agents as healthy (the probe sends no bearer), and only 2xx from the web', () => {
    expect(apps.agents.health.ok(401)).toBe(true);
    expect(apps.agents.health.ok(502)).toBe(false);
    expect(apps.web.health.ok(200)).toBe(true);
    expect(apps.web.health.ok(401)).toBe(false);
  });

  it('runs both apps, or only the web app once AgentBase hosts the agents; a named app always runs', () => {
    expect(appsToRun({})).toEqual(APP_NAMES);
    expect(appsToRun({ PRECAST_LOCAL_AGENTS: '1' })).toEqual(['agents', 'web']);
    expect(appsToRun({ PRECAST_LOCAL_AGENTS: '0' })).toEqual(['web']);
    expect(appsToRun({ PRECAST_LOCAL_AGENTS: '0' }, ['agents'])).toEqual(['agents']);
    expect(appsToRun({}, ['web'])).toEqual(['web']);
    const hosted = appsFor({ agentsPort: 1, webPort: 2, localAgents: false });
    expect(hosted.web.env.PRECAST_LOCAL_AGENTS).toBe('0');
  });

  it('reads the ports from .env, and stops before building when there is no database', () => {
    expect(portsFrom({ MASTRA_PORT: '46000', WEB_PORT: '46001' })).toEqual({
      agentsPort: 46000,
      webPort: 46001,
    });
    expect(databaseProblem({})).toMatch(/empty/);
    expect(
      databaseProblem({
        DATABASE_URL: 'postgresql://user:password@your-postgres-host:5432/your_db',
      }),
    ).toMatch(/placeholder/);
    expect(databaseProblem({ DATABASE_URL: 'postgresql://u:p@db.internal:5432/app' })).toBeNull();
    expect(MIN_NODE_MAJOR).toBeGreaterThanOrEqual(24);
  });

  it('sees a port another program holds', async () => {
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const { port } = srv.address() as { port: number };
    expect(await isPortFree(port)).toBe(false);
    await new Promise((r) => srv.close(r));
    expect(await isPortFree(port)).toBe(true);
  });
});
