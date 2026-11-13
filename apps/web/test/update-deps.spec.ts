import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

it('finishes the intentional dependency update and provider alignment under CI=1', () => {
  const root = mkdtempSync(join(tmpdir(), 'dependency-update-ci-'));
  const put = (relative: string, text: string) => {
    const target = join(root, relative);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, text);
  };
  try {
    put('scripts/update-deps.mjs', '');
    copyFileSync(
      fileURLToPath(new URL('../../../scripts/update-deps.mjs', import.meta.url)),
      join(root, 'scripts/update-deps.mjs'),
    );
    put(
      'apps/agents/package.json',
      JSON.stringify({
        dependencies: {
          '@mastra/core': '^1.0.0',
          '@ai-sdk/openai-compatible': '^3.0.80',
          '@ai-sdk/provider': '4.0.34',
        },
      }),
    );
    put(
      'apps/agents/node_modules/@mastra/core/package.json',
      JSON.stringify({ dependencies: { '@ai-sdk/provider-v7': 'npm:@ai-sdk/provider@4.0.29' } }),
    );
    put(
      'apps/agents/node_modules/@ai-sdk/openai-compatible/package.json',
      JSON.stringify({ version: '3.0.80' }),
    );
    put(
      'bin/pnpm',
      `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(process.env.PRECAST_UPDATE_TEST_LOG,JSON.stringify(args)+'\\n');if(process.env.CI==='1'&&args[0]==='install'&&!args.includes('--no-frozen-lockfile'))process.exit(17);\n`,
    );
    put(
      'bin/npm',
      `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(releases))});\n`,
    );
    chmodSync(join(root, 'bin/pnpm'), 0o755);
    chmodSync(join(root, 'bin/npm'), 0o755);
    const result = spawnSync(
      process.execPath,
      [join(root, 'scripts/update-deps.mjs'), '--no-verify'],
      {
        env: {
          ...process.env,
          CI: '1',
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          PRECAST_UPDATE_TEST_LOG: join(root, 'commands.jsonl'),
        },
        encoding: 'utf8',
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(
      readFileSync(join(root, 'commands.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual([
      ['update', '-r'],
      ['install', '--no-frozen-lockfile'],
      ['install', '--no-frozen-lockfile'],
    ]);
    const pkg = JSON.parse(readFileSync(join(root, 'apps/agents/package.json'), 'utf8'));
    expect(pkg.dependencies['@ai-sdk/openai-compatible']).toBe('3.0.71');
    expect(pkg.dependencies['@ai-sdk/provider']).toBe('4.0.29');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
