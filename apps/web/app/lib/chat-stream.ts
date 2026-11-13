/** Stream elapsed-time updates while the existing A2A turn runs, then its sanitized reply. */
export function streamChatResult(reply: () => Promise<Response>): Response {
  const encoder = new TextEncoder();
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const started = Date.now();
      const emit = (event: string, data: unknown) => {
        if (!stopped)
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      emit('status', { state: 'working', elapsedSeconds: 0 });
      timer = setInterval(
        () =>
          emit('status', {
            state: 'working',
            elapsedSeconds: Math.floor((Date.now() - started) / 1000),
          }),
        5000,
      );
      void (async () => {
        try {
          const response = await reply();
          emit('result', { status: response.status, body: await response.json() });
        } catch {
          emit('result', {
            status: 500,
            body: { ok: false, error: 'The agent call failed.', status: 500 },
          });
        } finally {
          clearInterval(timer);
          if (!stopped) {
            stopped = true;
            controller.close();
          }
        }
      })();
    },
    cancel() {
      stopped = true;
      clearInterval(timer);
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** JSON clients keep their old contract; the UI also understands incremental SSE frames. */
export async function readChatResponse(
  response: Response,
  onStatus: (seconds: number) => void,
): Promise<{ status: number; text: string }> {
  if (!response.headers.get('content-type')?.includes('text/event-stream'))
    return { status: response.status, text: await response.text() };
  if (!response.body) throw new Error('The reply stream is missing.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error('The reply is too large.');
      pending += decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        const frame = pending.slice(0, boundary.index);
        pending = pending.slice(boundary.index + boundary[0].length);
        const lines = frame.split(/\r?\n/);
        const event = lines
          .find((line) => line.startsWith('event:'))
          ?.slice(6)
          .trim();
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data || !['status', 'result'].includes(event ?? '')) continue;
        const parsed = JSON.parse(data);
        if (event === 'status') {
          if (
            Number.isInteger(parsed.elapsedSeconds) &&
            parsed.elapsedSeconds >= 0 &&
            parsed.elapsedSeconds <= 1800
          )
            onStatus(parsed.elapsedSeconds);
        } else {
          if (
            !Number.isInteger(parsed.status) ||
            parsed.status < 100 ||
            parsed.status > 599 ||
            !parsed.body ||
            typeof parsed.body !== 'object' ||
            Array.isArray(parsed.body)
          )
            throw new Error('The reply stream is invalid.');
          return { status: parsed.status, text: JSON.stringify(parsed.body) };
        }
      }
    }
    throw new Error('The reply stream ended before the agent finished.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
