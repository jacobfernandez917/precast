import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EnvSchema } from '@precast/shared';

/**
 * WEB-005 — guard the AgentBase import gate contract.
 *
 * `agentbase.import.json` `requiredEnv` is DERIVED from the zod env schema by
 * `pnpm emit:import-manifest`. This test re-derives it independently from the
 * schema and asserts the committed manifest matches, so the two can't drift
 * (add a required var to env.ts, forget to re-emit → this fails).
 */

// Mirror AgentBase's RESERVED_ENV_NAMES (env-groups.dto.ts) — never gated.
const RESERVED = new Set([
  'AGENT_API_TOKEN',
  'AGENT_INBOUND_TOKEN',
  'PORT',
  'MASTRA_PORT',
  'MASTRA_HOST',
]);

function requiredFromSchema(): string[] {
  const shape = (EnvSchema as unknown as { shape: Record<string, { isOptional(): boolean }> }).shape;
  return Object.entries(shape)
    .filter(([, field]) => !field.isOptional())
    .map(([name]) => name)
    .filter((name) => !RESERVED.has(name))
    .sort();
}

const manifestPath = fileURLToPath(new URL('../../../agentbase.import.json', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { requiredEnv?: string[] };

describe('agentbase.import.json requiredEnv', () => {
  it('is present and lists at least DATABASE_URL', () => {
    expect(Array.isArray(manifest.requiredEnv)).toBe(true);
    expect(manifest.requiredEnv).toContain('DATABASE_URL');
  });

  it('matches the required set derived from the env schema (run `pnpm emit:import-manifest`)', () => {
    expect([...(manifest.requiredEnv ?? [])].sort()).toEqual(requiredFromSchema());
  });

  it('never gates on AgentBase-reserved names', () => {
    for (const name of manifest.requiredEnv ?? []) expect(RESERVED.has(name)).toBe(false);
  });
});
