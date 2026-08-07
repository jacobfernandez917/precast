import { Memory } from '@mastra/memory';
import { getPrecastStore } from './storage';

/**
 * Conversation memory for a Precast agent.
 *
 * ── How a turn gets its memory ───────────────────────────────────────────────
 * Memory is only engaged when the caller supplies a thread. Over A2A, Mastra's
 * handler maps the message's `contextId` onto Mastra's `threadId`, and reads
 * `resourceId` from the message metadata:
 *
 *   const resourceId = metadata?.resourceId ?? message.metadata?.resourceId ?? agentId;
 *   agent.generate(..., contextId ? { threadId: contextId, resourceId } : {})
 *
 * Two consequences worth knowing, because both are easy to get wrong:
 *
 *  1. No `contextId` on the inbound message → no thread → memory is inert. A
 *     call without one is stateless no matter what is configured here.
 *
 *  2. `resourceId` FALLS BACK TO THE AGENT ID. If the caller doesn't send one,
 *     every user on the deployment shares a single resource bucket named after
 *     the agent — so resource-scoped working memory becomes global, and
 *     Mastra's own thread-ownership check (`validateThreadIsOwnedByResource`)
 *     compares every thread against the same pseudo-user and never fails.
 *     The web app therefore always sends a real, server-derived `resourceId`;
 *     see `apps/web/app/lib/agent-context.ts`.
 *
 * ── Why these settings ───────────────────────────────────────────────────────
 * `workingMemory.scope: 'resource'` persists the block across every thread
 * belonging to one user — the right home for durable, user-level facts
 * (preferences, standing instructions), as opposed to what was said in one
 * conversation.
 *
 * `semanticRecall` is left OFF, and that is a deliberate default rather than an
 * omission. Semantic recall retrieves *past chat turns* by similarity, which
 * makes it good at resurfacing superseded statements — an old date, a decision
 * that was later reversed — and presenting them with the same confidence as
 * current ones. Facts that must stay correct belong behind a tool that reads
 * them from a table you control, not in recalled conversation. Turn it on when
 * you actually want fuzzy recall of what was *said*, and note it additionally
 * requires a vector store and an embedder.
 */
export function createAgentMemory(): Memory {
  return new Memory({
    // Shared store — one pool for the process. See lib/storage.ts.
    storage: getPrecastStore(),
    options: {
      // Recent turns replayed verbatim into context.
      lastMessages: 20,
      workingMemory: {
        enabled: true,
        scope: 'resource',
        template: [
          '# User',
          '- Name:',
          '- Preferred style / tone:',
          '',
          '# Standing instructions',
          '- (things this user has asked you to always do)',
          '',
          '# Current focus',
          '- (what they are working on right now)',
        ].join('\n'),
      },
      semanticRecall: false,
    },
  });
}
