import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { verifyTemplateRevision } from '../../../scripts/verify-template-revision.mjs';

it('refuses revision drift before customization while accepting the exact Git revision', () => {
  const root = mkdtempSync(join(tmpdir(), 'template-revision-'));
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  try {
    git(['init', '--initial-branch=develop']);
    git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'fixture: Initialize template',
    ]);
    const revision = git(['rev-parse', 'HEAD']);
    expect(() => verifyTemplateRevision(root, revision)).not.toThrow();
    expect(() => verifyTemplateRevision(root, '0'.repeat(40))).toThrow(/template changed/);
    expect(() => verifyTemplateRevision(root, 'develop')).toThrow(/full commit/);
    expect(git(['status', '--porcelain'])).toBe('');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
