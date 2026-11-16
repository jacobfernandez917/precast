import { execFileSync } from 'node:child_process';

/** Fail before bootstrap changes files when an operator pinned a different template. */
export function verifyTemplateRevision(root, expected) {
  if (expected === undefined) return;
  if (!/^[a-f0-9]{40}$/.test(expected))
    throw new Error('The approved template revision must be a full commit SHA.');
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (actual !== expected)
    throw new Error(
      'The template changed after approval. No bootstrap changes were made; refresh the approved template revision before retrying.',
    );
}
