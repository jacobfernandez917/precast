import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prdBlueprintSchema, parseApiEnv } from '@precast/shared';
import { currentInboundText, currentRayaScopeKey } from './request-context';
import { getMastraStore } from './storage';

export const prdAnalysisSchema = z
  .object({
    blueprint: prdBlueprintSchema.nullable(),
    projectName: z.string().nullable(),
    model: z.enum(['gemini', 'later']).nullable(),
    theme: z
      .enum(['stockholm', 'prague', 'arctic', 'nova', 'melbourne', 'lapland', 'cappadocia'])
      .nullable(),
    database: z.enum(['managed-postgres', 'later']).nullable(),
    missingQuestions: z.array(z.string().min(1).max(500)).max(8),
    unsupportedRequirements: z.array(z.string().min(1).max(1000)).max(20),
  })
  .strict();
export type PrdAnalysis = z.infer<typeof prdAnalysisSchema>;
export interface PrdDraft {
  id: string;
  sourceName: string;
  sourceText: string;
  sourceHash: string;
  answers: string[];
  analysis: PrdAnalysis;
}

export function attachedPrd(
  text: string,
  name?: string,
): { sourceName: string; sourceText: string; sourceHash: string } {
  // Raya puts the current request last, after its conversation history.
  const current = text.slice(Math.max(0, text.lastIndexOf('\n[Request from ')));
  const matches = [...current.matchAll(/^\[Attached: ([^\n\]]+)\]\n/gm)];
  const selected = name
    ? matches.filter((m) => m[1]!.startsWith(name + ',') || m[1] === name)
    : matches;
  if (selected.length !== 1)
    throw new Error('Attach one readable PDF PRD, or specify which attached PDF to use.');
  const match = selected[0]!;
  if (/first \d+ of \d+ pages|no readable text/.test(match[1]!))
    throw new Error(
      'The PRD was not read in full. Attach a complete readable PDF before building.',
    );
  const sourceName = match[1]!.replace(/, \d+ pages?$/, '');
  if (!/\.pdf$/i.test(sourceName)) throw new Error('Use a readable PDF PRD.');
  const start = match.index! + match[0].length;
  const next = matches.find((m) => m.index! > match.index!);
  const sourceText = current.slice(start, next?.index).trim();
  if (!sourceText || sourceText.length > 40_000)
    throw new Error('The complete PRD must contain 1–40,000 characters of readable text.');
  return {
    sourceName,
    sourceText,
    sourceHash: createHash('sha256').update(sourceText).digest('hex'),
  };
}

export const prdScopeKey = currentRayaScopeKey;

async function table() {
  const schema = parseApiEnv().MASTRA_DB_SCHEMA;
  const pool = getMastraStore().pool;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "${schema}".scaffold_prd_drafts (id uuid PRIMARY KEY, scope_key text NOT NULL, payload jsonb NOT NULL, expires_at timestamptz NOT NULL)`,
  );
  return { pool, table: `"${schema}".scaffold_prd_drafts` };
}

export async function savePrdDraft(
  draft: Omit<PrdDraft, 'id'> & { id?: string },
): Promise<PrdDraft> {
  const scope = prdScopeKey();
  const saved = { ...draft, id: draft.id ?? randomUUID() };
  const db = await table();
  const result = await db.pool.query(
    `INSERT INTO ${db.table}(id,scope_key,payload,expires_at) VALUES($1,$2,$3,now()+interval '24 hours') ON CONFLICT(id) DO UPDATE SET payload=$3 WHERE ${db.table}.scope_key=$2 RETURNING id`,
    [saved.id, scope, JSON.stringify(saved)],
  );
  if (!result.rowCount) throw new Error('This PRD belongs to another conversation.');
  return saved;
}

export async function loadPrdDraft(id: string): Promise<PrdDraft> {
  z.string().uuid().parse(id);
  const scope = prdScopeKey();
  const db = await table();
  const result = await db.pool.query(
    `SELECT payload FROM ${db.table} WHERE id=$1 AND scope_key=$2 AND expires_at>now()`,
    [id, scope],
  );
  if (!result.rows[0])
    throw new Error('That PRD is unavailable in this conversation. Attach it again.');
  return result.rows[0].payload as PrdDraft;
}

export function readCurrentPrd(name?: string) {
  return attachedPrd(currentInboundText(), name);
}
