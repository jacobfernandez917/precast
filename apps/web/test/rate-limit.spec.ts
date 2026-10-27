import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../app/lib/rate-limit';

/** WEB-024: one person's turns are limited per minute and per day; others are unaffected. */
describe('createRateLimiter', () => {
  it('refuses the turn past a window, says how long to wait, and frees up as time passes', () => {
    let now = 0;
    const limiter = createRateLimiter([{ limit: 3, windowMs: 60_000 }], () => now);
    for (let i = 0; i < 3; i++) expect(limiter.take('u1').ok).toBe(true);
    now = 10_000;
    expect(limiter.take('u1')).toEqual({ ok: false, retryAfterSeconds: 50 });
    expect(limiter.take('u2').ok, 'another person is not affected').toBe(true);
    now = 60_001;
    expect(limiter.take('u1').ok).toBe(true);
  });

  it('applies every window: a day limit holds even when the minute allows', () => {
    let now = 0;
    const limiter = createRateLimiter(
      [
        { limit: 10, windowMs: 60_000 },
        { limit: 4, windowMs: 24 * 60 * 60_000 },
      ],
      () => now,
    );
    for (let i = 0; i < 4; i++) {
      expect(limiter.take('u1').ok).toBe(true);
      now += 61_000;
    }
    const refused = limiter.take('u1');
    expect(refused.ok).toBe(false);
  });
});
