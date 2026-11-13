import { afterEach, describe, expect, it, vi } from 'vitest';
import { readChatResponse, streamChatResult } from '../app/lib/chat-stream';

afterEach(() => vi.useRealTimers());

describe('WEB-029 streamed A2A turn results', () => {
  it('delivers working updates before a long turn completes, then preserves its result', async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const response = streamChatResult(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const updates: number[] = [];
    let completed = false;
    const read = readChatResponse(response, (seconds) => updates.push(seconds)).then((result) => {
      completed = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(45000);
    expect(updates).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45]);
    expect(completed).toBe(false);
    finish(Response.json({ ok: true, text: 'Finished.', conversationId: 'c1' }));
    expect(await read).toEqual({
      status: 200,
      text: JSON.stringify({ ok: true, text: 'Finished.', conversationId: 'c1' }),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles UTF-8 and event boundaries split across arbitrary chunks', async () => {
    const encoded = new TextEncoder().encode(
      'event: status\r\ndata: {"elapsedSeconds":5}\r\n\r\nevent: result\r\ndata: {"status":200,"body":{"ok":true,"text":"héllo"}}\r\n\r\n',
    );
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const byte of encoded) c.enqueue(new Uint8Array([byte]));
        c.close();
      },
    });
    const status = vi.fn();
    expect(
      await readChatResponse(
        new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
        status,
      ),
    ).toEqual({ status: 200, text: JSON.stringify({ ok: true, text: 'héllo' }) });
    expect(status).toHaveBeenCalledWith(5);
  });

  it('retains a failed turn status and its safe message', async () => {
    const result = await readChatResponse(
      streamChatResult(async () =>
        Response.json({ ok: false, error: 'The agent is unavailable.' }, { status: 502 }),
      ),
      () => {},
    );
    expect(result.status).toBe(502);
    expect(JSON.parse(result.text).error).toBe('The agent is unavailable.');
  });

  it('does not expose unexpected server errors', async () => {
    const result = await readChatResponse(
      streamChatResult(async () => {
        throw Error('private credential');
      }),
      () => {},
    );
    expect(result.status).toBe(500);
    expect(result.text).not.toContain('private credential');
  });

  it('cleans up when the client disconnects while the agent keeps working', async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const response = streamChatResult(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await response.body!.cancel();
    expect(vi.getTimerCount()).toBe(0);
    finish(Response.json({ ok: true, text: 'Finished later.' }));
    await vi.advanceTimersByTimeAsync(10000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    'event: status\ndata: {"elapsedSeconds":0}\n\n',
    'event: result\ndata: {"status":999,"body":{}}\n\n',
    'event: result\ndata: {"status":200,"body":null}\n\n',
    'x'.repeat(2 * 1024 * 1024 + 1),
  ])('refuses incomplete, invalid or oversized streams', async (text) => {
    await expect(
      readChatResponse(
        new Response(text, { headers: { 'content-type': 'text/event-stream' } }),
        () => {},
      ),
    ).rejects.toThrow();
  });

  it('preserves JSON replies for existing clients and pre-stream refusals', async () => {
    const result = await readChatResponse(
      Response.json({ ok: false, error: 'Sign in to chat.' }, { status: 401 }),
      () => {},
    );
    expect(result.status).toBe(401);
    expect(JSON.parse(result.text).error).toBe('Sign in to chat.');
  });
});
