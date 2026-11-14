import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parsePreviewApproval,
  privatePreviewDirectory,
  verifyPreviewDatabase,
} from '../../../scripts/start-project-preview.mjs';
const roots: string[] = [];
const databaseHost = 'approved.example.rds.amazonaws.com';
const projectName = 'preview-project';
const grant = () => ({
  projectName,
  applicationId: '33333333-3333-4333-8333-333333333333',
  databaseHost,
  relayHost: 'srv.us',
  httpsDomains: ['api.example.com'],
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
});
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe('TOOL-017 project public preview boundaries', () => {
  it('accepts only an explicit project-matched approval within the approved eight-hour window', () => {
    const approval = grant();
    expect(
      parsePreviewApproval(JSON.stringify(approval), projectName, approval.expiresAt),
    ).toMatchObject(approval);
    for (const patch of [
      { projectName: 'other' },
      { relayHost: 'evil.example.com' },
      { databaseHost: '127.0.0.1' },
      { applicationId: '' },
      { extra: true },
      { expiresAt: new Date(Date.now() - 1).toISOString() },
    ])
      expect(() =>
        parsePreviewApproval(
          JSON.stringify({ ...approval, ...patch }),
          projectName,
          approval.expiresAt,
        ),
      ).toThrow();
    expect(() =>
      parsePreviewApproval(
        JSON.stringify(approval),
        projectName,
        new Date(Date.now() + 9 * 3600000).toISOString(),
      ),
    ).toThrow();
  });
  it('keeps private state owner-only and refuses parent and key symlinks', () => {
    const root = mkdtempSync(join(tmpdir(), 'preview-'));
    roots.push(root);
    const dir = privatePreviewDirectory(root);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    symlinkSync('/tmp', join(dir, 'id_rsa'));
    expect(() => privatePreviewDirectory(root)).toThrow(/symlink/);
    const other = mkdtempSync(join(tmpdir(), 'preview-'));
    roots.push(other);
    symlinkSync('/tmp', join(other, '.precast'));
    expect(() => privatePreviewDirectory(other)).toThrow(/symlink/);
  });
  it('checks the real database identity with a trusted CA and rejects an administrator role', async () => {
    const root = mkdtempSync(join(tmpdir(), 'preview-'));
    roots.push(root);
    mkdirSync(join(root, 'scripts/certs'), { recursive: true });
    writeFileSync(join(root, 'scripts/certs/rds-global-bundle.pem'), 'trusted-ca');
    const query = vi.fn(async (sql: string) => ({
      rows: sql.startsWith('SELECT 1')
        ? [{ ok: 1 }]
        : [
            {
              database: 'project',
              username: 'owner',
              rolsuper: false,
              rolcreatedb: false,
              rolcreaterole: false,
            },
          ],
    }));
    const client = { connect: vi.fn(), query, end: vi.fn() };
    const connect = vi.fn(() => client);
    await verifyPreviewDatabase(
      root,
      { DATABASE_URL: `postgresql://owner:private@${databaseHost}/project?sslmode=require` },
      databaseHost,
      connect,
    );
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { ca: 'trusted-ca', rejectUnauthorized: true } }),
    );
    expect(client.end).toHaveBeenCalledOnce();
    query.mockResolvedValueOnce({ rows: [{ ok: 1 }] } as never).mockResolvedValueOnce({
      rows: [
        {
          database: 'project',
          username: 'owner',
          rolsuper: true,
          rolcreatedb: false,
          rolcreaterole: false,
        },
      ],
    } as never);
    await expect(
      verifyPreviewDatabase(
        root,
        { DATABASE_URL: `postgresql://owner:private@${databaseHost}/project` },
        databaseHost,
        connect,
      ),
    ).rejects.toThrow(/role/);
    await expect(
      verifyPreviewDatabase(
        root,
        { DATABASE_URL: 'postgresql://owner:private@localhost/project' },
        databaseHost,
        connect,
      ),
    ).rejects.toThrow(/mismatch/);
  });
});

describe('TOOL-020 existing database public preview', () => {
  it('requires explicit existing-database approval for a Supabase host', () => {
    const existing = {
      ...grant(),
      databaseMode: 'existing',
      databaseHost: 'aws-0-ap-southeast-1.pooler.supabase.com',
    };
    expect(
      parsePreviewApproval(JSON.stringify(existing), projectName, existing.expiresAt),
    ).toMatchObject(existing);
    const implicit = Object.fromEntries(
      Object.entries(existing).filter(([key]) => key !== 'databaseMode'),
    );
    expect(() =>
      parsePreviewApproval(JSON.stringify(implicit), projectName, existing.expiresAt),
    ).toThrow();
  });
  it('verifies the reused postgres database and pooled role using strict TLS and read-only checks', async () => {
    const host = 'aws-0-ap-southeast-1.pooler.supabase.com';
    const client = {
      connect: vi.fn(),
      end: vi.fn(),
      query: vi.fn(async (sql: string) => ({
        rows: sql.startsWith('SELECT 1')
          ? [{ ok: 1 }]
          : [
              {
                database: 'postgres',
                username: 'scaffold_runtime',
                rolsuper: false,
                rolcreatedb: false,
                rolcreaterole: false,
              },
            ],
      })),
    };
    const connect = vi.fn(() => client);
    await verifyPreviewDatabase(
      '/unused',
      {
        DATABASE_URL: `postgresql://scaffold_runtime.abcdefghijklmnopqrst:private@${host}/postgres?sslmode=verify-full`,
      },
      host,
      connect,
      { reuse: true, databaseName: 'postgres', databaseUser: 'scaffold_runtime' },
    );
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { rejectUnauthorized: true } }),
    );
    expect(client.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
    expect(client.end).toHaveBeenCalledOnce();
  });
});
