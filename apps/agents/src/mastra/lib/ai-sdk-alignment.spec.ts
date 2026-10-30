import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * AGT-027: the gateway client and Mastra use one copy of the AI SDK provider
 * types. `agentbase-model.ts` hands a `@ai-sdk/openai-compatible` model to
 * Mastra; when that package brings a different `@ai-sdk/provider` than the one
 * `@mastra/core` pins, the agents app fails to typecheck (a scaffold did, with
 * 4.0.34 beside 4.0.29). `pnpm deps:update` keeps them together; this fails
 * when a hand edit or an update drifts them apart.
 */

const read = (pkg: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../../node_modules/${pkg}/package.json`, import.meta.url)),
      'utf8',
    ),
  ) as { version: string; dependencies?: Record<string, string> };

describe('AI SDK provider alignment', () => {
  const mastra = read('@mastra/core');
  const shipped = Object.values(mastra.dependencies ?? {})
    .filter((spec) => spec.startsWith('npm:@ai-sdk/provider@'))
    .map((spec) => spec.slice('npm:@ai-sdk/provider@'.length));
  const compatibleProvider = read('@ai-sdk/openai-compatible').dependencies?.['@ai-sdk/provider'];

  it('openai-compatible is built on a provider version @mastra/core ships', () => {
    expect(shipped).toContain(compatibleProvider);
  });

  it('the agents app types against that same provider version', () => {
    expect(read('@ai-sdk/provider').version).toBe(compatibleProvider);
  });
});
