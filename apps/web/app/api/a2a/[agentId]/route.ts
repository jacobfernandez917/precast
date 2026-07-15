import { NextResponse } from 'next/server';
import { callAgent, type A2aResponse } from '../../../lib/a2a-client';

/**
 * POST /api/a2a/:agentId
 *
 * Frontend-facing proxy route that forwards chat messages to a Mastra agent
 * through the AgentBase A2A proxy. This is the ONLY route the client should use
 * to talk to agents — never call Mastra directly from client code.
 *
 * Request body: { text: string; sessionId?: string; skillId?: string }
 * Returns the full A2A JSON-RPC 2.0 response.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<NextResponse<A2aResponse | { error: string }>> {
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

  const result = await callAgent(agentId, body.text, {
    sessionId: body.sessionId,
    skillId: body.skillId,
  });

  return NextResponse.json(result);
}
