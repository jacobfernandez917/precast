import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { scaffoldProjectInput } from './scaffold-project';
import { loadPrdDraft } from '../lib/prd-drafts';

export const scaffoldPreferences = z.object({
  projectName: z.string().optional(),
  model: z.enum(['gemini', 'later']).optional(),
  theme: scaffoldProjectInput.shape.theme.removeDefault().optional(),
  database: z.enum(['managed-postgres', 'later']).optional(),
  useDefaults: z.boolean().default(false),
  prdId: z.string().uuid().optional(),
});

const preparationResult = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('question'),
    field: z.enum(['projectName', 'model', 'theme', 'database', 'product']),
    question: z.string(),
  }),
  z.object({
    state: z.literal('ready'),
    execution: scaffoldProjectInput,
    note: z.string(),
  }),
]);

/** Mirror bootstrap's question order without touching a Computer or requesting secrets. */
export function prepareScaffold(
  input: z.input<typeof scaffoldPreferences>,
): z.infer<typeof preparationResult> {
  const preferences = scaffoldPreferences.parse(input);
  const projectName = scaffoldProjectInput.shape.projectName.safeParse(preferences.projectName);
  if (!projectName.success)
    return {
      state: 'question',
      field: 'projectName',
      question:
        'What would you like to call the project? Use 2–63 lowercase letters, digits and hyphens, starting with a letter, such as budget-tracker.',
    };

  const model = preferences.model ?? (preferences.useDefaults ? 'gemini' : undefined);
  if (!model)
    return {
      state: 'question',
      field: 'model',
      question:
        'Would you like to use the approved Gemini model connection, or connect a model later?',
    };

  const theme = preferences.theme ?? (preferences.useDefaults ? 'stockholm' : undefined);
  if (!theme)
    return {
      state: 'question',
      field: 'theme',
      question:
        'Which visual theme would you like: Stockholm (the default), Prague, Arctic, Nova, Melbourne, Lapland or Cappadocia?',
    };

  const database =
    preferences.database ?? (preferences.useDefaults ? 'managed-postgres' : undefined);
  if (!database)
    return {
      state: 'question',
      field: 'database',
      question:
        'Would you like a managed Postgres database now, or leave database setup for later?',
    };

  const connected = model === 'gemini' && database === 'managed-postgres';
  return {
    state: 'ready',
    execution: {
      projectName: projectName.data,
      theme,
      services: connected ? 'hannibal-gemini' : 'deferred',
      preview: connected ? 'srv.us' : 'off',
      ...(preferences.prdId ? { prdId: preferences.prdId } : {}),
    },
    note: connected
      ? 'Use the saved approved connections, then start the app and return its verified public link automatically.'
      : 'This builder connects Gemini and managed Postgres together. Because a connection was deferred, both connections and the public preview remain deferred; the project will be scaffolded and built only.',
  };
}

export async function prepareScaffoldWithPrd(
  input: z.input<typeof scaffoldPreferences>,
): Promise<z.infer<typeof preparationResult>> {
  if (!input.prdId) return prepareScaffold(input);
  const { analysis } = await loadPrdDraft(input.prdId);
  if (analysis.unsupportedRequirements.length)
    return {
      state: 'question',
      field: 'product',
      question: `The PRD requires ${analysis.unsupportedRequirements.join('; ')}. Those capabilities are not available in this builder. Would you like to revise the initial scope to its supported record-management and assistant features?`,
    };
  if (analysis.missingQuestions.length || !analysis.blueprint)
    return {
      state: 'question',
      field: 'product',
      question: analysis.missingQuestions[0] ?? 'What records and fields should the app manage?',
    };
  const inferred = Object.fromEntries(
    ['projectName', 'model', 'theme', 'database'].flatMap((key) => {
      const value = analysis[key as keyof typeof analysis];
      return value == null ? [] : [[key, value]];
    }),
  );
  const supplied = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  const result = prepareScaffold({ ...inferred, ...supplied });
  if (result.state === 'ready' && result.execution.services !== 'hannibal-gemini')
    return {
      state: 'question',
      field: 'product',
      question:
        'Building this app needs the approved Gemini and managed Postgres connections. Would you like to connect both now, or pause the app build?',
    };
  return result;
}

export const prepareScaffoldTool = createTool({
  id: 'prepare-precast-project',
  description:
    'Before scaffolding, supply only the preferences the user has given for this project. Returns one next question in bootstrap order, or the ready execution request. No side effects. Set useDefaults only if the user explicitly asks to use defaults.',
  inputSchema: scaffoldPreferences,
  outputSchema: preparationResult,
  execute: async (input) => prepareScaffoldWithPrd(input),
});
