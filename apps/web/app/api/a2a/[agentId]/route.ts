import { NextResponse } from 'next/server';
import { pressText, readPressAction } from '@precast/a2ui';
import { callAgent, type AgentReply } from '../../../lib/a2a-client';
import { resolveAgentContext } from '../../../lib/agent-context';
import { log } from '../../../lib/logger';

/**
 * POST /api/a2a/:agentId
 *
 * Frontend-facing proxy route that forwards chat messages to a Mastra agent.
 * Depending on `ENABLE_AGENTBASE`, `callAgent()` either proxies through the
 * AgentBase A2A proxy or calls the Mastra A2A endpoint directly. This is the
 * ONLY route the client should use to talk to agents — never call Mastra
 * directly from client code.
 *
 * Request body: `{ text: string; conversationId?: string }`, or, for a press on a card the
 * agent drew, `{ action: { name, value?, surfaceId?, sourceComponentId?, context? };
 * conversationId?: string }`. A press is sent to the agent as text (`pressText`), never as a
 * data part: Mastra fails a turn on data parts, and text survives every transport.
 *
 * IDENTITY: the memory scope (`resourceId`) and the thread id are derived
 * SERVER-SIDE by `resolveAgentContext()` and are deliberately not accepted from
 * the body. `conversationId` is the only client-influenced input; it is
 * sanitized and namespaced under the caller's own resource before use, so it
 * cannot address another user's thread. See `app/lib/agent-context.ts`.
 *
 * Returns the normalized `{ ok, text, error?, via, raw }` reply plus the
 * `conversationId` the browser should send on the next turn to stay in the same
 * thread.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<NextResponse<(AgentReply & { conversationId: string }) | { error: string }>> {
  const { agentId } = await params;
  log.info({ agentId }, 'POST /api/a2a — incoming agent call');

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
  const { resourceId, threadId, conversationId, isNewResource } =
    await resolveAgentContext(requestedConversation);

  const reply = await callAgent(agentId, text, { threadId, resourceId });

  if (reply.ok) {
    log.info(
      { agentId, via: reply.via, isNewResource, press: Boolean(press), cards: reply.a2ui.length },
      'POST /api/a2a — agent replied',
    );
  } else {
    log.error({ agentId, via: reply.via, error: reply.error }, 'POST /api/a2a — agent call failed');
  }

  return NextResponse.json({ ...reply, conversationId });
}
