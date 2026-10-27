import { NextResponse } from 'next/server';
import { pressText, readPressAction } from '@precast/a2ui';
import { callAgent, type AgentRouteBody } from '../../../lib/a2a-client';
import { resolveAgentContext } from '../../../lib/agent-context';
import { getSignedInUser } from '../../../lib/auth';
import { chatTurnLimiter } from '../../../lib/rate-limit';
import { log } from '../../../lib/logger';

/**
 * POST /api/a2a/:agentId
 *
 * Frontend-facing proxy route that forwards chat messages to a Mastra agent.
 * Depending on `PRECAST_LOCAL_AGENTS`, `callAgent()` either proxies through the
 * AgentBase A2A proxy or calls the Mastra A2A endpoint directly. This is the
 * ONLY route the client should use to talk to agents — never call Mastra
 * directly from client code.
 *
 * Request body: `{ text: string; conversationId?: string }`, or, for a press on a card the
 * agent drew, `{ action: { name, value?, surfaceId?, sourceComponentId?, context? };
 * conversationId?: string }`. A press is sent to the agent as text (`pressText`), never as a
 * data part: Mastra fails a turn on data parts, and text survives every transport.
 *
 * SIGN-IN REQUIRED: a request without a session gets 401 before anything else
 * is read. Each person's turns are rate limited (app/lib/rate-limit.ts), and the
 * agent is told who the turn acts for (`X-AgentBase-On-Behalf-Of`), so tools
 * use that person's connected accounts.
 *
 * IDENTITY: the memory scope (`resourceId`) and the thread id are derived
 * SERVER-SIDE by `resolveAgentContext()` from the signed-in user and are
 * deliberately not accepted from the body. `conversationId` is the only client-influenced input; it is
 * sanitized and namespaced under the caller's own resource before use, so it
 * cannot address another user's thread. See `app/lib/agent-context.ts`.
 *
 * Returns `{ ok: true, text, a2ui, via, taskState?, conversationId }` with 200, or
 * `{ ok: false, error, status, via?, conversationId? }` with the failure's status: the
 * upstream HTTP status when AgentBase or the agent answered with one, 502 when the
 * answer could not be used, 504 on a timeout. `conversationId` is what the browser
 * sends on the next turn to stay in the same thread, failures included. The raw
 * upstream reply is never forwarded: Mastra echoes the A2A `contextId`, which
 * contains the resourceId this route keeps out of the browser.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<NextResponse<AgentRouteBody | { error: string }>> {
  const { agentId } = await params;
  log.info({ agentId }, 'POST /api/a2a — incoming agent call');

  const user = await getSignedInUser(request.headers);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Sign in to chat with the agent.', status: 401 },
      { status: 401 },
    );
  }

  if (!agentId) {
    log.warn('POST /api/a2a rejected — missing agentId');
    return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    action?: unknown;
    conversationId?: unknown;
  } | null;

  // A press carries no text of its own; the action's fields are checked and bounded first.
  const press = body?.action !== undefined ? readPressAction(body.action) : null;
  if (body?.action !== undefined && !press) {
    log.warn({ agentId }, 'POST /api/a2a rejected — invalid action');
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
  const text = press ? pressText(press) : body?.text;

  if (typeof text !== 'string' || text.trim().length === 0) {
    log.warn({ agentId }, 'POST /api/a2a rejected — missing or invalid text field');
    return NextResponse.json({ error: 'Missing or invalid text field' }, { status: 400 });
  }

  const requestedConversation =
    typeof body?.conversationId === 'string' ? body.conversationId : undefined;

  const allowed = chatTurnLimiter.take(user.id);
  if (!allowed.ok) {
    log.warn({ agentId, retryAfter: allowed.retryAfterSeconds }, 'POST /api/a2a — rate limited');
    return NextResponse.json(
      {
        ok: false,
        error: 'You are sending messages faster than this app allows. Wait a moment and try again.',
        status: 429,
      },
      { status: 429, headers: { 'Retry-After': String(allowed.retryAfterSeconds) } },
    );
  }

  try {
    const { resourceId, threadId, conversationId } = resolveAgentContext(
      user,
      requestedConversation,
    );

    const reply = await callAgent(agentId, text, { threadId, resourceId, onBehalfOf: user.id });

    if (reply.ok) {
      log.info(
        {
          agentId,
          via: reply.via,
          press: Boolean(press),
          cards: reply.a2ui.length,
          taskState: reply.taskState,
        },
        'POST /api/a2a — agent replied',
      );
      return NextResponse.json({
        ok: true,
        text: reply.text,
        a2ui: reply.a2ui,
        via: reply.via,
        ...(reply.taskState ? { taskState: reply.taskState } : {}),
        conversationId,
      });
    }

    const status = reply.status >= 400 && reply.status <= 599 ? reply.status : 502;
    log.error(
      { agentId, via: reply.via, status, taskState: reply.taskState, error: reply.error },
      'POST /api/a2a — agent call failed',
    );
    return NextResponse.json(
      {
        ok: false,
        error: reply.error ?? 'The agent call failed.',
        status,
        via: reply.via,
        conversationId,
      },
      { status },
    );
  } catch (err) {
    log.error({ agentId, err: (err as Error)?.message }, 'POST /api/a2a — unexpected failure');
    return NextResponse.json(
      { ok: false, error: 'The agent call failed.', status: 500 },
      { status: 500 },
    );
  }
}
