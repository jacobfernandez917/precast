import { describe, expect, it } from 'vitest';
import { EnvSchema, projectSchema } from '@precast/shared';

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

  /** WEB-028: Mastra's schema is named after the project, never a generic `mastra`. */
  it("puts agent memory in the project's own schema unless one is chosen", () => {
    const DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/app';
    expect(EnvSchema.parse({ DATABASE_URL }).MASTRA_DB_SCHEMA).toBe(projectSchema('agents'));
    expect(EnvSchema.parse({ DATABASE_URL, MASTRA_DB_SCHEMA: '' }).MASTRA_DB_SCHEMA).toBe(
      projectSchema('agents'),
    );
    // An existing project keeps the schema its .env names, so its memory stays where it is.
    expect(EnvSchema.parse({ DATABASE_URL, MASTRA_DB_SCHEMA: 'mastra' }).MASTRA_DB_SCHEMA).toBe(
      'mastra',
    );
    expect(() => EnvSchema.parse({ DATABASE_URL, MASTRA_DB_SCHEMA: 'My-Schema' })).toThrow(
      /lowercase/,
    );
  });
});
