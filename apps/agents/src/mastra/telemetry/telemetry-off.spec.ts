import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { context, metrics, trace } from '@opentelemetry/api';
import { core } from '@opentelemetry/sdk-node';
import { resetAgentTelemetryForTests, startAgentTelemetry, type TelemetryState } from './otel';

/**
 * The SDK started the way a container with no OTEL_* settings starts it: no
 * export of any signal, and context propagation still in place. Plus the
 * structural guards that make the production container start telemetry before
 * the app graph (APP-026), which only fail silently otherwise.
 */

const INBOUND_TRACE = '0af7651916cd43dd8448eb211c80319c';
const TRACEPARENT = `00-${INBOUND_TRACE}-b7ad6b7169203331-01`;

let state: TelemetryState;
let agent: Server;
let gateway: Server;
const gatewaySaw: Array<string | undefined> = [];

async function listen(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  state = startAgentTelemetry({ env: {}, flushOnSigterm: false });
  gateway = createServer((req, res) => {
    gatewaySaw.push(req.headers.traceparent as string | undefined);
    res.end('{}');
  });
  const gatewayUrl = await listen(gateway);
  agent = createServer((req, res) => {
    req.resume();
    req.on('end', async () => {
      await new Promise((r) => setImmediate(r));
      await fetch(gatewayUrl, { method: 'POST', body: '{}' });
      res.end('ok');
    });
  });
  const agentUrl = await listen(agent);
  await context.with(core.suppressTracing(context.active()), () =>
    fetch(agentUrl, { method: 'POST', headers: { traceparent: TRACEPARENT }, body: '{}' }),
  );
});

afterAll(async () => {
  await new Promise((r) => agent.close(r));
  await new Promise((r) => gateway.close(r));
  await resetAgentTelemetryForTests();
});

describe('AGT-019 no endpoint: nothing is exported, nothing crashes, context still propagates', () => {
  it('starts with no signal and no SDK error', () => {
    expect(state.signals).toEqual([]);
    expect(state.sdk).toBeDefined();
  });

  it('registers no recording tracer and no meter provider, so there is nothing to send anywhere', () => {
    expect(trace.getTracer('t').startSpan('s').isRecording()).toBe(false);
    expect(metrics.getMeterProvider().constructor.name).toBe('NoopMeterProvider');
  });

  it('still carries the inbound trace id across the in-process hop to egress', () => {
    expect(gatewaySaw).toHaveLength(1);
    expect((gatewaySaw[0] ?? '').split('-')[1]).toBe(INBOUND_TRACE);
  });
});

describe('APP-026 the production container starts telemetry before the app graph', () => {
  const root = fileURLToPath(new URL('../../../../../', import.meta.url));
  const read = (rel: string) => readFileSync(`${root}${rel}`, 'utf8');

  it('the Dockerfile CMD preloads telemetry.mjs ahead of index.mjs', () => {
    const cmd = read('apps/agents/Dockerfile').match(/^CMD\s+(\[.*\])\s*$/m)?.[1];
    expect(cmd, 'apps/agents/Dockerfile must have an exec-form CMD').toBeTruthy();
    const args = JSON.parse(cmd as string) as string[];
    const preload = args.indexOf('./telemetry.mjs');
    expect(args[preload - 1]).toBe('--import');
    expect(preload).toBeLessThan(args.indexOf('index.mjs'));
  });

  it('the build emits telemetry.mjs next to the bundle, and the image build checks it is there', () => {
    const pkg = JSON.parse(read('apps/agents/package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts.build).toMatch(/build:telemetry/);
    expect(pkg.scripts['build:telemetry']).toMatch(/src\/mastra\/telemetry\/preload\.ts/);
    expect(pkg.scripts['build:telemetry']).toMatch(/--packages=external/);
    expect(pkg.scripts['build:telemetry']).toMatch(/--outfile=\.mastra\/output\/telemetry\.mjs/);
    expect(read('apps/agents/Dockerfile')).toMatch(
      /test -f apps\/agents\/\.mastra\/output\/telemetry\.mjs/,
    );
  });

  it('index.ts starts telemetry with a call, which the bundler cannot tree-shake away', () => {
    const index = read('apps/agents/src/mastra/index.ts');
    expect(index).not.toMatch(/^import ['"]\.\/telemetry\/otel['"];?$/m);
    expect(index).toMatch(/^startAgentTelemetry\(\);$/m);
  });
});

describe('APP-027 Mastra usage analytics are off wherever Mastra runs', () => {
  const root = fileURLToPath(new URL('../../../../../', import.meta.url));
  const read = (rel: string) => readFileSync(`${root}${rel}`, 'utf8');

  it('the runtime image sets MASTRA_TELEMETRY_DISABLED=1', () => {
    const dockerfile = read('apps/agents/Dockerfile');
    const runtime = dockerfile.slice(dockerfile.search(/^FROM .* AS runtime$/m));
    expect(runtime).toMatch(/^ENV MASTRA_TELEMETRY_DISABLED=1$/m);
  });

  it('every agents script that runs the Mastra CLI sets it for that command', () => {
    const { scripts } = JSON.parse(read('apps/agents/package.json')) as {
      scripts: Record<string, string>;
    };
    const cli = Object.entries(scripts).flatMap(([name, cmd]) =>
      cmd
        .split('&&')
        .filter((part) => /\bmastra (dev|build|start)\b/.test(part))
        .map((part) => [name, part.trim()] as const),
    );
    expect(cli.length).toBeGreaterThanOrEqual(4);
    for (const [name, part] of cli) {
      expect(part, `script "${name}" runs the Mastra CLI with analytics on`).toMatch(
        /dotenv (-v \S+ )*-v MASTRA_TELEMETRY_DISABLED=1\b/,
      );
    }
  });
});
