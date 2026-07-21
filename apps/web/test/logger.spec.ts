import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from '../app/lib/logger';

const original = process.env.LOG_LEVEL;
afterEach(() => {
  if (original === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = original;
});

describe('@precast/shared createLogger', () => {
  it('returns a usable logger with the standard methods', () => {
    const log = createLogger('test');
    for (const m of ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const) {
      expect(typeof log[m]).toBe('function');
    }
  });

  it('honors LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'debug';
    expect(createLogger('test').level).toBe('debug');
  });

  it('defaults to info when LOG_LEVEL is unset or invalid', () => {
    delete process.env.LOG_LEVEL;
    expect(createLogger('test').level).toBe('info');
    process.env.LOG_LEVEL = 'not-a-level';
    expect(createLogger('test').level).toBe('info');
  });
});
