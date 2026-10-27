import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * APP-031: the secret prompt, typed into a real terminal. bootstrap and `pnpm connect` both
 * ask through `createPrompt()`; overriding `rl._writeToOutput` (the usual trick, used here
 * before) echoed the secret on Node 25, which is only visible with a terminal on the other
 * end. Python's `pty` provides one; without python3 the case is skipped, not faked.
 */
const MODULE = fileURLToPath(new URL('../../../scripts/connect-agentbase.mjs', import.meta.url));
const hasPython = spawnSync('python3', ['--version']).status === 0;

const CHILD = `
const { createPrompt } = await import(process.env.PROMPT_MODULE);
const p = createPrompt();
const name = await p.ask('Name: ');
const secret = await p.askHidden('Secret: ');
p.close();
console.log('GOT:' + Buffer.from(JSON.stringify([name, secret])).toString('base64'));
`;

// Types each answer once its prompt is on screen, then returns everything the terminal showed.
const DRIVER = `
import os, pty, select, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execvp('node', ['node', '--input-type=module', '-e', sys.argv[1]])
answers = [(b'Name: ', b'jamie'), (b'Secret: ', b'hunter2-typed')]
out = b''
deadline = time.time() + 20
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.2)
    if r:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
    if answers and answers[0][0].rstrip() in out[-200:]:
        time.sleep(0.2)
        os.write(fd, answers.pop(0)[1] + b'\\r')
    if b'GOT:' in out and out.endswith(b'\\n'):
        break
try:
    os.kill(pid, 9)
except OSError:
    pass
sys.stdout.write(out.decode('utf-8', 'replace'))
`;

describe('createPrompt in a real terminal', () => {
  it.skipIf(!hasPython)('echoes an ordinary answer and never the secret', () => {
    const run = spawnSync('python3', ['-I', '-c', DRIVER, CHILD], {
      encoding: 'utf8',
      timeout: 30_000,
      // The path travels in the environment: as argv[1] the module would think it is the
      // entry point and start `pnpm connect` itself.
      env: { ...process.env, PROMPT_MODULE: MODULE },
    });
    const screen = run.stdout;
    const got = /GOT:(\S+)/.exec(screen);
    expect(got, screen).not.toBeNull();
    expect(JSON.parse(Buffer.from(got![1]!, 'base64').toString())).toEqual([
      'jamie',
      'hunter2-typed',
    ]);
    // The ordinary answer shows, so this terminal does show what is typed ...
    expect(screen).toContain('jamie');
    // ... and the secret does not.
    expect(screen).not.toContain('hunter2');
  });
});
