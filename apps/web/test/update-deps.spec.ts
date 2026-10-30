import { describe, expect, it } from 'vitest';
import { alignedVersions, mastraProviderVersions } from '../../../scripts/update-deps.mjs';

/**
 * APP-034: `pnpm deps:update` (which bootstrap runs on every new project) pins
 * `@ai-sdk/openai-compatible` and `@ai-sdk/provider` to the provider version
 * `@mastra/core` ships. Updated independently, a scaffold ended on provider
 * 4.0.34 beside Mastra's 4.0.29 and the agents app stopped typechecking.
 */

const release = (version: string, provider: string) => ({
  version,
  dependencies: { '@ai-sdk/provider': provider, '@ai-sdk/provider-utils': '5.0.0' },
});

const releases = [
  release('3.0.70', '4.0.29'),
  release('3.0.71', '4.0.29'),
  release('3.0.72-beta.1', '4.0.29'),
  release('3.0.80', '4.0.34'),
  release('3.0.81', '4.0.34'),
];

describe('mastraProviderVersions', () => {
  it('reads every aliased provider target, whatever the alias is called', () => {
    expect(
      mastraProviderVersions({
        '@ai-sdk/provider-v5': 'npm:@ai-sdk/provider@2.0.5',
        '@ai-sdk/provider-v7': 'npm:@ai-sdk/provider@4.0.29',
        '@ai-sdk/provider-next': 'npm:@ai-sdk/provider@5.0.1',
        '@ai-sdk/provider-utils-v7': 'npm:@ai-sdk/provider-utils@5.0.62',
        zod: '^3.25.0',
      }),
    ).toEqual(['2.0.5', '4.0.29', '5.0.1']);
  });

  it('returns nothing when Mastra lists no provider', () => {
    expect(mastraProviderVersions(undefined)).toEqual([]);
  });
});

describe('alignedVersions', () => {
  it('picks the newest stable release built on the provider Mastra ships', () => {
    expect(alignedVersions({ mastraProviders: ['2.0.5', '3.0.19', '4.0.29'], releases })).toEqual({
      compatible: '3.0.71',
      provider: '4.0.29',
    });
  });

  it('follows Mastra forward when it moves to a newer provider', () => {
    expect(alignedVersions({ mastraProviders: ['4.0.34'], releases })).toEqual({
      compatible: '3.0.81',
      provider: '4.0.34',
    });
  });

  it('refuses when no release is built on that exact provider', () => {
    expect(() => alignedVersions({ mastraProviders: ['4.0.30'], releases })).toThrow(
      /No @ai-sdk\/openai-compatible release is built on @ai-sdk\/provider 4\.0\.30/,
    );
  });

  it('refuses when Mastra ships no provider of the major openai-compatible needs', () => {
    expect(() => alignedVersions({ mastraProviders: ['2.0.5', '3.0.19'], releases })).toThrow(
      /ships no @ai-sdk\/provider 4\.x/,
    );
  });
});
