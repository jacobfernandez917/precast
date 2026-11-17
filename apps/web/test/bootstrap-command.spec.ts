import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { commandFailureReason } from '../../../scripts/bootstrap-command.mjs';

describe('bootstrap child-process failures', () => {
  it('keeps the exit code of a failed command', () => {
    const result = spawnSync(process.execPath, ['-e', 'process.exit(7)']);
    expect(commandFailureReason(result)).toBe('exit 7');
  });

  it.skipIf(process.platform === 'win32')('reports a child terminated by a signal', () => {
    const result = spawnSync(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")']);
    expect(result.status).toBeNull();
    expect(commandFailureReason(result)).toBe('signal SIGTERM');
  });

  it('distinguishes a command that could not start', () => {
    const result = spawnSync('/precast-missing-bootstrap-command', []);
    expect(commandFailureReason(result)).toBe('spawn ENOENT');
  });

  it('does not describe a missing exit status as success', () => {
    expect(commandFailureReason({ status: null, signal: null })).toBe('exit status unavailable');
  });
});
