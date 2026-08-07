import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';

// Server-only by construction: importing `next/headers` into a client component
// is a build error, so this module cannot be pulled into the browser bundle.

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
 * `resourceId` is an opaque, server-generated UUID kept in an httpOnly cookie.
 * A caller cannot read it from JavaScript and cannot usefully forge one: values
 * are unguessable, so presenting someone else's requires already knowing it.
 * This is the standard opaque-session-identifier model — the cookie needs no
 * signature because its value carries no structure to tamper with.
 *
 * `threadId` is namespaced under the resource (`<resourceId>::<conversation>`).
 * The client picks the conversation segment, but the server owns the prefix, so
 * no client-supplied value can address another user's thread — the id simply
 * cannot be spelled. This is defence in depth layered under Mastra's ownership
 * check, not a replacement for it.
 *
 * ── Replacing this with real auth ────────────────────────────────────────────
 * The anonymous cookie is a stand-in so the boilerplate is safe by default, not
 * an identity system. Precast ships Keycloak for dev (CLAUDE.md §4.5); when you
 * wire OIDC, return the verified token's `sub` from `resolveResourceId()` and
 * delete the cookie path. Nothing else in the app needs to change — every
 * caller goes through `resolveAgentContext()`.
 */

const RESOURCE_COOKIE = 'precast_rid';
/** Separates the server-owned resource prefix from the client's conversation id. */
const THREAD_SEPARATOR = '::';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

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
  /** True when this request minted a new resource id (no usable cookie). */
  isNewResource: boolean;
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

/**
 * Read the caller's resource id from its httpOnly cookie, minting one on first
 * visit.
 *
 * Next.js only permits setting a cookie from a Server Action or Route Handler.
 * This is called from the A2A route handler, so the write is allowed; the
 * try/catch keeps it usable from a Server Component (where the mint still
 * returns a working id for the request, it just won't persist).
 */
async function resolveResourceId(): Promise<{ resourceId: string; isNewResource: boolean }> {
  const jar = await cookies();
  const existing = jar.get(RESOURCE_COOKIE)?.value;

  // Only accept a well-formed value — a malformed cookie is treated as absent
  // rather than trusted into the memory key.
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) {
    return { resourceId: existing, isNewResource: false };
  }

  const resourceId = randomUUID();
  try {
    jar.set(RESOURCE_COOKIE, resourceId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
  } catch {
    // Read-only cookie context (Server Component). The id is still valid for
    // this request; the next route-handler call will persist one.
  }
  return { resourceId, isNewResource: true };
}

/**
 * Resolve the full agent context for a request.
 *
 * `conversationId` is the ONLY client-influenced input, and it is sanitized and
 * namespaced before use. Pass the value the browser is tracking for the current
 * chat; omit it to start a fresh conversation.
 */
export async function resolveAgentContext(conversationId?: string | null): Promise<AgentContext> {
  const { resourceId, isNewResource } = await resolveResourceId();
  const conversation = sanitizeConversationId(conversationId) ?? randomUUID();
  return {
    resourceId,
    threadId: buildThreadId(resourceId, conversation),
    conversationId: conversation,
    isNewResource,
  };
}
