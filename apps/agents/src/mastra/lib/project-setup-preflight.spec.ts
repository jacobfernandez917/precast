import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { projectSetupPreflightCommand, setupPreflightStatus } from './project-setup-preflight';

const grant = {
  projectName: 'expense-tracker',
  applicationId: '00000000-0000-4000-8000-000000000001',
  clientId: 'synthetic-client',
  clientSecret: 'SYNTHETIC_SECRET_SENTINEL',
  apiUrl: 'https://api.example.test',
  tokenUrl: 'https://auth.example.test/realms/test/protocol/openid-connect/token',
  modelSlug: 'gemini-flash',
  modelId: 'gemini-3.5-flash',
  modelListingId: '00000000-0000-4000-8000-000000000002',
  modelOrg: 'synthetic-org',
  hannibalSlug: 'hannibal-postgres',
  hannibalListingId: '00000000-0000-4000-8000-000000000003',
  hannibalOrg: 'synthetic-org',
  databaseHost: 'synthetic.rds.amazonaws.com',
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
};

function check(raw: string, fd: string | undefined = '3', services = 'hannibal-gemini') {
  const command = projectSetupPreflightCommand(
    'expense-tracker',
    services as 'hannibal-gemini' | 'existing-postgres-gemini',
  );
  const content = Buffer.from(raw);
  let offset = 0;
  const readSync = vi.fn((descriptor: number, buffer: Buffer, start: number, size: number) => {
    expect(descriptor).toBe(Number(fd));
    // Partial descriptor reads must work too.
    const count = content.copy(buffer, start, offset, offset + Math.min(size, 19));
    offset += count;
    return count;
  });
  const output = vi.fn();
  const require = vi.fn((module: string) => {
    expect(module).toBe('node:fs');
    // Any filesystem write, network, service or process-spawn attempt fails.
    return { readSync };
  });
  runInNewContext(command.argv[1], {
    require,
    Buffer,
    process: {
      argv: ['node', ...command.argv.slice(2)],
      env: { ['RAYA_SECRET_FD_' + 'PRECAST_PROJECT_SETUP']: fd },
      stdout: { write: output },
    },
  });
  expect(output).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(output.mock.calls)).not.toContain(grant.clientSecret);
  expect(JSON.stringify(command)).not.toContain(grant.clientSecret);
  return { status: setupPreflightStatus.parse(output.mock.calls[0][0]), readSync };
}

describe('AGT-048 read-only setup descriptor preflight', () => {
  it.each(['3', '4', '5', '6'])('accepts an exact valid binding on descriptor %s', (fd) => {
    expect(check(JSON.stringify(grant), fd).status).toBe('ready');
  });
  it.each(['', '0', '1', '2', '7', '/tmp/credential', '3junk'])(
    'refuses descriptor %s without reading',
    (fd) => {
      const result = check(JSON.stringify(grant), fd);
      expect(result.status).toBe('setup_secret_not_granted');
      expect(result.readSync).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['previous project', { projectName: 'previous-project' }, 'setup_project_mismatch'],
    ['similar slug', { projectName: 'expense_tracker' }, 'setup_project_mismatch'],
    ['expired', { expiresAt: '2000-01-01T00:00:00.000Z' }, 'setup_grant_expired'],
    ['invalid expiry', { expiresAt: 'never' }, 'setup_grant_expired'],
    ['unbounded expiry', { expiresAt: '2999-01-01T00:00:00.000Z' }, 'setup_grant_expired'],
    ['missing secret', { clientSecret: undefined }, 'invalid_setup_grant'],
    ['wrong secret type', { clientSecret: 123 }, 'invalid_setup_grant'],
    ['multiline secret', { clientSecret: 'SYNTHETIC\nSECRET' }, 'invalid_setup_grant'],
    ['foreign metadata', { memberId: 'untrusted-member' }, 'invalid_setup_grant'],
  ])('fails closed for %s', (_label, changes, expected) => {
    expect(check(JSON.stringify({ ...grant, ...changes })).status).toBe(expected);
  });
  it.each(['not-json-SYNTHETIC_SECRET_SENTINEL', 'null', '[]', '{}', 'x'.repeat(65537)])(
    'rejects malformed or oversized credentials without echoing them (%#)',
    (raw) => {
      expect(check(raw).status).toBe('invalid_setup_grant');
    },
  );
  it('accepts reuse shape without changing its database or namespace, and rejects the wrong service shape', () => {
    const base: Partial<typeof grant> = { ...grant };
    delete base.hannibalSlug;
    delete base.hannibalListingId;
    delete base.hannibalOrg;
    const reuse = JSON.stringify({
      ...base,
      databaseUrl:
        'postgresql://scoped_owner:SYNTHETIC_DB_SECRET@synthetic.rds.amazonaws.com:5432/expenses',
      databaseName: 'expenses',
    });
    expect(check(reuse, '3', 'existing-postgres-gemini').status).toBe('ready');
    expect(check(reuse).status).toBe('invalid_setup_grant');
    expect(check(JSON.stringify(grant), '3', 'existing-postgres-gemini').status).toBe(
      'invalid_setup_grant',
    );
  });
  it('keeps slug, mode and alias in a fixed command independent of any credential contents', () => {
    const name = 'expense-tracker-01';
    const command = projectSetupPreflightCommand(name, 'existing-postgres-gemini');
    expect(command.cwd).toBe('Projects');
    expect(command.argv.slice(2)).toEqual([name, 'existing-postgres-gemini']);
    expect(command.secrets).toEqual([
      { alias: 'precast_project_setup', purpose: `Check setup access only for ${name}` },
    ]);
  });
});
