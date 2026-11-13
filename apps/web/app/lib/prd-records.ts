import { Pool } from 'pg';
import { projectSchema, prdRecordSchema, type PrdBlueprint, type PrdRecord } from '@precast/shared';
import { poolConfig } from './auth';

let pool: Pool | undefined;
let initialized: Promise<void> | undefined;
const schema = projectSchema('app');
function database() {
  pool ??= new Pool({ ...poolConfig(process.env.DATABASE_URL), max: 5 });
  return pool;
}
async function ready() {
  initialized ??= database()
    .query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
    .then(async () => {
      await database().query(`CREATE TABLE IF NOT EXISTS "${schema}".records (
      id uuid PRIMARY KEY, owner_id text NOT NULL, collection_id text NOT NULL,
      data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
      await database().query(
        `CREATE INDEX IF NOT EXISTS records_owner_collection ON "${schema}".records(owner_id, collection_id)`,
      );
    })
    .catch((error: unknown) => {
      initialized = undefined;
      throw error;
    });
  await initialized;
}

export async function listPrdRecords(owner: string, collection: string): Promise<PrdRecord[]> {
  await ready();
  const result = await database().query(
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
  await ready();
  if (id) {
    const result = await database().query(
      `UPDATE "${schema}".records SET data=$1, updated_at=now() WHERE id=$2 AND owner_id=$3 AND collection_id=$4 RETURNING id`,
      [JSON.stringify(parsed), id, owner, collection.id],
    );
    return result.rows[0]?.id ?? null;
  }
  const recordId = crypto.randomUUID();
  await database().query(
    `INSERT INTO "${schema}".records(id,owner_id,collection_id,data) VALUES($1,$2,$3,$4)`,
    [recordId, owner, collection.id, JSON.stringify(parsed)],
  );
  return recordId;
}

export async function deletePrdRecord(
  owner: string,
  collection: string,
  id: string,
): Promise<boolean> {
  await ready();
  const result = await database().query(
    `DELETE FROM "${schema}".records WHERE id=$1 AND owner_id=$2 AND collection_id=$3`,
    [id, owner, collection],
  );
  return result.rowCount === 1;
}
