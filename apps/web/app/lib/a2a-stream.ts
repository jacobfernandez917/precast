import { z } from 'zod';

const object = z.record(z.unknown());
const part = z
  .object({ kind: z.string().optional(), type: z.string().optional(), text: z.string().optional() })
  .passthrough();
const artifactSchema = z.object({ artifactId: z.string(), parts: z.array(part) }).passthrough();
const statusSchema = z.object({ state: z.string() }).passthrough();
const envelope = z.object({ result: object.optional(), error: object.optional() }).passthrough();

/** Assemble A2A artifact deltas, never returning task ids, history or execution metadata to the UI. */
export async function readA2aStream(
  response: Response,
  onText: (text: string) => void,
): Promise<unknown> {
  if (!response.body) throw new Error('Missing A2A stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const artifacts = new Map<string, z.infer<typeof artifactSchema>>();
  let pending = '';
  let bytes = 0;
  let task: Record<string, unknown> | undefined;
  let terminal = false;
  const handle = (frame: string) => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]') return;
    const rpc = envelope.parse(JSON.parse(data));
    if (rpc.error) throw new Error('A2A stream failed.');
    const outer = object.parse(rpc.result);
    const event = object.parse(
      outer.artifactUpdate ?? outer.statusUpdate ?? outer.task ?? outer.message ?? outer,
    );
    if (event.kind === 'message' || Array.isArray(event.parts)) {
      task = { ...event, kind: 'message' };
      terminal = true;
      return;
    }
    if (event.kind === 'task' || (event.status && event.id)) {
      task = { ...event, kind: 'task' };
      for (const artifact of z.array(artifactSchema).parse(event.artifacts ?? []))
        artifacts.set(artifact.artifactId, artifact);
    } else if (event.artifact) {
      const artifact = artifactSchema.parse(event.artifact);
      const old = artifacts.get(artifact.artifactId);
      artifacts.set(artifact.artifactId, {
        ...artifact,
        parts: event.append === true && old ? [...old.parts, ...artifact.parts] : artifact.parts,
      });
      onText(
        [...artifacts.values()]
          .flatMap((a) => a.parts)
          .filter((p) => (p.kind === 'text' || p.type === 'text') && p.text)
          .map((p) => p.text)
          .join(''),
      );
    } else if (event.status) {
      task = { ...task, kind: 'task', status: statusSchema.parse(event.status) };
    }
    const status = task?.status
      ? statusSchema
          .parse(task.status)
          .state.toLowerCase()
          .replace(/^task_state_/, '')
          .replace(/_/g, '-')
      : '';
    terminal = [
      'completed',
      'failed',
      'canceled',
      'cancelled',
      'rejected',
      'input-required',
      'auth-required',
      'unknown',
    ].includes(status);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error('A2A stream exceeds its limit.');
      pending += decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        handle(pending.slice(0, boundary.index));
        pending = pending.slice(boundary.index + boundary[0].length);
      }
    }
    pending += decoder.decode();
    if (pending.trim()) handle(pending);
    if (!task || !terminal) throw new Error('A2A stream ended before completion.');
    return {
      jsonrpc: '2.0',
      result: { ...task, ...(task.kind === 'task' ? { artifacts: [...artifacts.values()] } : {}) },
    };
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
