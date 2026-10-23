import { emitAgentLog, type AgentLogName, type AgentLogSeverity } from '../telemetry/otel';

/**
 * One log record per A2A call: which agent, the status, how long it took, in
 * the trace AgentBase's proxy started. Health checks and agent-card fetches are
 * left out; they would drown the calls people want to see. Nothing from the
 * request or response body is read.
 */
interface TelemetryContext {
  req: { path: string; method: string };
  res?: Response;
}

type Emit = (
  name: AgentLogName,
  severity: AgentLogSeverity,
  attributes: Record<string, string | number>,
) => void;

const A2A_CALL = /^\/api\/a2a\/([^/]+)\/?$/;

function agentIdFrom(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function createTelemetryMiddleware(
  emit: Emit = emitAgentLog,
  now = () => performance.now(),
) {
  return async (c: TelemetryContext, next: () => Promise<void>): Promise<void> => {
    const call = c.req.method === 'POST' ? A2A_CALL.exec(c.req.path) : null;
    if (!call) return next();

    const started = now();
    let status = 500;
    try {
      await next();
      status = c.res?.status ?? 500;
    } finally {
      emit('agent.request', status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO', {
        'gen_ai.agent.id': agentIdFrom(call[1]),
        'http.request.method': c.req.method,
        'http.response.status_code': status,
        'http.server.request.duration': Math.round(now() - started) / 1000,
      });
    }
  };
}

export const telemetryMiddleware = createTelemetryMiddleware();
