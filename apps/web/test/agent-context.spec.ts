import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildThreadId, sanitizeConversationId } from '../app/lib/agent-context';

/**
 * Multi-tenancy guard for agent memory.
 *
 * Mastra scopes memory by `resourceId` + `threadId`, and `Memory.recall()`
 * rejects a thread owned by another resource. That protection is only real if
 * `resourceId` is a genuine per-user value derived on the server: Mastra's A2A
 * handler falls back to the AGENT ID when it is absent, which collapses every
 * user into one shared bucket and makes the ownership check vacuous.
 *
 * These tests pin the two halves of the fix — the namespacing function, and the
 * rule that the route handler never takes either id from the request body.
 */
describe('sanitizeConversationId', () => {
  it('keeps a well-formed id unchanged', () => {
    expect(sanitizeConversationId('abc-123_XYZ')).toBe('abc-123_XYZ');
  });

  it.each([
    // Dots and slashes are both outside the allowlist, so no path-traversal
    // fragment survives at all — not just the slashes.
    ['../../other-user', 'other-user'],
    ['a::b', 'ab'],
    ['drop table;--', 'droptable--'],
    ['sp ace', 'space'],
  ])('strips separator and path characters from %s', (raw, expected) => {
    expect(sanitizeConversationId(raw)).toBe(expected);
  });

  it('cannot produce a value containing the namespace separator', () => {
    const hostile = 'aaa::bbb::ccc';
    expect(sanitizeConversationId(hostile)).not.toContain('::');
  });

  it('caps length so a client cannot grow the key unboundedly', () => {
    expect(sanitizeConversationId('x'.repeat(500))).toHaveLength(64);
  });

  it.each([
    ['', null],
    [null, null],
    [undefined, null],
    ['!!!', null],
  ])('returns null for unusable input %s', (raw, expected) => {
    expect(sanitizeConversationId(raw as string | null | undefined)).toBe(expected);
  });
});

describe('buildThreadId', () => {
  it('always prefixes the thread with the server-owned resource id', () => {
    expect(buildThreadId('resource-a', 'conv-1')).toBe('resource-a::conv-1');
  });

  it('cannot be made to address another resource via a sanitized client id', () => {
    // The attack: supply a conversation id that tries to climb out of the
    // namespace and land in resource-b's thread. Sanitizing removes the
    // separator, so the result stays inside resource-a.
    const hostile = sanitizeConversationId('::resource-b::conv-1') ?? '';
    const threadId = buildThreadId('resource-a', hostile);
    expect(threadId.startsWith('resource-a::')).toBe(true);
    expect(threadId.split('::')).toHaveLength(2);
  });
});

describe('A2A route handler: memory scope is never client-supplied', () => {
  const routeSrc = readFileSync(
    fileURLToPath(new URL('../app/api/a2a/[agentId]/route.ts', import.meta.url)),
    'utf8',
  );

  it('derives the agent context server-side', () => {
    expect(routeSrc).toContain('resolveAgentContext(');
  });

  it.each(['resourceId', 'threadId'])('never reads %s off the request body', (field) => {
    expect(routeSrc).not.toMatch(new RegExp(`body\\.${field}`));
  });

  it('no longer accepts the legacy body.sessionId as a memory key', () => {
    expect(routeSrc).not.toMatch(/body\.sessionId/);
  });
});
