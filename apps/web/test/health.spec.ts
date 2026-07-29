import { describe, expect, it } from 'vitest';
import { EnvSchema } from '@precast/shared';

describe('@precast/shared env schema', () => {
  it('applies defaults for optional vars', () => {
    const env = EnvSchema.parse({
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/precast_dev',
    });
    expect(env.MASTRA_PORT).toBe(45000);
    expect(env.WEB_PORT).toBe(45001);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('rejects an invalid DATABASE_URL', () => {
    expect(() => EnvSchema.parse({ DATABASE_URL: 'not-a-url' })).toThrow();
  });
});
