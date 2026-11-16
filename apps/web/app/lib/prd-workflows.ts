import { z } from 'zod';
import { projectSchema } from '@precast/shared';
import { prdDatabase, readyPrdDatabase } from './prd-records';
import { PrdDataError } from './prd-records';

const schema = projectSchema('app');
export const testWorkflowInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('reminder'),
      key: z.string().uuid(),
      title: z.string().trim().min(1).max(300),
      dueAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      action: z.literal('payment'),
      key: z.string().uuid(),
      amountCents: z.number().int().min(1).max(100_000_000),
      currency: z.string().regex(/^[A-Z]{3}$/),
      outcome: z.enum(['succeeded', 'failed', 'canceled']),
    })
    .strict(),
  z.object({ action: z.literal('process-due') }).strict(),
]);
async function ready() {
  await readyPrdDatabase();
  await prdDatabase().query(`CREATE TABLE IF NOT EXISTS "${schema}".test_workflows (
    id uuid PRIMARY KEY, owner_id text NOT NULL, idempotency_key uuid NOT NULL,
    kind text NOT NULL CHECK(kind IN ('reminder','payment')), payload jsonb NOT NULL,
    state text NOT NULL, due_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz, UNIQUE(owner_id,idempotency_key)
  )`);
}

export async function listTestWorkflows(owner: string) {
  await ready();
  return (
    await prdDatabase().query(
      `SELECT id,kind,payload,state,due_at AS "dueAt",completed_at AS "completedAt" FROM "${schema}".test_workflows WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [owner],
    )
  ).rows;
}

/** Local test adapters only: there is deliberately no provider client or outbound delivery. */
export async function runTestWorkflow(owner: string, input: z.infer<typeof testWorkflowInput>) {
  await ready();
  if (input.action === 'process-due') {
    const result = await prdDatabase().query(
      `UPDATE "${schema}".test_workflows SET state='recorded_test',completed_at=now() WHERE owner_id=$1 AND kind='reminder' AND state='scheduled_test' AND due_at<=now() RETURNING id`,
      [owner],
    );
    return { processed: result.rowCount, mode: 'test', delivered: false };
  }
  const { key, ...payload } = input;
  const state = input.action === 'payment' ? `${input.outcome}_test` : 'scheduled_test';
  const result = await prdDatabase().query(
    `INSERT INTO "${schema}".test_workflows(id,owner_id,idempotency_key,kind,payload,state,due_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(owner_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key WHERE "${schema}".test_workflows.payload=EXCLUDED.payload RETURNING id,state`,
    [
      crypto.randomUUID(),
      owner,
      key,
      input.action,
      JSON.stringify(payload),
      state,
      input.action === 'reminder' ? input.dueAt : null,
      input.action === 'payment' ? new Date().toISOString() : null,
    ],
  );
  if (!result.rowCount)
    throw new PrdDataError('That test request key was already used with different details.');
  return { ...result.rows[0], mode: 'test', delivered: false, charged: false };
}
