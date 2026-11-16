import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  brief: {
    capabilities: { collaboration: 'team', reminders: true, payments: 'test' },
    collections: [],
  },
  user: { id: 'owner', email: 'owner@example.invalid', name: 'Owner' },
  resolve: vi.fn(),
  workspaces: vi.fn(),
  member: vi.fn(),
  list: vi.fn(),
  run: vi.fn(),
}));
vi.mock('@precast/shared', async (orig) => ({
  ...(await orig<typeof import('@precast/shared')>()),
  projectBrief: state.brief,
}));
vi.mock('../app/lib/auth', () => ({ getSignedInUser: async () => state.user }));
vi.mock('../app/lib/prd-teams', () => ({
  resolvePrdOwner: state.resolve,
  listPrdWorkspaces: state.workspaces,
  setPrdWorkspaceMember: state.member,
  createPrdWorkspace: vi.fn(),
  PrdAccessError: class extends Error {},
}));
vi.mock('../app/lib/prd-records', () => ({ PrdDataError: class extends Error {} }));
vi.mock('../app/lib/prd-workflows', async (orig) => ({
  ...(await orig<typeof import('../app/lib/prd-workflows')>()),
  listTestWorkflows: state.list,
  runTestWorkflow: state.run,
}));
import { PrdAccessError } from '../app/lib/prd-teams';
import { POST as workflow } from '../app/api/project-workflows/route';
import { POST as workspace } from '../app/api/project-workspaces/route';
const id = '00000000-0000-4000-8000-000000000001';
const request = (path: string, body: unknown, origin = 'https://app.test') =>
  new Request(`https://app.test/api/${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  state.resolve.mockResolvedValue(`workspace:${id}`);
  state.run.mockResolvedValue({ mode: 'test', charged: false, delivered: false });
});
describe('gated product workspaces and test workflows', () => {
  it('refuses viewer writes and cross-workspace access before scheduling any effect', async () => {
    state.resolve.mockRejectedValue(new PrdAccessError('Permission required.'));
    expect(
      (
        await workflow(
          request(`project-workflows?workspace=${id}`, {
            action: 'payment',
            key: id,
            amountCents: 100,
            currency: 'USD',
            outcome: 'succeeded',
          }),
        )
      ).status,
    ).toBe(403);
    expect(state.run).not.toHaveBeenCalled();
  });
  it('uses the resolved owner and cannot accept a production mode or a client-supplied owner', async () => {
    const body = {
      action: 'payment',
      key: id,
      amountCents: 100,
      currency: 'USD',
      outcome: 'succeeded',
    };
    expect((await workflow(request(`project-workflows?workspace=${id}`, body))).status).toBe(200);
    expect(state.run).toHaveBeenCalledWith(`workspace:${id}`, body);
    for (const extra of [{ mode: 'live' }, { owner: 'someone-else' }])
      expect((await workflow(request('project-workflows', { ...body, ...extra }))).status).toBe(
        400,
      );
    expect(state.run).toHaveBeenCalledTimes(1);
  });
  it('rejects cross-origin member changes and requires valid exact account identity', async () => {
    const body = { action: 'member', workspace: id, member: id, role: 'editor' };
    expect((await workspace(request('project-workspaces', body, 'https://evil.test'))).status).toBe(
      403,
    );
    expect(
      (
        await workspace(
          request('project-workspaces', { ...body, member: 'guessed-email@example.invalid' }),
        )
      ).status,
    ).toBe(400);
    expect(state.member).not.toHaveBeenCalled();
  });
});
