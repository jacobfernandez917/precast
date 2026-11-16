import { Pool } from 'pg';
import {
  projectSchema,
  ensureProjectSchema,
  prdRecordSchema,
  type PrdBlueprint,
  type PrdRecord,
  projectBrief,
} from '@precast/shared';
import { poolConfig } from './auth';

let pool: Pool | undefined;
let initialized: Promise<void> | undefined;
const schema = projectSchema('app');
export function prdDatabase() {
  pool ??= new Pool({ ...poolConfig(process.env.DATABASE_URL), max: 5 });
  return pool;
}
export async function readyPrdDatabase() {
  initialized ??= ensureProjectSchema(prdDatabase(), schema)
    .then(async () => {
      await prdDatabase().query(`CREATE TABLE IF NOT EXISTS "${schema}".records (
      id uuid PRIMARY KEY, owner_id text NOT NULL, collection_id text NOT NULL,
      data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
      await prdDatabase().query(
        `CREATE INDEX IF NOT EXISTS records_owner_collection ON "${schema}".records(owner_id, collection_id)`,
      );
      await prdDatabase().query(`CREATE TABLE IF NOT EXISTS "${schema}".record_links (
        source_id uuid NOT NULL REFERENCES "${schema}".records(id) ON DELETE CASCADE,
        field_id text NOT NULL, target_id uuid NOT NULL REFERENCES "${schema}".records(id) ON DELETE RESTRICT,
        PRIMARY KEY(source_id,field_id)
      )`);
    })
    .catch((error: unknown) => {
      initialized = undefined;
      throw error;
    });
  await initialized;
}

export async function listPrdRecords(owner: string, collection: string): Promise<PrdRecord[]> {
  await readyPrdDatabase();
  const result = await prdDatabase().query(
    `SELECT id, collection_id AS collection, data, created_at AS "createdAt", updated_at AS "updatedAt" FROM "${schema}".records WHERE owner_id=$1 AND collection_id=$2 ORDER BY created_at DESC LIMIT 500`,
    [owner, collection],
  );
  return result.rows;
}

export async function savePrdRecord(
  owner: string,
  collection: PrdBlueprint['collections'][number],
  data: unknown,
  id?: string,
): Promise<string | null> {
  const parsed = prdRecordSchema(collection).parse(data);
  await readyPrdDatabase();
  const db = await prdDatabase().connect();
  try {
    await db.query('BEGIN');
    // Serialize relationship changes in this workspace, including target deletes.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [owner]);
    if (
      id &&
      !(
        await db.query(
          `SELECT id FROM "${schema}".records WHERE id=$1 AND owner_id=$2 AND collection_id=$3 FOR UPDATE`,
          [id, owner, collection.id],
        )
      ).rowCount
    ) {
      await db.query('ROLLBACK');
      return null;
    }
    const references = collection.fields.filter(
      (field) => field.type === 'reference' && parsed[field.id],
    );
    for (const field of references) {
      const found = await db.query(
        `SELECT id FROM "${schema}".records WHERE id=$1 AND owner_id=$2 AND collection_id=$3 FOR KEY SHARE`,
        [parsed[field.id], owner, field.referenceCollection],
      );
      if (!found.rowCount) throw new PrdDataError('Choose a linked record from this workspace.');
    }
    let recordId = id ?? crypto.randomUUID();
    if (id) {
      const result = await db.query(
        `UPDATE "${schema}".records SET data=$1, updated_at=now() WHERE id=$2 AND owner_id=$3 AND collection_id=$4 RETURNING id`,
        [JSON.stringify(parsed), id, owner, collection.id],
      );
      if (!result.rowCount) {
        await db.query('ROLLBACK');
        return null;
      }
      recordId = result.rows[0].id;
    } else
      await db.query(
        `INSERT INTO "${schema}".records(id,owner_id,collection_id,data) VALUES($1,$2,$3,$4)`,
        [recordId, owner, collection.id, JSON.stringify(parsed)],
      );
    await db.query(`DELETE FROM "${schema}".record_links WHERE source_id=$1`, [recordId]);
    for (const field of references)
      await db.query(`INSERT INTO "${schema}".record_links VALUES($1,$2,$3)`, [
        recordId,
        field.id,
        parsed[field.id],
      ]);
    await db.query('COMMIT');
    return recordId;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

export async function deletePrdRecord(
  owner: string,
  collection: string,
  id: string,
): Promise<boolean> {
  await readyPrdDatabase();
  const db = await prdDatabase().connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [owner]);
    // Validate legacy JSON references too; new writes also have database constraints.
    for (const source of projectBrief?.collections ?? [])
      for (const field of source.fields.filter(
        (f) => f.type === 'reference' && f.referenceCollection === collection,
      )) {
        if (
          (
            await db.query(
              `SELECT id FROM "${schema}".records WHERE owner_id=$1 AND collection_id=$2 AND data->>$3=$4 LIMIT 1`,
              [owner, source.id, field.id, id],
            )
          ).rowCount
        )
          throw new PrdDataError('Remove links to this record before deleting it.');
      }
    const result = await db.query(
      `DELETE FROM "${schema}".records WHERE id=$1 AND owner_id=$2 AND collection_id=$3`,
      [id, owner, collection],
    );
    await db.query('COMMIT');
    return result.rowCount === 1;
  } catch (error) {
    await db.query('ROLLBACK');
    if ((error as { code?: string }).code === '23503')
      throw new PrdDataError('Remove links to this record before deleting it.', { cause: error });
    throw error;
  } finally {
    db.release();
  }
}

export class PrdDataError extends Error {}
