import { describe, expect, it, vi } from 'vitest';
import { readA2aStream } from '../app/lib/a2a-stream';
const event = (result: unknown) => `data: ${JSON.stringify({ jsonrpc: '2.0', result })}\n\n`;
const artifact = (text: string, append = false) => ({
  kind: 'artifact-update',
  artifact: { artifactId: 'answer', parts: [{ kind: 'text', text }] },
  append,
});
const task = (state: string) => ({
  kind: 'task',
  id: 'private-task',
  contextId: 'private-owner',
  status: { state },
  artifacts: [],
});
describe('A2A artifact streaming', () => {
  it('delivers UTF-8 text before completion while keeping metadata out of token callbacks', async () => {
    let push!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        push = c;
      },
    });
    const updates = vi.fn();
    let finished = false;
    const reading = readA2aStream(new Response(body), updates).then((v) => {
      finished = true;
      return v;
    });
    const bytes = new TextEncoder().encode(
      event(task('working')) + event(artifact('hé')) + event(artifact('llo', true)),
    );
    for (const byte of bytes) push.enqueue(new Uint8Array([byte]));
    await vi.waitFor(() => expect(updates).toHaveBeenLastCalledWith('héllo'));
    expect(finished).toBe(false);
    push.enqueue(
      new TextEncoder().encode(
        event({ kind: 'status-update', status: { state: 'completed' }, final: true }),
      ),
    );
    push.close();
    expect(await reading).toMatchObject({
      result: {
        status: { state: 'completed' },
        artifacts: [{ parts: [{ text: 'hé' }, { text: 'llo' }] }],
      },
    });
    expect(JSON.stringify(updates.mock.calls)).not.toContain('private-');
  });
  it('supports wrapped A2A updates and replacements, without duplicating prior chunks', async () => {
    const updates = vi.fn();
    const result = await readA2aStream(
      new Response(
        event({ task: task('working') }) +
          event({ artifactUpdate: artifact('first') }) +
          event({ artifactUpdate: artifact('replacement') }) +
          event({ statusUpdate: { status: { state: 'completed' } } }),
      ),
      updates,
    );
    expect(updates.mock.calls).toEqual([['first'], ['replacement']]);
    expect(result).toMatchObject({ result: { artifacts: [{ parts: [{ text: 'replacement' }] }] } });
  });
  it('refuses a truncated paid/tool turn without retrying it', async () => {
    await expect(
      readA2aStream(new Response(event(task('working')) + event(artifact('partial'))), vi.fn()),
    ).rejects.toThrow(/before completion/);
    await expect(
      readA2aStream(new Response('data: {"error":{"message":"private detail"}}\n\n'), vi.fn()),
    ).rejects.toThrow('A2A stream failed.');
  });
});
