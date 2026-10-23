import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logs as sdkLogs, metrics as sdkMetrics, tracing } from '@opentelemetry/sdk-node';
import {
  createSignalExporters,
  deferExitUntil,
  formatDiagLine,
  registerProcessGauges,
  resetAgentTelemetryForTests,
  safeAttributes,
  isProbeRequest,
  settleWithin,
  signalDisabledReason,
  signalEndpoint,
  signalProtocol,
  startAgentTelemetry,
} from './otel';
import { createTelemetryMiddleware } from '../middleware/telemetry';

/**
 * Telemetry configuration, exporters and the content policy, with no SDK
 * running in this process (telemetry-on.spec.ts and telemetry-off.spec.ts start
 * one each; a started SDK is process-global, so they live in their own files).
 *
 * The exporters are exercised against a local OTLP receiver rather than by
 * reading their private config: what matters is where the bytes go, with which
 * header and content type, and those are observable on the wire.
 */

const KEY = 'ab_otel_11111111-2222-3333-4444-555555555555.s3cretpart';
const OTEL_KEYS = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  ...['TRACES', 'METRICS', 'LOGS'].flatMap((s) => [
    `OTEL_EXPORTER_OTLP_${s}_ENDPOINT`,
    `OTEL_EXPORTER_OTLP_${s}_HEADERS`,
    `OTEL_EXPORTER_OTLP_${s}_PROTOCOL`,
  ]),
  'OTEL_TRACES_EXPORTER',
  'OTEL_METRICS_EXPORTER',
  'OTEL_LOGS_EXPORTER',
];
const saved = Object.fromEntries(OTEL_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of OTEL_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  bytes: number;
}

async function otlpReceiver() {
  const got: Received[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      got.push({ path: req.url ?? '', headers: req.headers, bytes: Buffer.concat(chunks).length });
      res.writeHead(200, { 'content-type': req.headers['content-type'] ?? 'application/json' });
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    got,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Push one item of each signal through the given exporters and wait for delivery. */
async function sendOneOfEach(exporters: ReturnType<typeof createSignalExporters>) {
  if (exporters.traces) {
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: [new tracing.SimpleSpanProcessor(exporters.traces)],
    });
    provider.getTracer('t').startSpan('one').end();
    await provider.forceFlush();
    await provider.shutdown();
  }
  if (exporters.metrics) {
    const reader = new sdkMetrics.PeriodicExportingMetricReader({
      exporter: exporters.metrics,
      exportIntervalMillis: 60_000,
    });
    const provider = new sdkMetrics.MeterProvider({ readers: [reader] });
    provider.getMeter('t').createCounter('one').add(1);
    // shutdown collects and exports once; a forceFlush before it would send a second batch.
    await provider.shutdown();
  }
  if (exporters.logs) {
    const provider = new sdkLogs.LoggerProvider({
      processors: [new sdkLogs.SimpleLogRecordProcessor({ exporter: exporters.logs })],
    });
    provider.getLogger('t').emit({ body: 'agent.request' });
    await provider.forceFlush();
    await provider.shutdown();
  }
}

describe('AGT-017 exporters are configured from the standard OTEL_* variables', () => {
  it('resolves endpoints the way the exporters do: per-signal as given, else base + /v1/<signal>', () => {
    const env = {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://api.agentbase.test/telemetry/otlp/',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://logs.agentbase.test/custom',
    };
    expect(signalEndpoint('traces', env)).toBe(
      'https://api.agentbase.test/telemetry/otlp/v1/traces',
    );
    expect(signalEndpoint('metrics', env)).toBe(
      'https://api.agentbase.test/telemetry/otlp/v1/metrics',
    );
    expect(signalEndpoint('logs', env)).toBe('https://logs.agentbase.test/custom');
  });

  it('defaults to http/protobuf, lets a per-signal protocol win, and refuses grpc', () => {
    expect(signalProtocol('traces', {})).toBe('http/protobuf');
    const env = {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://x.test',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: 'grpc',
    };
    expect(signalProtocol('traces', env)).toBe('http/json');
    expect(signalDisabledReason('traces', env)).toBeUndefined();
    expect(signalDisabledReason('metrics', env)).toMatch(/"grpc" is not supported/);
    expect(createSignalExporters(env).metrics).toBeUndefined();
  });

  it('honours OTEL_<SIGNAL>_EXPORTER=none for one signal', () => {
    const env = { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://x.test', OTEL_LOGS_EXPORTER: 'none' };
    expect(signalDisabledReason('logs', env)).toBe('OTEL_LOGS_EXPORTER=none');
    expect(signalDisabledReason('traces', env)).toBeUndefined();
  });

  it('sends traces, metrics and logs as protobuf to base + /v1/<signal>', async () => {
    const rx = await otlpReceiver();
    try {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `${rx.url}/telemetry/otlp`;
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/protobuf';
      await sendOneOfEach(createSignalExporters());
      expect(rx.got.map((g) => g.path).sort()).toEqual([
        '/telemetry/otlp/v1/logs',
        '/telemetry/otlp/v1/metrics',
        '/telemetry/otlp/v1/traces',
      ]);
      for (const g of rx.got) {
        expect(g.headers['content-type']).toBe('application/x-protobuf');
        expect(g.bytes).toBeGreaterThan(0);
      }
    } finally {
      await rx.close();
    }
  });

  it('lets per-signal endpoint and protocol override the base, as AgentBase injects them', async () => {
    const rx = await otlpReceiver();
    try {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `${rx.url}/base`;
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `${rx.url}/exact/traces`;
      process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL = 'http/json';
      await sendOneOfEach(createSignalExporters());
      const byPath = Object.fromEntries(rx.got.map((g) => [g.path, g]));
      expect(Object.keys(byPath).sort()).toEqual([
        '/base/v1/logs',
        '/base/v1/metrics',
        '/exact/traces',
      ]);
      expect(byPath['/base/v1/logs'].headers['content-type']).toBe('application/json');
      expect(byPath['/exact/traces'].headers['content-type']).toBe('application/x-protobuf');
    } finally {
      await rx.close();
    }
  });
});

describe('AGT-018 the bearer header from OTEL_EXPORTER_OTLP_HEADERS reaches AgentBase', () => {
  it('decodes Authorization=Bearer%20<key> and sends it on every signal', async () => {
    const rx = await otlpReceiver();
    try {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = rx.url;
      process.env.OTEL_EXPORTER_OTLP_HEADERS = `Authorization=Bearer%20${KEY}`;
      await sendOneOfEach(createSignalExporters());
      expect(rx.got).toHaveLength(3);
      for (const g of rx.got) expect(g.headers.authorization).toBe(`Bearer ${KEY}`);
    } finally {
      await rx.close();
    }
  });

  it('uses a per-signal header when one is set', async () => {
    const rx = await otlpReceiver();
    try {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = rx.url;
      process.env.OTEL_EXPORTER_OTLP_HEADERS = `Authorization=Bearer%20${KEY}`;
      process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS = 'Authorization=Bearer%20ab_otel_traces.only';
      await sendOneOfEach(createSignalExporters());
      const traces = rx.got.find((g) => g.path === '/v1/traces');
      expect(traces?.headers.authorization).toBe('Bearer ab_otel_traces.only');
      expect(rx.got.find((g) => g.path === '/v1/logs')?.headers.authorization).toBe(
        `Bearer ${KEY}`,
      );
    } finally {
      await rx.close();
    }
  });
});

describe('AGT-019 no endpoint means no export and no crash', () => {
  it('builds no exporter for any signal', () => {
    expect(createSignalExporters({})).toEqual({
      traces: undefined,
      metrics: undefined,
      logs: undefined,
    });
    for (const s of ['traces', 'metrics', 'logs'] as const) {
      expect(signalDisabledReason(s, {})).toBe('no endpoint');
    }
  });

  it('a failure while starting is reported in one line and the process carries on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const exploding = {
        get traces(): never {
          throw new Error('exporter blew up');
        },
      };
      const state = startAgentTelemetry({ exporters: exploding, flushOnSigterm: false });
      expect(state.signals).toEqual([]);
      expect(warn).toHaveBeenCalledWith('[otel] agent telemetry disabled: exporter blew up');
    } finally {
      warn.mockRestore();
      await resetAgentTelemetryForTests();
    }
  });
});

describe('AGT-021 the content policy on exported attributes', () => {
  it('keeps call metadata and drops prompts, completions, tool arguments and credentials', () => {
    const out = safeAttributes({
      'http.request.method': 'POST',
      'http.response.status_code': 200,
      'url.full': 'https://api.agentbase.test/proxy/llm/o/m/v1/chat?api_key=leak#frag',
      'http.target': '/api/a2a/example-agent?token=leak',
      'ai.model.id': 'gemini-3.5-flash',
      'ai.usage.promptTokens': 12,
      'gen_ai.agent.id': 'example-agent',
      'ai.prompt': 'my card number is 4111',
      'ai.prompt.messages': '[{"role":"user"}]',
      'ai.response.text': 'here is the answer',
      'ai.toolCall.args': '{"to":"someone"}',
      'ai.telemetry.metadata.userId': 'u-1',
      'http.request.header.authorization': 'Bearer leak',
      'exception.message': 'failed for 4111',
      'exception.stacktrace': 'Error: failed for 4111',
      'project.custom': 'anything',
    });
    expect(out).toEqual({
      'http.request.method': 'POST',
      'http.response.status_code': 200,
      'url.full': 'https://api.agentbase.test/proxy/llm/o/m/v1/chat',
      'http.target': '/api/a2a/example-agent',
      'ai.model.id': 'gemini-3.5-flash',
      'ai.usage.promptTokens': 12,
      'gen_ai.agent.id': 'example-agent',
    });
  });
});

describe('AGT-023 which requests count as liveness probes', () => {
  it('matches GET /api/agents and /health only', () => {
    expect(isProbeRequest('GET', '/api/agents')).toBe(true);
    expect(isProbeRequest('GET', '/api/agents/')).toBe(true);
    expect(isProbeRequest('GET', '/health')).toBe(true);
    expect(isProbeRequest('GET', '/api/agents?x=1')).toBe(true);
    expect(isProbeRequest('POST', '/api/agents')).toBe(false);
    expect(isProbeRequest('GET', '/api/agents/example-agent')).toBe(false);
    expect(isProbeRequest('POST', '/api/a2a/example-agent')).toBe(false);
    expect(isProbeRequest('GET', '/api/.well-known/example-agent/agent-card.json')).toBe(false);
  });
});

describe('AGT-019 an export failure is one readable line', () => {
  it('turns the exporter error JSON into name, message and status, with no stack and a key hint on 401', () => {
    const fromSdk = JSON.stringify({
      stack:
        'OTLPExporterError: Unauthorized\n    at IncomingMessage.<anonymous> (/app/node_modules/x.js:75:35)',
      message: 'Unauthorized',
      name: 'OTLPExporterError',
      code: '401',
      data: '{"code":16,"message":"telemetry_credential_required"}',
    });
    const line = formatDiagLine('error', fromSdk);
    expect(line).toMatch(
      /^\[otel\] error: OTLPExporterError: Unauthorized \(HTTP 401\) \{"code":16,"message":"telemetry_credential_required"\}/,
    );
    expect(line).toContain('issue a new one in Studio');
    expect(line).not.toContain('node_modules');
    expect(line).not.toContain('\n');
  });

  it('leaves out a protobuf response body, which is not readable as text', () => {
    const line = formatDiagLine(
      'error',
      JSON.stringify({
        message: 'Unauthorized',
        name: 'OTLPExporterError',
        code: '401',
        data: '\b\u0010\u0012\u001dtelemetry',
      }),
    );
    expect(line).toMatch(
      /^\[otel\] error: OTLPExporterError: Unauthorized \(HTTP 401\) AgentBase refused/,
    );
  });

  it('cuts a key out of anything it prints', () => {
    const line = formatDiagLine('warn', 'header was Authorization=Bearer ab_otel_abc.def', []);
    expect(line).not.toContain('abc.def');
    expect(line).toContain('Bearer [redacted]');
  });
});

describe('AGT-022 shutdown and the per-call log', () => {
  it('settleWithin gives up after the deadline and never rejects', async () => {
    const started = Date.now();
    await settleWithin(new Promise(() => undefined), 50);
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    await expect(settleWithin(Promise.reject(new Error('flush failed')), 1_000)).resolves.toBe(
      undefined,
    );
  });

  it("holds the server's own exit until the flush settles, then exits with its code", async () => {
    const exit = vi.fn();
    const proc = { exit } as unknown as Pick<NodeJS.Process, 'exit'>;
    let finish!: () => void;
    deferExitUntil(new Promise<void>((r) => (finish = r)), proc);
    proc.exit(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(exit).not.toHaveBeenCalled();
    finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('the flush deadline is 5 s and metrics are read every 30 s', () => {
    const src = readFileSync(fileURLToPath(new URL('./otel.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/SHUTDOWN_TIMEOUT_MS = 5_000/);
    expect(src).toMatch(/METRIC_EXPORT_INTERVAL_MS = 30_000/);
  });

  it('process gauges report memory, heap and CPU by mode', async () => {
    const exporter = new sdkMetrics.InMemoryMetricExporter(
      sdkMetrics.AggregationTemporality.CUMULATIVE,
    );
    const reader = new sdkMetrics.PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    });
    const provider = new sdkMetrics.MeterProvider({ readers: [reader] });
    registerProcessGauges(provider.getMeter('t'));
    await new Promise((r) => setTimeout(r, 20));
    await provider.forceFlush();
    const points = exporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics))
      .map((m) => [m.descriptor.name, m.dataPoints] as const);
    const byName = Object.fromEntries(points);
    expect(Object.keys(byName).sort()).toEqual([
      'process.cpu.utilization',
      'process.memory.usage',
      'v8js.memory.heap.used',
    ]);
    expect(byName['process.memory.usage'][0].value).toBeGreaterThan(0);
    expect(byName['process.cpu.utilization'].map((p) => p.attributes['cpu.mode']).sort()).toEqual([
      'system',
      'user',
    ]);
    await provider.shutdown();
  });

  function middlewareCall(path: string, method: string, status: number | Error) {
    const emit = vi.fn();
    let t = 0;
    const mw = createTelemetryMiddleware(emit, () => (t += 250));
    const c = { req: { path, method }, res: undefined as Response | undefined };
    const next = async () => {
      if (status instanceof Error) throw status;
      c.res = new Response(null, { status });
    };
    return { emit, run: () => mw(c, next) };
  }

  it('logs one record per A2A call with the agent, status and duration, severity by status', async () => {
    const ok = middlewareCall('/api/a2a/example-agent', 'POST', 200);
    await ok.run();
    expect(ok.emit).toHaveBeenCalledWith('agent.request', 'INFO', {
      'gen_ai.agent.id': 'example-agent',
      'http.request.method': 'POST',
      'http.response.status_code': 200,
      'http.server.request.duration': 0.25,
    });

    const refused = middlewareCall('/api/a2a/example-agent', 'POST', 401);
    await refused.run();
    expect(refused.emit.mock.calls[0][1]).toBe('WARN');

    const crashed = middlewareCall('/api/a2a/example-agent', 'POST', new Error('boom'));
    await expect(crashed.run()).rejects.toThrow('boom');
    expect(crashed.emit.mock.calls[0][1]).toBe('ERROR');
    expect(crashed.emit.mock.calls[0][2]['http.response.status_code']).toBe(500);
  });

  it('leaves health checks and agent cards out', async () => {
    for (const [path, method] of [
      ['/api/agents', 'GET'],
      ['/api/.well-known/example-agent/agent-card.json', 'GET'],
      ['/api/a2a/example-agent', 'GET'],
    ]) {
      const call = middlewareCall(path, method, 200);
      await call.run();
      expect(call.emit).not.toHaveBeenCalled();
    }
  });
});
