import { z } from 'zod';
import { projectBrief, prdCapabilities } from '@precast/shared';
import { getSignedInUser } from '../../lib/auth';
import {
  createPrdWorkspace,
  listPrdWorkspaces,
  setPrdWorkspaceMember,
  PrdAccessError,
} from '../../lib/prd-teams';

const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().trim().min(1).max(80) }).strict(),
  z
    .object({
      action: z.literal('member'),
      workspace: z.string().uuid(),
      member: z.string().uuid(),
      role: z.enum(['editor', 'viewer']).nullable(),
    })
    .strict(),
]);
async function handle(request: Request) {
  const user = await getSignedInUser(request.headers);
  if (!user) return Response.json({ error: 'Sign in to use workspaces.' }, { status: 401 });
  if (!projectBrief || prdCapabilities(projectBrief).collaboration !== 'team')
    return Response.json({ error: 'Team workspaces are not enabled.' }, { status: 404 });
  try {
    if (request.method === 'GET')
      return Response.json({ workspaces: await listPrdWorkspaces(user.id), accountId: user.id });
    const origin = process.env.BETTER_AUTH_URL?.replace(/\/$/, '') || new URL(request.url).origin;
    if (request.headers.get('origin') !== origin)
      return Response.json({ error: 'Use this app to make changes.' }, { status: 403 });
    const parsed = input.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return Response.json({ error: 'Check the workspace details.' }, { status: 400 });
    if (parsed.data.action === 'create')
      return Response.json(
        { id: await createPrdWorkspace(user.id, parsed.data.name) },
        { status: 201 },
      );
    await setPrdWorkspaceMember(
      user.id,
      parsed.data.workspace,
      parsed.data.member,
      parsed.data.role,
    );
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof PrdAccessError ? error.message : 'Could not update the workspace.',
      },
      { status: error instanceof PrdAccessError ? 403 : 503 },
    );
  }
}
export const GET = handle;
export const POST = handle;
