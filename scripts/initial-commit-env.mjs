import { spawnSync } from 'node:child_process';

/** A fresh Computer has no Git identity. Scope the fallback to the initial commit. */
export function initialCommitEnv(cwd, env = process.env) {
  const configured = (key) => {
    const result = spawnSync('git', ['config', '--get', key], { cwd, env, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : '';
  };
  const name = configured('user.name') || 'Project Scaffold';
  const email = configured('user.email') || 'scaffold@localhost';
  return {
    GIT_AUTHOR_NAME: env.GIT_AUTHOR_NAME || name,
    GIT_AUTHOR_EMAIL: env.GIT_AUTHOR_EMAIL || email,
    GIT_COMMITTER_NAME: env.GIT_COMMITTER_NAME || name,
    GIT_COMMITTER_EMAIL: env.GIT_COMMITTER_EMAIL || email,
  };
}
