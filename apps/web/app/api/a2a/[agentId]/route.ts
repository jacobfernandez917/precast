import { NextResponse } from 'next/server';
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
 * Request body: `{ text: string; conversationId?: string }`
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
    conversationId?: unknown;
  } | null;

  if (!body || typeof body.text !== 'string' || body.text.trim().length === 0) {
    log.warn({ agentId }, 'POST /api/a2a rejected — missing or invalid text field');
    return NextResponse.json({ error: 'Missing or invalid text field' }, { status: 400 });
  }

  const requestedConversation =
    typeof body.conversationId === 'string' ? body.conversationId : undefined;
  const { resourceId, threadId, conversationId, isNewResource } =
    await resolveAgentContext(requestedConversation);

  const reply = await callAgent(agentId, body.text, { threadId, resourceId });

  if (reply.ok) {
    log.info({ agentId, via: reply.via, isNewResource }, 'POST /api/a2a — agent replied');
  } else {
    log.error({ agentId, via: reply.via, error: reply.error }, 'POST /api/a2a — agent call failed');
  }

  return NextResponse.json({ ...reply, conversationId });
}
