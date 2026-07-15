/**
 * A2A JSON-RPC 2.0 request payload sent to the AgentBase proxy.
 *
 * AgentBase's `POST /a2a` accepts a JSON-RPC 2.0 body and forwards it to the
 * registered agent identified by `agentId` / `skillId`.
 */
export interface A2aRequest {
  jsonrpc: '2.0';
  id: string;
  method: string; // e.g. "tasks/send"
  params: {
    agentId: string;
    sessionId?: string;
    text: string;
    skillId?: string;
    [key: string]: unknown;
  };
}

/**
 * A2A JSON-RPC 2.0 response from the AgentBase proxy.
 */
export interface A2aResponse {
  jsonrpc: '2.0';
  id: string;
  result?: {
    result: {
      message: {
        role: 'assistant';
        content: Array<{ type: 'text'; text: string }>;
      };
      [key: string]: unknown;
    };
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Call an agent through the AgentBase A2A proxy.
 *
 * Server-only: reads `AGENTBASE_URL` / `AGENTBASE_TOKEN` from the environment.
 * All Next → Mastra communication MUST pass through this utility — never call
 * Mastra directly.
 */
export async function callAgent(
  agentId: string,
  text: string,
  options?: {
    sessionId?: string;
    skillId?: string;
    signal?: AbortSignal;
  },
): Promise<A2aResponse> {
  const agentbaseUrl = process.env.AGENTBASE_URL ?? 'https://agentbase.example.com';
  const agentbaseToken = process.env.AGENTBASE_TOKEN ?? '';

  const body: A2aRequest = {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method: 'tasks/send',
    params: {
      agentId,
      text,
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
      ...(options?.skillId ? { skillId: options.skillId } : {}),
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (agentbaseToken) {
    headers['Authorization'] = `Bearer ${agentbaseToken}`;
  }

  const res = await fetch(`${agentbaseUrl}/a2a`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  return (await res.json()) as A2aResponse;
}
