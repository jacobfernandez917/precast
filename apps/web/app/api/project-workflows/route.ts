import { z } from 'zod';
import { projectBrief, prdCapabilities } from '@precast/shared';
import { getSignedInUser } from '../../lib/auth';
import { resolvePrdOwner, PrdAccessError } from '../../lib/prd-teams';
import { PrdDataError } from '../../lib/prd-records';
import { listTestWorkflows, runTestWorkflow, testWorkflowInput } from '../../lib/prd-workflows';

async function handle(request: Request) {
  const user = await getSignedInUser(request.headers);
  if (!user) return Response.json({ error: 'Sign in to use test workflows.' }, { status: 401 });
  if (!projectBrief) return Response.json({ error: 'No product configured.' }, { status: 404 });
  const capabilities = prdCapabilities(projectBrief);
  if (!capabilities.reminders && capabilities.payments !== 'test')
    return Response.json({ error: 'Test workflows are not enabled.' }, { status: 404 });
  try {
    const url = new URL(request.url);
    const workspace = z
      .string()
      .uuid()
      .optional()
      .parse(url.searchParams.get('workspace') ?? undefined);
    const owner = await resolvePrdOwner(user.id, projectBrief, workspace, request.method !== 'GET');
    if (request.method === 'GET')
      return Response.json({ mode: 'test', workflows: await listTestWorkflows(owner) });
    if (
      request.headers.get('origin') !==
      (process.env.BETTER_AUTH_URL?.replace(/\/$/, '') || url.origin)
    )
      return Response.json({ error: 'Use this app to make changes.' }, { status: 403 });
    const input = testWorkflowInput.parse(await request.json());
    if (
      (input.action === 'payment' && capabilities.payments !== 'test') ||
      (input.action !== 'payment' && !capabilities.reminders)
    )
      return Response.json({ error: 'This test workflow is disabled.' }, { status: 403 });
    return Response.json(await runTestWorkflow(owner, input));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json({ error: 'Check the test workflow details.' }, { status: 400 });
    return Response.json(
      {
        error:
          error instanceof PrdAccessError || error instanceof PrdDataError
            ? error.message
            : 'Could not update the test workflow.',
      },
      { status: error instanceof PrdAccessError ? 403 : error instanceof PrdDataError ? 409 : 503 },
    );
  }
}
export const GET = handle;
export const POST = handle;
