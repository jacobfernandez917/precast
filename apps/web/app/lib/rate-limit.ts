/**
 * How often one person may send the agent a message. Every turn costs a model
 * call on the organisation's account, so a stuck script or a curious visitor
 * must not be able to run up the bill.
 *
 * Kept in this server's memory: limits reset when the app restarts and are per
 * instance. Enough for one web container; several would need a shared store.
 */

export interface RateLimitWindow {
  limit: number;
  windowMs: number;
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function createRateLimiter(windows: RateLimitWindow[], now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  const longest = Math.max(...windows.map((w) => w.windowMs));

  return {
    /** Count one turn for `key`, or say how long to wait when a window is full. */
    take(key: string): RateLimitResult {
      const at = now();
      const recent = (hits.get(key) ?? []).filter((t) => at - t < longest);
      for (const w of windows) {
        const inWindow = recent.filter((t) => at - t < w.windowMs);
        if (inWindow.length >= w.limit) {
          const oldest = inWindow[0]!;
          hits.set(key, recent);
          return {
            ok: false,
            retryAfterSeconds: Math.max(1, Math.ceil((oldest + w.windowMs - at) / 1000)),
          };
        }
      }
      recent.push(at);
      hits.set(key, recent);
      return { ok: true };
    },
  };
}

const positive = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** Per person: CHAT_TURNS_PER_MINUTE (20) and CHAT_TURNS_PER_DAY (500). */
export const chatTurnLimiter = createRateLimiter([
  { limit: positive(process.env.CHAT_TURNS_PER_MINUTE, 20), windowMs: 60_000 },
  { limit: positive(process.env.CHAT_TURNS_PER_DAY, 500), windowMs: 24 * 60 * 60_000 },
]);
