import { describe, expect, it } from 'vitest';
import { OPTIONAL_COMPOSE_FILES, composeArgs } from '../../../scripts/docker-compose.mjs';

/**
 * APP-024: the compose wrapper drops an explicit `-f` for a git-ignored override
 * that does not exist. Compose errors on any `-f` it cannot open and only
 * auto-merges the override when no `-f` is passed, so a fresh clone, which has
 * no override, failed `pnpm poc` before a container started (gate, 2026-10-22).
 */
const UP = [
  '-f',
  'docker/docker-compose.yml',
  '-f',
  'docker/docker-compose.override.yml',
  'up',
  '-d',
];

describe('APP-024 compose wrapper and the optional override', () => {
  it('names the override as optional', () => {
    expect(OPTIONAL_COMPOSE_FILES).toEqual(['docker/docker-compose.override.yml']);
  });

  it('drops the override when the file is absent and keeps everything else in order', () => {
    expect(composeArgs(UP, () => false)).toEqual(['-f', 'docker/docker-compose.yml', 'up', '-d']);
  });

  it('keeps the override when it exists', () => {
    expect(composeArgs(UP, () => true)).toEqual(UP);
  });

  it('never drops the base compose file, so a missing one still errors', () => {
    expect(composeArgs(['-f', 'docker/docker-compose.yml', 'ps'], () => false)).toEqual([
      '-f',
      'docker/docker-compose.yml',
      'ps',
    ]);
  });

  it('leaves argument lists without -f untouched', () => {
    expect(composeArgs(['ps', '--format', 'json'], () => false)).toEqual([
      'ps',
      '--format',
      'json',
    ]);
  });
});
