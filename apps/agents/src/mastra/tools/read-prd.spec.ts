import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({
  generate: vi.fn(),
  save: vi.fn(),
  pending: vi.fn(),
  settle: vi.fn(),
}));
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    generate = calls.generate;
  },
}));
vi.mock('../lib/agentbase-model', () => ({ resolveAgentModel: () => 'test-model' }));
vi.mock('../lib/prd-drafts', async (original) => ({
  ...(await original<typeof import('../lib/prd-drafts')>()),
  capturePrdAttachment: async () => undefined,
  pendingPrdDraft: calls.pending,
  settlePrdDraft: calls.settle,
  readCurrentPrd: () => ({
    sourceName: 'actions.pdf',
    sourceText: 'Exact attached source',
    sourceHash: 'a'.repeat(64),
  }),
  savePrdDraft: calls.save,
}));
import { readPrdTool, preserveExplicitPrdLabels } from './read-prd';
const id = '00000000-0000-4000-8000-000000000001';
describe('explicit PRD label preservation', () => {
  const blueprint = {
    title: 'Notes',
    mission: 'Private notes',
    audience: 'The owner',
    agentJob: 'Help read notes',
    collections: [
      {
        id: 'notes',
        label: 'Manual Notes',
        singular: 'Note',
        fields: [
          { id: 'title', label: 'Note Title', type: 'text' as const, required: true, choices: [] },
        ],
      },
    ],
    acceptanceCriteria: ['Save a note'],
  };
  const document =
    '### Manual notes\nCollection identifier: notes. Singular label: Note.\n- Note title (identifier title): required text.\n\n## Acceptance\nSave a note.\n';
  it('retains the explicitly identified collection and field label casing without changing identifiers', () => {
    const result = preserveExplicitPrdLabels(blueprint, document, ['Use project folder my-notes']);
    expect(result.collections[0]).toMatchObject({
      id: 'notes',
      label: 'Manual notes',
      fields: [{ id: 'title', label: 'Note title' }],
    });
    expect(blueprint.collections[0]!.label).toBe('Manual Notes');
  });
  it('honors later explicit human labels and leaves ambiguous or semantically different labels alone', () => {
    expect(
      preserveExplicitPrdLabels(blueprint, document, ['Use the label Manual Notes']).collections[0]!
        .label,
    ).toBe('Manual Notes');
    expect(
      preserveExplicitPrdLabels(blueprint, document + document, []).collections[0]!.label,
    ).toBe('Manual Notes');
    expect(
      preserveExplicitPrdLabels(blueprint, document.replace('Manual notes', 'Inbox'), [])
        .collections[0]!.label,
    ).toBe('Manual Notes');
  });
});
const analysis = {
  blueprint: null,
  projectName: null,
  model: 'gemini',
  theme: null,
  database: 'managed-postgres',
  missingQuestions: ['What fields should an action contain?'],
  unsupportedRequirements: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
  vi.stubEnv('PRECAST_PRD_BUILD_ENABLED', '1');
  calls.save.mockImplementation(async (value) => ({ ...value, id }));
  calls.generate.mockResolvedValue({ object: analysis });
  calls.pending.mockResolvedValue(undefined);
});
describe('AGT-046 unreadable PRD cancellation', () => {
  it('settles a blocked draft without requiring a successful read or another model call', async () => {
    calls.pending.mockResolvedValue({
      id,
      sourceName: 'scanned.pdf',
      sourceText: '',
      sourceHash: '',
      analysed: false,
      sourceComplete: false,
      analysis,
    });
    const result = await readPrdTool.execute!({ discard: true }, {} as never);
    expect(result).toMatchObject({ draftId: id, sourceName: 'scanned.pdf', discarded: true });
    expect(calls.settle).toHaveBeenCalledWith(id, 'discarded');
    expect(calls.generate).not.toHaveBeenCalled();
  });
  it('does not confirm cancellation when saving the discarded state fails', async () => {
    calls.pending.mockResolvedValue({ id });
    calls.settle.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(readPrdTool.execute!({ discard: true }, {} as never)).rejects.toThrow(
      'storage unavailable',
    );
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('AGT-041 model schema guidance and failed-read retention', () => {
  it('gives the real reader its JSON schema in the prompt and validates the resulting contract', async () => {
    const result = await readPrdTool.execute!({}, {} as never);
    expect(calls.generate.mock.calls[0]![1]).toMatchObject({
      structuredOutput: { jsonPromptInjection: true },
    });
    expect(result).toMatchObject({ draftId: id, analysis });
    expect(calls.save.mock.calls[0]![0]).toMatchObject({
      sourceText: 'Exact attached source',
      analysis: { blueprint: null },
    });
    expect(calls.save.mock.invocationCallOrder[0]).toBeLessThan(
      calls.generate.mock.invocationCallOrder[0]!,
    );
  });
  it('retains the unready source and refuses to return a usable draft after a model or schema failure', async () => {
    calls.generate.mockRejectedValueOnce(new Error('schema validation failed'));
    await expect(readPrdTool.execute!({}, {} as never)).rejects.toThrow(/schema validation failed/);
    expect(calls.save).toHaveBeenCalledTimes(1);
    expect(calls.save.mock.calls[0]![0]).toMatchObject({
      sourceText: 'Exact attached source',
      analysis: { blueprint: null },
    });
    calls.generate.mockResolvedValueOnce({ object: { blueprint: { appName: 'wrong shape' } } });
    await expect(readPrdTool.execute!({}, {} as never)).rejects.toThrow();
  });
  it('preserves an explicit setup override supplied in the human clarification', async () => {
    calls.generate.mockResolvedValue({
      object: { ...analysis, theme: 'lapland', projectName: 'my-followups' },
    });
    const result = await readPrdTool.execute!(
      { clarification: 'Use project folder my-followups and theme lapland.' },
      {} as never,
    );
    expect(result).toMatchObject({
      analysis: { theme: 'lapland', projectName: 'my-followups' },
    });
  });
});
