import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@precast/shared', async (original) => ({
  ...(await original<typeof import('@precast/shared')>()),
  projectBrief: {
    collections: [
      {
        id: 'actions',
        fields: [
          { id: 'title', label: 'Title', type: 'text', required: true, choices: [] },
          {
            id: 'status',
            label: 'Status',
            type: 'choice',
            required: true,
            choices: ['Open', 'Done'],
          },
        ],
      },
    ],
  },
}));
vi.mock('../app/lib/auth', () => ({ getSignedInUser: vi.fn() }));
vi.mock('../app/lib/prd-records', () => ({
  listPrdRecords: vi.fn(),
  savePrdRecord: vi.fn(),
  deletePrdRecord: vi.fn(),
}));
import { GET, POST, PATCH, DELETE } from '../app/api/project-records/route';
import { getSignedInUser } from '../app/lib/auth';
import { listPrdRecords, savePrdRecord, deletePrdRecord } from '../app/lib/prd-records';

const user = { id: 'account-one', name: 'Test', email: 'test@example.invalid' };
const id = '00000000-0000-4000-8000-000000000001';
const req = (method: string, body?: unknown, origin = 'https://app.test') =>
  new Request(
    'https://app.test/api/project-records' + (method === 'GET' ? '?collection=actions' : ''),
    {
      method,
      headers: { 'content-type': 'application/json', origin },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSignedInUser).mockResolvedValue(user);
  vi.mocked(listPrdRecords).mockResolvedValue([]);
  vi.mocked(savePrdRecord).mockResolvedValue(id);
  vi.mocked(deletePrdRecord).mockResolvedValue(true);
  vi.stubEnv('BETTER_AUTH_URL', 'https://app.test');
});
afterEach(() => vi.unstubAllEnvs());

describe('WEB-043 authenticated PRD records', () => {
  it.each([GET, POST, PATCH, DELETE])(
    'refuses anonymous access before touching storage',
    async (handle) => {
      vi.mocked(getSignedInUser).mockResolvedValue(null);
      expect((await handle(req('GET'))).status).toBe(401);
      expect(listPrdRecords).not.toHaveBeenCalled();
      expect(savePrdRecord).not.toHaveBeenCalled();
      expect(deletePrdRecord).not.toHaveBeenCalled();
    },
  );
  it('uses the server-derived owner on list, create, edit and delete', async () => {
    expect((await GET(req('GET'))).status).toBe(200);
    expect(listPrdRecords).toHaveBeenCalledWith(user.id, 'actions');
    const data = { title: 'Ship action desk', status: 'Open' };
    expect((await POST(req('POST', { collection: 'actions', data }))).status).toBe(201);
    expect(savePrdRecord).toHaveBeenLastCalledWith(
      user.id,
      expect.objectContaining({ id: 'actions' }),
      data,
      undefined,
    );
    expect(
      (await PATCH(req('PATCH', { collection: 'actions', id, data: { ...data, status: 'Done' } })))
        .status,
    ).toBe(200);
    expect(savePrdRecord).toHaveBeenLastCalledWith(
      user.id,
      expect.anything(),
      { ...data, status: 'Done' },
      id,
    );
    expect((await DELETE(req('DELETE', { collection: 'actions', id }))).status).toBe(200);
    expect(deletePrdRecord).toHaveBeenCalledWith(user.id, 'actions', id);
  });
  it('refuses cross-origin writes and owner injection', async () => {
    expect(
      (await POST(req('POST', { collection: 'actions', data: {} }, 'https://evil.test'))).status,
    ).toBe(403);
    expect(
      (
        await POST(
          req('POST', {
            collection: 'actions',
            owner: 'another-account',
            data: { title: 'X', status: 'Open' },
          }),
        )
      ).status,
    ).toBe(400);
    expect(savePrdRecord).not.toHaveBeenCalled();
  });
  it('rejects invalid fields, invented enum values and missing update identity', async () => {
    for (const data of [
      { title: '', status: 'Open' },
      { title: 'X', status: 'Invented' },
      { title: 'X', status: 'Open', injected: true },
    ])
      expect((await POST(req('POST', { collection: 'actions', data }))).status).toBe(400);
    expect(
      (await PATCH(req('PATCH', { collection: 'actions', data: { title: 'X', status: 'Open' } })))
        .status,
    ).toBe(400);
    expect(savePrdRecord).not.toHaveBeenCalled();
  });
  it('does not reveal another owner’s record or database error details', async () => {
    vi.mocked(savePrdRecord).mockResolvedValue(null);
    expect(
      (
        await PATCH(
          req('PATCH', { collection: 'actions', id, data: { title: 'X', status: 'Open' } }),
        )
      ).status,
    ).toBe(404);
    vi.mocked(listPrdRecords).mockRejectedValue(new Error('private database detail'));
    const response = await GET(req('GET'));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private database detail');
  });
});
