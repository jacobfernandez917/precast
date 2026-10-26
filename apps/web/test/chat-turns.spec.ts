import { describe, expect, it } from 'vitest';
import { createConversationGate, interpretRouteReply } from '../app/lib/chat-turns';

/**
 * WEB-020: the chat's turn bookkeeping. "Start over" invalidates every turn that
 * began before it, so an answer arriving afterwards (success or failure, typed
 * message or card press) changes nothing in the new conversation. E2E-007 drives
 * the same race in a browser.
 */
describe('createConversationGate', () => {
  it('a turn stays current until a reset, and only turns begun after it count afterwards', () => {
    const gate = createConversationGate();
    const before = gate.begin();
    expect(gate.isCurrent(before)).toBe(true);
    gate.reset();
    expect(gate.isCurrent(before), 'an answer to the cleared conversation').toBe(false);
    const after = gate.begin();
    expect(gate.isCurrent(after)).toBe(true);
    gate.reset();
    gate.reset();
    expect(gate.isCurrent(after)).toBe(false);
  });
});

/** WEB-021: any status and any body become something the chat can show. */
describe('interpretRouteReply', () => {
  it('a 200 reply becomes a turn with its conversation id', () => {
    const outcome = interpretRouteReply(
      200,
      JSON.stringify({
        ok: true,
        text: 'Done.',
        a2ui: [{ x: 1 }],
        via: 'agentbase',
        conversationId: 'c1',
      }),
    );
    expect(outcome).toEqual({
      kind: 'reply',
      answer: 'Done.',
      a2ui: [{ x: 1 }],
      via: 'agentbase',
      conversationId: 'c1',
    });
  });

  it('a waiting Task with no text says what it is waiting for', () => {
    const outcome = interpretRouteReply(
      200,
      JSON.stringify({
        ok: true,
        text: null,
        a2ui: [],
        via: 'direct',
        taskState: 'working',
        conversationId: 'c1',
      }),
    );
    expect(outcome).toMatchObject({ kind: 'reply', taskState: 'working' });
    expect((outcome as { answer: string }).answer).toMatch(/still working/);
  });

  it("a failure keeps the route's error and conversation id", () => {
    expect(
      interpretRouteReply(
        429,
        JSON.stringify({
          ok: false,
          error: 'The agent call failed (HTTP 429).',
          status: 429,
          conversationId: 'c1',
        }),
      ),
    ).toEqual({ kind: 'error', error: 'The agent call failed (HTTP 429).', conversationId: 'c1' });
  });

  it('a non-JSON body or an empty one is an error with the status, never an exception', () => {
    expect(interpretRouteReply(502, '<html>Bad gateway</html>')).toEqual({
      kind: 'error',
      error: 'The request failed (HTTP 502).',
      conversationId: undefined,
    });
    expect(interpretRouteReply(200, '')).toMatchObject({ kind: 'error' });
    expect(interpretRouteReply(200, JSON.stringify({ ok: false }))).toMatchObject({
      kind: 'error',
    });
  });
});
