import { describe, expect, it } from 'vitest';
import { prepareScaffold } from './prepare-scaffold';

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
