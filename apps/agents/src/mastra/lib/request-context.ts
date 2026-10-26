import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * OBO-1 — carry the calling end user's identity through a turn.
 *
 * AgentBase supports end-user delegation: a caller sends
 * `X-AgentBase-On-Behalf-Of: <subject>` and the platform resolves THAT PERSON'S
 * connected account for a user-mode MCP server. Without it, every MCP call an
 * agent makes runs as the container's own identity — and against a user-mode
 * server that answers `401 mcp_server_authorization_required`, which reaches the
 * operator as "connect your account" for an account that is already connected.
 *
 * The subject is captured once by the auth middleware and read wherever a call
 * goes back out to AgentBase, so it does not have to be threaded through every
 * agent, tool and helper in between. `AsyncLocalStorage` keeps it correct under
 * concurrency: two requests in flight each see their own store.
 *
 * THREE SECURITY PROPERTIES, none of them incidental:
 *
 *  1. **Header only, never a request body.** The header is trustworthy because
 *     AgentBase's proxy sets it, and only for an OBO-enabled Application calling
 *     an agent it hosts. A body field is attacker-controlled — reading a subject
 *     from one would let any caller impersonate any user.
 *  2. **Sent only back to AgentBase.** The outbound wrapper returns early for
 *     any other host. An agent that calls a third-party endpoint must not leak
 *     who its user is to that endpoint.
 *  3. **Absent means absent.** No subject → the header is not sent → behaviour
 *     is exactly as before this existed. No default, no fallback identity.
 */

/** The header AgentBase sets, lowercased — matches `proxy.service.ts`. */
export const ON_BEHALF_OF_HEADER = 'x-agentbase-on-behalf-of';

export interface RequestContext {
  /** The end-user subject this turn acts for, e.g. `U03A8NAEH39`. */
  onBehalfOf?: string;
  /**
   * The card `show_card` drew during this turn, as A2UI messages, waiting for the A2UI middleware
   * to attach it to the reply. Set by the tool, taken once by the middleware.
   */
  pendingCard?: unknown[];
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with a request context visible to everything it awaits. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * The end-user subject for the current turn, or `undefined` outside one.
 *
 * Exported so a project doing its own bespoke MCP or HTTP call can use the same
 * subject rather than inventing a parallel mechanism — which is what a derived
 * project had to do before this existed.
 */
export function currentOnBehalfOf(): string | undefined {
  return storage.getStore()?.onBehalfOf;
}

/**
 * Hold a card for the current turn's reply. A later call replaces an earlier one, so an agent that
 * corrects its card sends the corrected one. Returns false outside a request, where no reply will
 * ever pick it up.
 */
export function setPendingCard(messages: unknown[]): boolean {
  const store = storage.getStore();
  if (!store) return false;
  store.pendingCard = messages;
  return true;
}

/** The card waiting for this turn's reply, removed so it can be attached once. */
export function takePendingCard(): unknown[] | undefined {
  const store = storage.getStore();
  const card = store?.pendingCard;
  if (store) delete store.pendingCard;
  return card;
}

/**
 * The subject to act as, applying the documented precedence:
 *
 *   explicit input  >  inbound header  >  project-specific source  >  none
 *
 * An explicit argument wins because a tool that was *told* which user to act for
 * is being deliberate. The inbound header comes next because AgentBase vouched
 * for it. A project's own source (a session cookie, a stored mapping) is last
 * because only that project can judge it — and is passed as a thunk so it is
 * never consulted when something more authoritative already answered.
 */
export function resolveOnBehalfOf(options?: {
  explicit?: string;
  projectFallback?: () => string | undefined;
}): string | undefined {
  const explicit = options?.explicit?.trim();
  if (explicit) return explicit;

  const inbound = currentOnBehalfOf();
  if (inbound) return inbound;

  return options?.projectFallback?.()?.trim() || undefined;
}

/**
 * Add the subject to `headers`, but only for a request going to AgentBase.
 *
 * The host check is the whole point — see property 2 above. `base` is the
 * AgentBase origin this container talks to; anything else is a third party.
 */
export function attachOnBehalfOf(
  headers: Headers,
  url: string,
  base: string | undefined,
  subject: string | undefined = currentOnBehalfOf(),
): void {
  if (!base) return;
  try {
    // ORIGIN comparison, not a string prefix: `startsWith(base)` would accept
    // `https://api.agentbase.example.com.evil.com` and hand a user's identity to
    // whoever owns that domain.
    if (new URL(url).origin !== new URL(base).origin) return;
  } catch {
    return; // unparseable → treat as foreign, and send nothing
  }

  if (subject) headers.set(ON_BEHALF_OF_HEADER, subject);
}
