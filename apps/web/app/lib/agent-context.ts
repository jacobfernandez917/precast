import { randomUUID } from 'node:crypto';

/**
 * Who the agent is talking to, and in which conversation.
 *
 * These two ids are what make agent memory multi-tenant, so both are derived
 * **server-side**. Neither is ever read from the request body — that is the
 * whole point of this module.
 *
 * ── The vulnerability this closes ────────────────────────────────────────────
 * Mastra's A2A handler resolves a turn's memory scope like this:
 *
 *   const resourceId = metadata?.resourceId ?? message.metadata?.resourceId ?? agentId;
 *   agent.generate(..., contextId ? { threadId: contextId, resourceId } : {})
 *
 * `Memory.recall()` then calls `validateThreadIsOwnedByResource(threadId,
 * resourceId)` and rejects a thread owned by a different resource. That check
 * is the real defence — but it is only worth anything if `resourceId` is a
 * genuine per-user value. Left unset it falls back to the AGENT ID, so every
 * user on the deployment shares one resource, every thread "belongs" to it,
 * and the ownership check passes for everyone. Reading either id from the
 * client would reintroduce the same hole from the other side.
 *
 * ── The model here ───────────────────────────────────────────────────────────
 * People sign in before they can chat (app/lib/auth.ts), and `resourceId` is
 * `account-<user id>` from the verified session, so a person's memory follows
 * their account to any device and is nobody else's. The caller passes the user
 * it got from `getSignedInUser()`; nothing from the request body is involved.
 *
 * `threadId` is namespaced under the resource (`<resourceId>::<conversation>`).
 * The client picks the conversation segment, but the server owns the prefix, so
 * no client-supplied value can address another user's thread — the id simply
 * cannot be spelled. This is defence in depth layered under Mastra's ownership
 * check, not a replacement for it.
 */

/** Separates the server-owned resource prefix from the client's conversation id. */
const THREAD_SEPARATOR = '::';

export interface AgentContext {
  /** Stable per-user id. Mastra's memory `resourceId`. Never sent to the browser. */
  resourceId: string;
  /** Resource-namespaced conversation id. Sent as the A2A `contextId`. */
  threadId: string;
  /**
   * The client's segment of {@link threadId}, safe to return to the browser so
   * it can stay in this conversation on the next turn. The resource prefix is
   * deliberately not included.
   */
  conversationId: string;
}

/**
 * Restrict the client's share of the thread id to characters that can't be used
 * to smuggle in a separator and climb out of the namespace. Anything else is
 * replaced, and the result is length-capped.
 */
export function sanitizeConversationId(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Build the namespaced thread id. Exported for the fitness test — the guarantee
 * being asserted is that the resource prefix is always present, so a client id
 * can never address another resource's thread.
 */
export function buildThreadId(resourceId: string, conversationId: string): string {
  return `${resourceId}${THREAD_SEPARATOR}${conversationId}`;
}

/** The memory scope for a signed-in person. */
export function resourceIdFor(user: { id: string }): string {
  return `account-${user.id}`;
}

/**
 * Resolve the full agent context for a signed-in person's turn.
 *
 * `conversationId` is the ONLY client-influenced input, and it is sanitized and
 * namespaced before use. Pass the value the browser is tracking for the current
 * chat; omit it to start a fresh conversation.
 */
export function resolveAgentContext(
  user: { id: string },
  conversationId?: string | null,
): AgentContext {
  const resourceId = resourceIdFor(user);
  const conversation = sanitizeConversationId(conversationId) ?? randomUUID();
  return {
    resourceId,
    threadId: buildThreadId(resourceId, conversation),
    conversationId: conversation,
  };
}
