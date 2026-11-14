import { describe, expect, it, vi } from 'vitest';
import { prepareScaffold, prepareScaffoldWithPrd } from './prepare-scaffold';
vi.mock('./read-prd', () => ({ readPrd: vi.fn() }));
import { readPrd } from './read-prd';
vi.mock('../lib/prd-drafts', () => ({ loadPrdDraft: vi.fn(), pendingPrdDraft: vi.fn() }));
import { loadPrdDraft, pendingPrdDraft } from '../lib/prd-drafts';

describe('AGT-036 conversational scaffold preparation', () => {
  it('asks only the first missing preference, in bootstrap order, without requesting a tunnel', () => {
    const answers = {
      projectName: 'conversation-project',
      model: 'gemini' as const,
      theme: 'arctic' as const,
    };
    const steps = [
      prepareScaffold({}),
      prepareScaffold({ projectName: answers.projectName }),
      prepareScaffold({ projectName: answers.projectName, model: answers.model }),
      prepareScaffold(answers),
    ];
    expect(steps.map((step) => step.state === 'question' && step.field)).toEqual([
      'projectName',
      'model',
      'theme',
      'database',
    ]);
    for (const step of steps) {
      if (step.state !== 'question') throw new Error('Expected a setup question');
      expect(step.question.match(/\?/g)).toHaveLength(1);
      expect(step.question).not.toMatch(/srv\.us|public|tunnel|secret|Hannibal/i);
    }
  });

  it('skips supplied preferences and returns a connected execution with automatic preview', () => {
    expect(prepareScaffold({ theme: 'nova', database: 'managed-postgres' })).toMatchObject({
      state: 'question',
      field: 'projectName',
    });
    expect(
      prepareScaffold({
        projectName: 'conversation-project',
        model: 'gemini',
        theme: 'nova',
        database: 'managed-postgres',
      }),
    ).toMatchObject({
      state: 'ready',
      execution: {
        projectName: 'conversation-project',
        theme: 'nova',
        services: 'hannibal-gemini',
        preview: 'srv.us',
      },
    });
  });

  it('uses defaults only on explicit opt-in and preserves explicit choices', () => {
    expect(prepareScaffold({ projectName: 'conversation-project' })).toMatchObject({
      state: 'question',
      field: 'model',
    });
    expect(prepareScaffold({ useDefaults: true })).toMatchObject({
      state: 'question',
      field: 'projectName',
    });
    expect(
      prepareScaffold({ projectName: 'conversation-project', useDefaults: true }),
    ).toMatchObject({
      state: 'ready',
      execution: { theme: 'stockholm', services: 'hannibal-gemini', preview: 'srv.us' },
    });
    expect(
      prepareScaffold({
        projectName: 'conversation-project',
        theme: 'prague',
        database: 'later',
        useDefaults: true,
      }),
    ).toMatchObject({
      state: 'ready',
      execution: { theme: 'prague', services: 'deferred', preview: 'off' },
      note: expect.stringContaining('both connections and the public preview remain deferred'),
    });
  });

  it.each(['../outside', 'Not Lowercase', 'x', 'a'.repeat(64)])(
    'asks for a valid project name instead of allowing %s into execution',
    (projectName) => {
      expect(prepareScaffold({ projectName, useDefaults: true })).toMatchObject({
        state: 'question',
        field: 'projectName',
      });
    },
  );

  it.each([
    { model: 'later' as const, database: 'managed-postgres' as const },
    { model: 'gemini' as const, database: 'later' as const },
  ])('keeps deferred connections honest for %o', (connections) => {
    expect(
      prepareScaffold({ projectName: 'conversation-project', theme: 'stockholm', ...connections }),
    ).toMatchObject({
      state: 'ready',
      execution: { services: 'deferred', preview: 'off' },
      note: expect.stringContaining('scaffolded and built only'),
    });
  });
});

describe('AGT-038 missing PRD questions only', () => {
  const prdId = '00000000-0000-4000-8000-000000000001';
  const analysis = {
    blueprint: { title: 'Action Desk' },
    projectName: null,
    model: 'gemini',
    database: 'managed-postgres',
    theme: null,
    missingQuestions: [],
    unsupportedRequirements: [],
  };
  const draft = (overrides: Record<string, unknown> = {}) =>
    vi.mocked(loadPrdDraft).mockResolvedValue({ analysis: { ...analysis, ...overrides } } as never);
  it('analyses an automatically captured source before asking setup questions', async () => {
    vi.mocked(loadPrdDraft).mockResolvedValue({
      id: prdId,
      analysed: false,
      analysis: { blueprint: null },
    } as never);
    vi.mocked(readPrd).mockResolvedValue({ draftId: prdId, analysis } as never);
    expect(await prepareScaffoldWithPrd({ prdId, projectName: 'action-desk' })).toMatchObject({
      state: 'question',
      field: 'theme',
    });
    expect(readPrd).toHaveBeenCalledWith({ draftId: prdId });
  });
  it('recovers a pending PRD across replies instead of guessing a plain scaffold', async () => {
    vi.stubEnv('PRECAST_PRD_BUILD_ENABLED', '1');
    vi.mocked(pendingPrdDraft).mockResolvedValue({ id: prdId } as never);
    draft();
    try {
      expect(await prepareScaffoldWithPrd({ projectName: 'action-desk' })).toMatchObject({
        state: 'question',
        field: 'theme',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('skips setup choices explicitly supplied by the PRD and retains its reference through execution', async () => {
    draft();
    expect(await prepareScaffoldWithPrd({ prdId })).toMatchObject({
      state: 'question',
      field: 'projectName',
    });
    expect(await prepareScaffoldWithPrd({ prdId, projectName: 'action-desk' })).toMatchObject({
      state: 'question',
      field: 'theme',
    });
    expect(
      await prepareScaffoldWithPrd({ prdId, projectName: 'action-desk', theme: 'stockholm' }),
    ).toMatchObject({
      state: 'ready',
      execution: {
        prdId,
        projectName: 'action-desk',
        services: 'hannibal-gemini',
        preview: 'srv.us',
      },
    });
  });
  it('honors human overrides and never treats missing or unsupported behavior as implemented', async () => {
    draft({ projectName: 'from-prd', theme: 'arctic' });
    expect(
      await prepareScaffoldWithPrd({ prdId, projectName: 'human-choice', theme: 'nova' }),
    ).toMatchObject({ state: 'ready', execution: { projectName: 'human-choice', theme: 'nova' } });
    draft({ blueprint: null, missingQuestions: ['What fields does an action need?'] });
    expect(await prepareScaffoldWithPrd({ prdId })).toMatchObject({
      state: 'question',
      field: 'product',
      question: 'What fields does an action need?',
    });
    draft({ unsupportedRequirements: ['shared team permissions'] });
    expect(await prepareScaffoldWithPrd({ prdId })).toMatchObject({
      state: 'question',
      field: 'product',
      question: expect.stringContaining('shared team permissions'),
    });
  });
});

describe('AGT-043 existing-only database planning', () => {
  it('reuses the operator-approved database even when the PRD requests managed Postgres', () => {
    vi.stubEnv('PRECAST_DATABASE_SETUP_MODE', 'existing');
    try {
      for (const database of ['managed-postgres', 'existing-postgres'] as const)
        expect(
          prepareScaffold({
            projectName: 'reuse-project',
            model: 'gemini',
            theme: 'nova',
            database,
          }),
        ).toMatchObject({
          state: 'ready',
          execution: { services: 'existing-postgres-gemini', preview: 'srv.us' },
          note: expect.stringContaining('No database will be provisioned'),
        });
      expect(prepareScaffold({ projectName: 'reuse-project', useDefaults: true })).toMatchObject({
        state: 'ready',
        execution: { services: 'existing-postgres-gemini' },
      });
      expect(
        prepareScaffold({
          projectName: 'reuse-project',
          model: 'gemini',
          theme: 'nova',
          database: 'later',
        }),
      ).toMatchObject({ state: 'ready', execution: { services: 'deferred', preview: 'off' } });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
