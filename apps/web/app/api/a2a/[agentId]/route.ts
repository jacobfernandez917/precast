import { NextResponse } from 'next/server';
import { callAgent, type AgentReply } from '../../../lib/a2a-client';

/**
 * POST /api/a2a/:agentId
 *
 * Frontend-facing proxy route that forwards chat messages to a Mastra agent.
 * Depending on `ENABLE_AGENTBASE`, `callAgent()` either proxies through the
 * AgentBase A2A proxy or calls the Mastra A2A endpoint directly. This is the
 * ONLY route the client should use to talk to agents — never call Mastra
 * directly from client code.
 *
 * Request body: { text: string; sessionId?: string; skillId?: string }
 * Returns a normalized { ok, text, error?, via, raw } reply.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<NextResponse<AgentReply | { error: string }>> {
  const { agentId } = await params;

  if (!agentId) {
    return NextResponse.json({ error: 'Missing agentId' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    sessionId?: string;
    skillId?: string;
  } | null;

  if (!body || typeof body.text !== 'string' || body.text.trim().length === 0) {
    return NextResponse.json({ error: 'Missing or invalid text field' }, { status: 400 });
  }

  const reply = await callAgent(agentId, body.text, {
    sessionId: body.sessionId,
    skillId: body.skillId,
  });

  return NextResponse.json(reply);
}
