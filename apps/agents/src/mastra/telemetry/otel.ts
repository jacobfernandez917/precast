import { createRequire } from 'node:module';
import { diag, DiagLogLevel, metrics, type Attributes, type Meter } from '@opentelemetry/api';
import { logs as logsApi, SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPLogExporter as OTLPLogExporterJson } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPLogExporter as OTLPLogExporterProto } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPMetricExporter as OTLPMetricExporterJson } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPMetricExporter as OTLPMetricExporterProto } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter as OTLPTraceExporterJson } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPTraceExporter as OTLPTraceExporterProto } from '@opentelemetry/exporter-trace-otlp-proto';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { logs as sdkLogs, metrics as sdkMetrics, NodeSDK, tracing } from '@opentelemetry/sdk-node';

/**
 * Telemetry for the agents container: traces, metrics and logs over OTLP to
 * AgentBase's governed endpoint (`{AGENTBASE_API}/telemetry/otlp`), plus W3C
 * trace-context continuity across the crew's in-process hops.
 *
 * Configuration is the standard OTEL_* variables and nothing else. AgentBase
 * injects them into a container it hosts (endpoint, `Authorization=Bearer …`
 * header, http/protobuf, service name, `agentbase.*` resource attributes); a
 * self-hosted agent sets OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS
 * with a key issued in Studio. The exporters are constructed with no options so
 * each reads its own per-signal endpoint, headers, protocol, timeout and
 * compression from the environment; nothing here builds a URL.
 *
 * Guarantees, each covered by telemetry.spec.ts:
 *   - No endpoint for a signal → that signal is not exported. The SDK still
 *     installs propagation, so the inbound `traceparent` from AgentBase's proxy
 *     continues across in-process crew hops and is re-injected on egress to the
 *     gateway and MCP proxy (R3). Empty processor lists are passed on purpose:
 *     given none, NodeSDK configures OTLP from the environment and defaults to
 *     http://localhost:4318.
 *   - Exported spans carry metadata only. `ContentSafeSpanExporter` keeps an
 *     allowlist of attribute keys (HTTP, URL without its query, network, model
 *     and token-usage identifiers) and drops everything else, status messages and
 *     exception messages included. Mastra bundles the AI SDK, whose spans record
 *     `ai.prompt`, `ai.response.text` and `ai.toolCall.args` whenever a caller
 *     turns its telemetry on; those never leave the container.
 *   - Log records carry a fixed event name, a severity and allowlisted
 *     attributes, correlated to the active trace. No message text.
 *   - A telemetry failure never stops the agents from serving.
 *   - SIGTERM flushes within 5 s, then the process exits as it would have.
 *
 * Start order (R2): the production container preloads this module with
 * `node --import ./telemetry.mjs` (built from ./preload.ts, see apps/agents/Dockerfile)
 * so the SDK is up before the app graph loads. `mastra/index.ts` also calls
 * `startAgentTelemetry()` as its first statement, which is what runs under
 * `mastra dev`. It is a call rather than a bare `import './telemetry/otel'`
 * because Mastra's production bundler tree-shakes with `treeshake: "smallest"`,
 * which treats modules as side-effect free and dropped that import entirely.
 */

export type Signal = 'traces' | 'metrics' | 'logs';
type Env = Record<string, string | undefined>;

const SIGNALS: Signal[] = ['traces', 'metrics', 'logs'];
const SCOPE = 'precast-agents';
const DEFAULT_SERVICE_NAME = 'precast-agents';
const SUPPORTED_PROTOCOLS = ['http/protobuf', 'http/json'];
const EXPORTER_SWITCH: Record<Signal, string> = {
  traces: 'OTEL_TRACES_EXPORTER',
  metrics: 'OTEL_METRICS_EXPORTER',
  logs: 'OTEL_LOGS_EXPORTER',
};

export const METRIC_EXPORT_INTERVAL_MS = 30_000;
export const SHUTDOWN_TIMEOUT_MS = 5_000;

const read = (env: Env, key: string): string | undefined => env[key]?.trim() || undefined;

/**
 * Where a signal exports to, resolved the way the OTLP exporters resolve it:
 * the per-signal variable as given, else the base endpoint plus `/v1/<signal>`.
 */
export function signalEndpoint(signal: Signal, env: Env = process.env): string | undefined {
  const perSignal = read(env, `OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_ENDPOINT`);
  if (perSignal) return perSignal;
  const base = read(env, 'OTEL_EXPORTER_OTLP_ENDPOINT');
  return base ? `${base.replace(/\/+$/, '')}/v1/${signal}` : undefined;
}

export function signalProtocol(signal: Signal, env: Env = process.env): string {
  return (
    read(env, `OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_PROTOCOL`) ??
    read(env, 'OTEL_EXPORTER_OTLP_PROTOCOL') ??
    'http/protobuf'
  );
}

/** Why a signal is not exported, or undefined when it is. */
export function signalDisabledReason(signal: Signal, env: Env = process.env): string | undefined {
  if (!signalEndpoint(signal, env)) return 'no endpoint';
  const exporters = read(env, EXPORTER_SWITCH[signal])
    ?.split(',')
    .map((s) => s.trim());
  if (exporters?.includes('none')) return `${EXPORTER_SWITCH[signal]}=none`;
  const protocol = signalProtocol(signal, env);
  if (!SUPPORTED_PROTOCOLS.includes(protocol)) {
    return `protocol "${protocol}" is not supported here; use http/protobuf`;
  }
  return undefined;
}

export interface SignalExporters {
  traces?: tracing.SpanExporter;
  metrics?: sdkMetrics.PushMetricExporter;
  logs?: sdkLogs.LogRecordExporter;
}

/**
 * One exporter per signal that has an endpoint. The `env` argument decides
 * which signals are on; the exporters themselves read `process.env`, which is
 * the same object everywhere except in tests.
 */
export function createSignalExporters(env: Env = process.env): SignalExporters {
  const on = (s: Signal) => signalDisabledReason(s, env) === undefined;
  const json = (s: Signal) => signalProtocol(s, env) === 'http/json';
  return {
    traces: on('traces')
      ? json('traces')
        ? new OTLPTraceExporterJson()
        : new OTLPTraceExporterProto()
      : undefined,
    metrics: on('metrics')
      ? json('metrics')
        ? new OTLPMetricExporterJson()
        : new OTLPMetricExporterProto()
      : undefined,
    logs: on('logs')
      ? json('logs')
        ? new OTLPLogExporterJson()
        : new OTLPLogExporterProto()
      : undefined,
  };
}

// ── What may leave the container ─────────────────────────────────────────────

/**
 * Attribute keys that describe a call without carrying its content. Anything
 * not matched is dropped, so a new instrumentation or a project's own span adds
 * nothing to the export until its keys are listed here.
 */
const SAFE_ATTRIBUTE_KEYS: RegExp[] = [
  /^http\.(request\.method|response\.status_code|route|method|status_code|status_text|scheme|flavor|host|user_agent|target|url)$/,
  /^http\.(request|response)\.body\.size$/,
  /^http\.(request|response)_content_length(_uncompressed)?$/,
  /^http\.server\.request\.duration$/,
  /^url\.(scheme|path|full)$/,
  /^(server|client)\.(address|port)$/,
  /^(network|net)\.[a-z_.]+$/,
  /^(error|exception)\.type$/,
  /^user_agent\.original$/,
  /^rpc\.(system|service|method|grpc\.status_code)$/,
  /^event\.name$/,
  /^otel\.[a-z_.]+$/,
  /^agentbase\.[a-z_.]+$/,
  /^gen_ai\.(system|provider\.name|operation\.name|request\.model|response\.(model|id|finish_reasons)|usage\.[a-z_]+|agent\.(id|name)|tool\.(name|call\.id|type))$/,
  /^ai\.(operationId|model\.(id|provider)|usage\.[a-zA-Z]+|response\.(finishReason|model|id)|toolCall\.(name|id))$/,
];

/**
 * Liveness probes: the Compose health check hits `GET /api/agents` every 10 s and
 * Mastra serves `/health`. Traced, they outnumber real calls on the Telemetry
 * page by orders of magnitude, so they are left out of traces and HTTP metrics.
 */
const PROBE = /^\/(api\/agents|health)\/?(\?|$)/;

export function isProbeRequest(method: string | undefined, url: string | undefined): boolean {
  return method === 'GET' && PROBE.test(url ?? '');
}

/** URL-valued keys whose query string and fragment are cut: tokens travel there. */
const URL_KEYS = new Set(['url.full', 'http.url', 'http.target']);

export function isSafeAttributeKey(key: string): boolean {
  return SAFE_ATTRIBUTE_KEYS.some((re) => re.test(key));
}

export function safeAttributes(attributes: Attributes | undefined): Attributes {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (!isSafeAttributeKey(key)) continue;
    out[key] =
      URL_KEYS.has(key) && typeof value === 'string' ? value.replace(/[?#].*$/, '') : value;
  }
  return out;
}

/**
 * The span as exported: same identity, timing, kind and status code, with
 * attributes, event attributes and link attributes filtered, and the status
 * message dropped (instrumentations copy error messages there). The original
 * span is untouched; the copy inherits everything else from it.
 */
function toSafeSpan(span: tracing.ReadableSpan): tracing.ReadableSpan {
  const safe = Object.create(span) as tracing.ReadableSpan;
  Object.defineProperties(safe, {
    attributes: { value: safeAttributes(span.attributes), enumerable: true },
    events: {
      value: span.events.map((e) => ({ ...e, attributes: safeAttributes(e.attributes) })),
      enumerable: true,
    },
    links: {
      value: span.links.map((l) => ({ ...l, attributes: safeAttributes(l.attributes) })),
      enumerable: true,
    },
    status: { value: { code: span.status.code }, enumerable: true },
  });
  return safe;
}

export class ContentSafeSpanExporter implements tracing.SpanExporter {
  constructor(private readonly inner: tracing.SpanExporter) {}

  export(
    spans: tracing.ReadableSpan[],
    resultCallback: Parameters<tracing.SpanExporter['export']>[1],
  ): void {
    this.inner.export(spans.map(toSafeSpan), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

// ── Metrics ──────────────────────────────────────────────────────────────────

/** Resident memory, V8 heap in use, and CPU use by mode since the previous reading. */
export function registerProcessGauges(meter: Meter = metrics.getMeter(SCOPE)): void {
  const memory = meter.createObservableGauge('process.memory.usage', {
    unit: 'By',
    description: 'Resident set size of the agents process.',
  });
  const heap = meter.createObservableGauge('v8js.memory.heap.used', {
    unit: 'By',
    description: 'V8 heap in use.',
  });
  const cpu = meter.createObservableGauge('process.cpu.utilization', {
    unit: '1',
    description: 'Share of one CPU used since the previous reading, by mode.',
  });

  let lastCpu = process.cpuUsage();
  let lastAt = process.hrtime.bigint();
  meter.addBatchObservableCallback(
    (result) => {
      const mem = process.memoryUsage();
      result.observe(memory, mem.rss);
      result.observe(heap, mem.heapUsed);

      const now = process.hrtime.bigint();
      const elapsedMicros = Number(now - lastAt) / 1000;
      const used = process.cpuUsage(lastCpu);
      lastCpu = process.cpuUsage();
      lastAt = now;
      if (elapsedMicros > 0) {
        result.observe(cpu, used.user / elapsedMicros, { 'cpu.mode': 'user' });
        result.observe(cpu, used.system / elapsedMicros, { 'cpu.mode': 'system' });
      }
    },
    [memory, heap, cpu],
  );
}

// ── Logs ─────────────────────────────────────────────────────────────────────

/** The only log records this container sends. A fixed name, never message text. */
export type AgentLogName = 'agent.request' | 'agents.telemetry.started';
export type AgentLogSeverity = 'INFO' | 'WARN' | 'ERROR';

const SEVERITY: Record<AgentLogSeverity, SeverityNumber> = {
  INFO: SeverityNumber.INFO,
  WARN: SeverityNumber.WARN,
  ERROR: SeverityNumber.ERROR,
};

/**
 * Emit one log record in the active trace context. Attributes go through the
 * same allowlist as span attributes. Never throws.
 */
export function emitAgentLog(
  name: AgentLogName,
  severity: AgentLogSeverity,
  attributes: Attributes = {},
): void {
  try {
    logsApi.getLogger(SCOPE).emit({
      eventName: name,
      severityNumber: SEVERITY[severity],
      severityText: severity,
      body: name,
      attributes: { ...safeAttributes(attributes), 'event.name': name },
    });
  } catch {
    // A log record is never worth a failed request.
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/** Resolves when `work` settles or after `ms`, whichever comes first. Never rejects. */
export function settleWithin(
  work: Promise<unknown>,
  ms: number = SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    work
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

type Exiter = Pick<NodeJS.Process, 'exit'>;

/**
 * Hold `proc.exit` until `work` settles. Mastra's server answers SIGTERM by
 * draining connections and calling `process.exit(0)`, which with nothing in
 * flight happens within milliseconds, before an export round trip completes.
 * Its exit still happens, with its code, once the flush is done.
 */
export function deferExitUntil(work: Promise<void>, proc: Exiter = process): void {
  const exit = proc.exit.bind(proc);
  proc.exit = ((code?: number | string | null) => {
    void work.then(() => exit(code));
  }) as unknown as Exiter['exit'];
}

/**
 * On SIGTERM, flush everything buffered (bounded at 5 s) before the process
 * goes. Adding a listener turns off Node's default exit, so when nothing else
 * handles SIGTERM the signal is raised again after the flush and the process
 * ends the way it would have without telemetry.
 */
function flushOnSigterm(sdk: NodeSDK): void {
  process.once('SIGTERM', () => {
    const flushed = settleWithin(sdk.shutdown());
    deferExitUntil(flushed);
    void flushed.then(() => {
      if (process.listenerCount('SIGTERM') === 0) process.kill(process.pid, 'SIGTERM');
    });
  });
}

/**
 * instrumentation-http patches `node:http` when it is next required. When the
 * app graph imported it before the SDK started (the `mastra dev` path, without
 * the preload), nothing would require it again. Requiring it here lands the
 * patch on the shared module object and on `Server.prototype.emit`, which every
 * server already created from it uses.
 */
function patchLoadedCoreModules(): void {
  const require = createRequire(import.meta.url);
  require('http');
  require('https');
}

const REDACT = /(Bearer\s+|ab_otel_)[^\s"',]+/gi;
const KEY_HINT =
  ' AgentBase refused the telemetry key: issue a new one in Studio (the agent page, Telemetry) and update OTEL_EXPORTER_OTLP_HEADERS.';

/**
 * One diag argument as a short phrase. Export failures arrive as a JSON string
 * of the error with its stack first and every property stringified (`code` is
 * "401", not 401); what a person needs is the name, the message, the HTTP status
 * and the response body when it is readable (a protobuf body is not).
 */
function describeDiagValue(value: unknown): string {
  let v = value;
  if (typeof v === 'string' && v.trimStart().startsWith('{')) {
    try {
      v = JSON.parse(v);
    } catch {
      return v as string;
    }
  }
  if (v && typeof v === 'object' && 'message' in v) {
    const e = v as { name?: unknown; message?: unknown; code?: unknown; data?: unknown };
    const code = Number(e.code);
    const status = Number.isInteger(code) && code > 0 ? ` (HTTP ${code})` : '';
    const body =
      typeof e.data === 'string' && e.data && !/[^\x20-\x7e]/.test(e.data)
        ? ` ${e.data.slice(0, 160)}`
        : '';
    return `${typeof e.name === 'string' ? e.name : 'Error'}: ${String(e.message)}${status}${body}`;
  }
  return typeof v === 'string' ? v : safeJson(v);
}

/** The line printed for a diag message: one line, no stack, the key cut out, a hint on 401. */
export function formatDiagLine(level: string, message: unknown, args: unknown[] = []): string {
  const text = [message, ...args]
    .map(describeDiagValue)
    .join(' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(REDACT, '$1[redacted]');
  const hint = /HTTP 401|\b401\b|telemetry_credential_required/.test(text) ? KEY_HINT : '';
  return `[otel] ${level}: ${text.slice(0, 300)}${hint}`;
}

/** Export problems as one line each, once. */
function installDiagLogger(): void {
  const seen = new Set<string>();
  const say =
    (level: string) =>
    (message: string, ...args: unknown[]): void => {
      const line = formatDiagLine(level, message, args);
      if (seen.has(line) || seen.size > 100) return;
      seen.add(line);
      console.warn(line);
    };
  const quiet = () => undefined;
  diag.setLogger(
    { error: say('error'), warn: say('warn'), info: quiet, debug: quiet, verbose: quiet },
    { logLevel: DiagLogLevel.WARN, suppressOverrideMessage: true },
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function serviceName(env: Env): string | undefined {
  const fromEnv = read(env, 'OTEL_SERVICE_NAME');
  if (fromEnv) return fromEnv;
  // A service.name in the resource attributes wins over the default.
  return /(^|,)\s*service\.name=/.test(env.OTEL_RESOURCE_ATTRIBUTES ?? '')
    ? undefined
    : DEFAULT_SERVICE_NAME;
}

export interface TelemetryState {
  sdk?: NodeSDK;
  signals: Signal[];
}

export interface StartOptions {
  env?: Env;
  /** Replaces the OTLP exporters; tests pass in-memory ones. */
  exporters?: SignalExporters;
  /** Off in tests, which must not take over the worker's SIGTERM. */
  flushOnSigterm?: boolean;
}

const STATE = Symbol.for('precast.agents.telemetry');
type Holder = { [STATE]?: TelemetryState };

/**
 * Start once per process. The preload and the app bundle each carry a copy of
 * this module, so "once" is kept on `globalThis`, not in a module variable.
 */
export function startAgentTelemetry(options: StartOptions = {}): TelemetryState {
  const holder = globalThis as Holder;
  const existing = holder[STATE];
  if (existing) return existing;

  const env = options.env ?? process.env;
  const state: TelemetryState = { signals: [] };
  holder[STATE] = state;
  if (read(env, 'OTEL_SDK_DISABLED') === 'true') return state;

  try {
    installDiagLogger();
    const exporters = options.exporters ?? createSignalExporters(env);
    const sdk = new NodeSDK({
      serviceName: serviceName(env),
      spanProcessors: exporters.traces
        ? [new tracing.BatchSpanProcessor(new ContentSafeSpanExporter(exporters.traces))]
        : [],
      metricReaders: exporters.metrics
        ? [
            new sdkMetrics.PeriodicExportingMetricReader({
              exporter: exporters.metrics,
              exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
              exportTimeoutMillis: 10_000,
            }),
          ]
        : [],
      logRecordProcessors: exporters.logs
        ? [new sdkLogs.BatchLogRecordProcessor({ exporter: exporters.logs })]
        : [],
      instrumentations: [
        // Inbound: continue the caller's W3C `traceparent`. Outbound http/https
        // and `fetch` (undici): inject the active context, so member egress to
        // AgentBase's gateway and MCP proxy joins the same trace.
        new HttpInstrumentation({
          ignoreIncomingRequestHook: (req) => isProbeRequest(req.method, req.url),
        }),
        new UndiciInstrumentation(),
      ],
    });
    sdk.start();
    patchLoadedCoreModules();
    if (exporters.metrics) registerProcessGauges();
    if (options.flushOnSigterm !== false) flushOnSigterm(sdk);

    state.sdk = sdk;
    state.signals = SIGNALS.filter((s) => exporters[s]);
    if (state.signals.length) {
      const host = hostOf(signalEndpoint(state.signals[0], env));
      console.info(`[otel] exporting ${state.signals.join(', ')}${host ? ` to ${host}` : ''}`);
      emitAgentLog('agents.telemetry.started', 'INFO');
    }
  } catch (err) {
    // Telemetry is never load-bearing for serving agents.
    console.warn(`[otel] agent telemetry disabled: ${(err as Error)?.message ?? String(err)}`);
  }
  return state;
}

function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).host : undefined;
  } catch {
    return undefined;
  }
}

/** Test-only: forget the started SDK so a spec can start a fresh one. */
export async function resetAgentTelemetryForTests(): Promise<void> {
  const holder = globalThis as Holder;
  await holder[STATE]?.sdk?.shutdown().catch(() => undefined);
  delete holder[STATE];
}
