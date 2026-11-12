import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialCommitEnv } from '../../../scripts/initial-commit-env.mjs';

describe('bootstrap initial commit identity', () => {
  let cwd: string;
  let env: NodeJS.ProcessEnv;
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'scaffold-git-'));
    env = { PATH: process.env.PATH, HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', NODE_ENV: 'test' };
    git('init', '-q');
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it('makes an initial commit on a fresh Computer without changing Git configuration', () => {
    execFileSync('git', ['commit', '--allow-empty', '-m', 'initialize'], {
      cwd,
      env: { ...env, ...initialCommitEnv(cwd, env) },
    });
    expect(git('log', '-1', '--format=%an <%ae>')).toBe('Project Scaffold <scaffold@localhost>');
    expect(git('config', '--local', '--list')).not.toContain('user.');
  });

  it('preserves configured member identity and explicit author overrides', () => {
    git('config', 'user.name', 'Member');
    git('config', 'user.email', 'member@example.com');
    expect(initialCommitEnv(cwd, { ...env, GIT_AUTHOR_NAME: 'Explicit author' })).toEqual({
      GIT_AUTHOR_NAME: 'Explicit author',
      GIT_AUTHOR_EMAIL: 'member@example.com',
      GIT_COMMITTER_NAME: 'Member',
      GIT_COMMITTER_EMAIL: 'member@example.com',
    });
  });
});
