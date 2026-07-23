import { NextResponse } from 'next/server';
import { callAgent, type AgentReply } from '../../../lib/a2a-client';
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
 * Request body: { text: string; sessionId?: string }
 * Returns a normalized { ok, text, error?, via, raw } reply.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<NextResponse<AgentReply | { error: string }>> {
  const { agentId } = await params;
  log.info({ agentId }, 'POST /api/a2a — incoming agent call');

  if (!agentId) {
    log.warn('POST /api/a2a rejected — missing agentId');
    return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    sessionId?: string;
  } | null;

  if (!body || typeof body.text !== 'string' || body.text.trim().length === 0) {
    log.warn({ agentId }, 'POST /api/a2a rejected — missing or invalid text field');
    return NextResponse.json({ error: 'Missing or invalid text field' }, { status: 400 });
  }

  const reply = await callAgent(agentId, body.text, {
    sessionId: body.sessionId,
  });

  if (reply.ok) {
    log.info({ agentId, via: reply.via }, 'POST /api/a2a — agent replied');
  } else {
    log.error({ agentId, via: reply.via, error: reply.error }, 'POST /api/a2a — agent call failed');
  }

  return NextResponse.json(reply);
}
