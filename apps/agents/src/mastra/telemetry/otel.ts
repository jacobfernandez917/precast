import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';

/**
 * CREW-1 / R2–R3 — distributed-trace continuity for the agents container.
 *
 * When an orchestrator crew runs in-process (see `crew.ts`), the routing hops
 * from the orchestrator to its members never touch the network, so they leave
 * no proxy `audit_calls` row — only spans. For those spans (and the member
 * egress that DOES hit AgentBase's gateway) to stitch into one trace with
 * AgentBase's audit ledger, this container must:
 *
 *   R2 — start the OpenTelemetry SDK **before any other import** so the W3C
 *        propagator + HTTP/fetch instrumentation are in place before the Mastra
 *        server handles a request. (This module is imported first from
 *        `mastra/index.ts`; the production container also preloads it via
 *        `node --import` — see apps/agents/Dockerfile — because ESM patching
 *        must happen before the app graph loads.)
 *   R3 — continue the inbound `traceparent` (AgentBase's proxy injects it, R1)
 *        across the in-process orchestrator→member calls (same async context)
 *        and re-inject it on egress back to AgentBase's gateway / MCP proxy, so
 *        those hops join the same trace.
 *
 * Span EXPORT is best-effort and gated on `OTEL_EXPORTER_OTLP_ENDPOINT`, which
 * AgentBase injects into hosted containers (R5). With no endpoint the SDK still
 * installs propagation, so calls remain stitchable via `audit_calls` even
 * though the in-process routing spans aren't exported (the plan §5 gap). A
 * telemetry init failure must never stop the agents from serving.
 */
let started = false;

export function startAgentTelemetry(): void {
  if (started) return;
  started = true;

  try {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
    const sdk = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME?.trim() || 'precast-agents',
      // Export only when a backend is configured; otherwise run purely for
      // context propagation (see R3 above).
      traceExporter: endpoint
        ? new OTLPTraceExporter({ url: `${endpoint.replace(/\/+$/, '')}/v1/traces` })
        : undefined,
      instrumentations: [
        // Inbound: extract the caller's W3C `traceparent`. Outbound http/https
        // and `fetch` (Node's undici): inject the active context's traceparent
        // so member egress to AgentBase's gateway/MCP joins the same trace.
        new HttpInstrumentation(),
        new UndiciInstrumentation(),
      ],
    });
    sdk.start();
    process.once('SIGTERM', () => void sdk.shutdown().catch(() => undefined));
  } catch (err) {
    // Telemetry is never load-bearing for serving agents (mirrors AgentBase's
    // "telemetry failures must not crash the process" rule).
    console.warn(`[otel] agent telemetry disabled: ${(err as Error)?.message ?? String(err)}`);
  }
}

// Self-start on import (mirrors AgentBase's `otel.ts` shim). `mastra/index.ts`
// imports this module FIRST so the SDK starts during its evaluation — before
// `@mastra/core` (and the `http` it pulls in) is imported. For the bundled
// production container, additionally preload it before the app graph with
// `node --import` (see apps/agents/Dockerfile) so ESM instrumentation applies.
startAgentTelemetry();
