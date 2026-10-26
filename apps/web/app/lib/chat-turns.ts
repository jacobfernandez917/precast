import type { A2aTaskState, A2aTransport } from './a2a-client';

/**
 * The browser side of one chat turn, kept free of React so it can be tested on
 * its own (WEB-019, WEB-020).
 *
 * "Start over" can happen while a turn is still in flight. Aborting the browser's
 * fetch would not stop the agent (the route and the agent carry on regardless),
 * and an answer that arrives afterwards belongs to the conversation that was
 * cleared. So every turn takes a token when it starts, a reset invalidates every
 * token handed out before it, and a turn whose token is no longer current
 * changes nothing: not the messages, not the error, not the loading state, not
 * the conversation id.
 */
export interface ConversationGate {
  /** A token for a turn starting now. */
  begin(): number;
  /** True while no reset has happened since `token` was handed out. */
  isCurrent(token: number): boolean;
  /** Start a new conversation: every earlier token stops being current. */
  reset(): void;
}

export function createConversationGate(): ConversationGate {
  let generation = 0;
  return {
    begin: () => generation,
    isCurrent: (token) => token === generation,
    reset: () => {
      generation += 1;
    },
  };
}

/** What one turn came back as, ready to show. */
export type TurnOutcome =
  | {
      kind: 'reply';
      answer: string;
      a2ui: unknown[];
      via: A2aTransport;
      taskState?: A2aTaskState;
      conversationId?: string;
    }
  | { kind: 'error'; error: string; conversationId?: string };

const WAITING_TEXT: Partial<Record<A2aTaskState, string>> = {
  'input-required': 'The agent needs more information to continue. Reply to answer it.',
  'auth-required': 'The agent needs an account connected before it can continue.',
  submitted: 'The agent has the request and has not started on it yet.',
  working: 'The agent is still working on this.',
};

/**
 * Turn the route's answer into something to show. Any status and any body: a
 * proxy's HTML error page or an empty body becomes an error with the status in
 * it, never an exception in the component.
 */
export function interpretRouteReply(status: number, bodyText: string): TurnOutcome {
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    // handled below
  }
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : undefined;

  const okStatus = status >= 200 && status <= 299;
  if (!okStatus || !body || body.ok !== true) {
    const error =
      typeof body?.error === 'string' && body.error
        ? body.error
        : okStatus
          ? 'The agent sent an answer this page cannot read.'
          : `The request failed (HTTP ${status}).`;
    return { kind: 'error', error, conversationId };
  }

  const taskState =
    typeof body.taskState === 'string' ? (body.taskState as A2aTaskState) : undefined;
  const text = typeof body.text === 'string' && body.text ? body.text : null;
  return {
    kind: 'reply',
    answer: text ?? (taskState && WAITING_TEXT[taskState]) ?? '(no text content)',
    a2ui: Array.isArray(body.a2ui) ? body.a2ui : [],
    via: body.via === 'agentbase' ? 'agentbase' : 'direct',
    ...(taskState ? { taskState } : {}),
    conversationId,
  };
}
