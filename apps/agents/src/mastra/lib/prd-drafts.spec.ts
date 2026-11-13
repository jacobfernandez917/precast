import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachedPrd, loadPrdDraft, prdScopeKey, savePrdDraft } from './prd-drafts';
import { runWithRequestContext } from './request-context';

const state = vi.hoisted(() => ({ rows: new Map<string, { scope: string; payload: unknown }>() }));
vi.mock('./storage', () => ({
  getMastraStore: () => ({
    pool: {
      query: async (sql: string, values: string[] = []) => {
        if (sql.startsWith('INSERT')) {
          const prior = state.rows.get(values[0]!);
          if (prior && prior.scope !== values[1]) return { rowCount: 0, rows: [] };
          state.rows.set(values[0]!, { scope: values[1]!, payload: JSON.parse(values[2]!) });
          return { rowCount: 1, rows: [{ id: values[0] }] };
        }
        const row = state.rows.get(values[0]!);
        return { rows: row && row.scope === values[1] ? [{ payload: row.payload }] : [] };
      },
    },
  }),
}));

function inRoom<T>(owner: string, room: string, fn: () => T): T {
  const token = [
    'header',
    Buffer.from(
      JSON.stringify({ sub: owner, org_id: 'org-one', scope: { kind: 'dm', id: room } }),
    ).toString('base64url'),
    'platform-verified',
  ].join('.');
  return runWithRequestContext(
    { onBehalfOf: owner, rayaUserDelegation: token, agentbaseChain: 'verified-chain' },
    fn,
  );
}
afterEach(() => vi.unstubAllEnvs());
describe('AGT-037 exact PRD source and scoped draft persistence', () => {
  it('reads the current attached PDF without taking a model paraphrase or an older history attachment', () => {
    const old = '[Attached: old.pdf, 1 page]\nOld product';
    const source = attachedPrd(
      `${old}\n[Request from User]\nBuild this PRD.\n\n[Attached: actions.pdf, 2 pages]\nAction Desk\nExact requirements`,
    );
    expect(source.sourceName).toBe('actions.pdf');
    expect(source.sourceText).toBe('Action Desk\nExact requirements');
    expect(source.sourceHash).toHaveLength(64);
    expect(attachedPrd('[Attached: actions.pdf, 1 page]\nChanged').sourceHash).not.toBe(
      source.sourceHash,
    );
  });
  it('refuses unreadable, truncated and ambiguous attachments', () => {
    for (const text of [
      '[Attached: actions.pdf — no readable text in it.]',
      '[Attached: actions.pdf, first 1 of 3 pages]\nExcerpt',
      '[Attached: a.pdf, 1 page]\nA\n\n[Attached: b.pdf, 1 page]\nB',
    ])
      expect(() => attachedPrd(text)).toThrow();
    expect(
      attachedPrd('[Attached: a.pdf, 1 page]\nA\n\n[Attached: b.pdf, 1 page]\nB', 'b.pdf')
        .sourceText,
    ).toBe('B');
  });
  it('rejects unproved identity and separates both humans and rooms', () => {
    expect(() => prdScopeKey()).toThrow(/signed-in Raya/);
    const first = inRoom('owner-one', 'room-one', prdScopeKey);
    expect(inRoom('owner-two', 'room-one', prdScopeKey)).not.toBe(first);
    expect(inRoom('owner-one', 'room-two', prdScopeKey)).not.toBe(first);
  });
  it('retains exact source across turns and refuses a draft id from another owner or conversation', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@db.invalid/test');
    vi.stubEnv('MASTRA_DB_SCHEMA', 'test_scaffold');
    const source = attachedPrd('[Attached: actions.pdf, 1 page]\nExact original PRD');
    const draft = await inRoom('owner-one', 'room-one', () =>
      savePrdDraft({
        ...source,
        answers: [],
        analysis: {
          blueprint: null,
          projectName: null,
          theme: null,
          model: 'gemini',
          database: 'managed-postgres',
          missingQuestions: ['What records should it manage?'],
          unsupportedRequirements: [],
        },
      }),
    );
    expect((await inRoom('owner-one', 'room-one', () => loadPrdDraft(draft.id))).sourceText).toBe(
      source.sourceText,
    );
    await expect(inRoom('owner-two', 'room-one', () => loadPrdDraft(draft.id))).rejects.toThrow(
      /unavailable/,
    );
    await expect(inRoom('owner-one', 'room-two', () => loadPrdDraft(draft.id))).rejects.toThrow(
      /unavailable/,
    );
  });
});
