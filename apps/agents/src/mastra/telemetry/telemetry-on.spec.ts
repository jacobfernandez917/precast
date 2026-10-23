import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { context, trace, type ProxyTracerProvider } from '@opentelemetry/api';
import { logs as logsApi } from '@opentelemetry/api-logs';
import { core, logs as sdkLogs, tracing } from '@opentelemetry/sdk-node';
import { emitAgentLog, resetAgentTelemetryForTests, startAgentTelemetry } from './otel';

/**
 * The running SDK, as the agents container runs it, with in-memory exporters in
 * place of OTLP. Two local servers stand in for the two hops that matter: the
 * agent (inbound from AgentBase's proxy, then an in-process crew hop) and the
 * gateway (egress back to AgentBase).
 */

const INBOUND_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const INBOUND_PARENT = '00f067aa0ba902b7';
const TRACEPARENT = `00-${INBOUND_TRACE}-${INBOUND_PARENT}-01`;

const PROMPT = 'Summarise the contract for Jamie, card ending 4111';
const COMPLETION = 'The contract renews on 1 March';
const BEARER = 'ab_otel_secretvalue.never-exported';

const spans = new tracing.InMemorySpanExporter();
const logRecords = new sdkLogs.InMemoryLogRecordExporter();

let agent: Server;
let gateway: Server;
let agentUrl = '';
let gatewayUrl = '';
const gatewaySaw: Array<string | undefined> = [];

async function listen(server: Server): Promise<string> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A crew member called in-process: no network between orchestrator and member. */
async function crewMember(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await fetch(`${gatewayUrl}/proxy/llm/org/model/v1/chat/completions?api_key=egress-secret`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: PROMPT }] }),
  });
}

/** What the AI SDK bundled in Mastra records when a caller switches its telemetry on. */
function aiSdkSpan(): void {
  trace.getTracer('ai').startActiveSpan(
    'ai.generateText',
    {
      attributes: {
        'ai.prompt': PROMPT,
        'ai.response.text': COMPLETION,
        'ai.toolCall.args': '{"card":"4111"}',
        'ai.model.id': 'gemini-3.5-flash',
        'ai.usage.promptTokens': 12,
      },
    },
    (span) => {
      span.recordException(new Error(`model refused: ${PROMPT}`));
      span.setStatus({ code: 2, message: `model refused: ${PROMPT}` });
      span.end();
    },
  );
}

async function flushAll(): Promise<void> {
  const tp = (trace.getTracerProvider() as ProxyTracerProvider).getDelegate() as unknown as {
    forceFlush(): Promise<void>;
  };
  await tp.forceFlush();
  const lp = logsApi.getLoggerProvider() as unknown as { forceFlush(): Promise<void> };
  await lp.forceFlush();
}

/** Call the agent the way AgentBase's proxy does, without this test's own fetch adding a span. */
function callAgent(path: string): Promise<Response> {
  return context.with(core.suppressTracing(context.active()), () =>
    fetch(`${agentUrl}${path}`, {
      method: 'POST',
      headers: {
        traceparent: TRACEPARENT,
        authorization: `Bearer ${BEARER}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ params: { message: { parts: [{ kind: 'text', text: PROMPT }] } } }),
    }),
  );
}

let activeTraceInHandler: string | undefined;

beforeAll(async () => {
  process.env.OTEL_SERVICE_NAME = 'agent-example-agent';
  process.env.OTEL_RESOURCE_ATTRIBUTES =
    'agentbase.org=org-1,agentbase.agent_id=agent-1,deployment.environment.name=development';
  startAgentTelemetry({
    env: process.env,
    exporters: { traces: spans, logs: logRecords },
    flushOnSigterm: false,
  });

  gateway = createServer((req, res) => {
    gatewaySaw.push(req.headers.traceparent as string | undefined);
    req.resume();
    req.on('end', () => res.end('{}'));
  });
  agent = createServer((req, res) => {
    req.resume();
    if (req.url === '/api/agents') {
      res.end('{}');
      return;
    }
    req.on('end', async () => {
      activeTraceInHandler = trace.getActiveSpan()?.spanContext().traceId;
      aiSdkSpan();
      await crewMember();
      emitAgentLog('agent.request', 'INFO', {
        'gen_ai.agent.id': 'example-agent',
        'http.response.status_code': 200,
        prompt: PROMPT,
      });
      res.end('ok');
    });
  });
  gatewayUrl = await listen(gateway);
  agentUrl = await listen(agent);

  const res = await callAgent('/api/a2a/example-agent?api_key=inbound-secret');
  expect(res.status).toBe(200);
  // The Compose health check, as it runs every 10 s.
  await context.with(core.suppressTracing(context.active()), () => fetch(`${agentUrl}/api/agents`));
  await flushAll();
});

afterAll(async () => {
  await new Promise((r) => agent.close(r));
  await new Promise((r) => gateway.close(r));
  await resetAgentTelemetryForTests();
});

describe('AGT-020 the inbound traceparent continues through the crew hop and onto egress', () => {
  it('the handler runs in the inbound trace', () => {
    expect(activeTraceInHandler).toBe(INBOUND_TRACE);
  });

  it('egress to the gateway carries the same trace, with a new parent span', () => {
    expect(gatewaySaw).toHaveLength(1);
    const [, traceId, parentId] = (gatewaySaw[0] ?? '').split('-');
    expect(traceId).toBe(INBOUND_TRACE);
    expect(parentId).not.toBe(INBOUND_PARENT);
  });

  it('exports the agent server span under the proxy span, then client and gateway spans in a chain', () => {
    const finished = spans
      .getFinishedSpans()
      .filter((s) => s.spanContext().traceId === INBOUND_TRACE);
    const servers = finished.filter((s) => s.kind === 1);
    const agentSpan = servers.find((s) => s.parentSpanContext?.spanId === INBOUND_PARENT);
    const client = finished.find((s) => s.kind === 2);
    expect(agentSpan, 'no server span continues the proxy span').toBeDefined();
    expect(client?.parentSpanContext?.spanId).not.toBe(INBOUND_PARENT);
    const [, , egressParent] = (gatewaySaw[0] ?? '').split('-');
    expect(client?.spanContext().spanId).toBe(egressParent);
    const gatewaySpan = servers.find((s) => s !== agentSpan);
    expect(gatewaySpan?.parentSpanContext?.spanId).toBe(egressParent);
  });

  it('carries OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES on what it exports', async () => {
    const resource = spans.getFinishedSpans()[0].resource;
    await resource.waitForAsyncAttributes?.();
    expect(resource.attributes['service.name']).toBe('agent-example-agent');
    expect(resource.attributes['agentbase.org']).toBe('org-1');
    expect(resource.attributes['agentbase.agent_id']).toBe('agent-1');
    expect(resource.attributes['deployment.environment.name']).toBe('development');
  });
});

describe('AGT-023 liveness probes stay off the Telemetry page', () => {
  it('a GET /api/agents health check produces no span', () => {
    const paths = spans
      .getFinishedSpans()
      .map((s) => s.attributes['url.path'] ?? s.attributes['http.target']);
    expect(paths).not.toContain('/api/agents');
  });
});

describe('AGT-021 nothing sensitive leaves in span attributes, events or status', () => {
  const exported = () =>
    spans.getFinishedSpans().map((s) => ({
      name: s.name,
      attributes: s.attributes,
      events: s.events,
      links: s.links,
      status: s.status,
    }));

  it('no prompt, completion, tool argument, bearer or query-string secret appears anywhere', () => {
    const text = JSON.stringify(exported());
    for (const secret of [
      PROMPT,
      COMPLETION,
      '4111',
      BEARER,
      'inbound-secret',
      'egress-secret',
      'Bearer',
    ]) {
      expect(text, `exported spans contain "${secret}"`).not.toContain(secret);
    }
  });

  it('keeps what identifies the call: method, status, path, model and token counts', () => {
    const ai = spans.getFinishedSpans().find((s) => s.name === 'ai.generateText');
    expect(ai?.attributes).toEqual({
      'ai.model.id': 'gemini-3.5-flash',
      'ai.usage.promptTokens': 12,
    });
    expect(ai?.status).toEqual({ code: 2 });
    expect(ai?.events[0].attributes).toEqual({ 'exception.type': 'Error' });

    const client = spans.getFinishedSpans().find((s) => s.kind === 2);
    const url = String(client?.attributes['url.full'] ?? '');
    expect(url).toMatch(/\/proxy\/llm\/org\/model\/v1\/chat\/completions$/);
    expect(client?.attributes['http.request.method']).toBe('POST');
  });
});

describe('AGT-022 log records: severity, trace correlation, no message text', () => {
  it('the record carries the event name, severity and the inbound trace, and drops unknown keys', () => {
    const records = logRecords.getFinishedLogRecords();
    const request = records.find((r) => r.body === 'agent.request');
    expect(request?.severityText).toBe('INFO');
    expect(request?.spanContext?.traceId).toBe(INBOUND_TRACE);
    expect(request?.attributes).toEqual({
      'gen_ai.agent.id': 'example-agent',
      'http.response.status_code': 200,
      'event.name': 'agent.request',
    });
    expect(JSON.stringify(records.map((r) => [r.body, r.attributes]))).not.toContain(PROMPT);
  });
});
