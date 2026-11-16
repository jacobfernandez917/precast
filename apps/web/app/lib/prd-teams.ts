import { projectSchema, prdCapabilities, type PrdBlueprint } from '@precast/shared';
import { prdDatabase, readyPrdDatabase } from './prd-records';

const schema = projectSchema('app');
export class PrdAccessError extends Error {}
async function ready() {
  await readyPrdDatabase();
  await prdDatabase().query(
    `CREATE TABLE IF NOT EXISTS "${schema}".workspaces (id uuid PRIMARY KEY, name text NOT NULL, owner_id text NOT NULL)`,
  );
  await prdDatabase().query(`CREATE TABLE IF NOT EXISTS "${schema}".workspace_members (
    workspace_id uuid NOT NULL REFERENCES "${schema}".workspaces(id) ON DELETE CASCADE,
    user_id text NOT NULL, role text NOT NULL CHECK(role IN ('owner','editor','viewer')), PRIMARY KEY(workspace_id,user_id)
  )`);
}

export async function resolvePrdOwner(
  user: string,
  brief: PrdBlueprint,
  workspace?: string,
  write = false,
): Promise<string> {
  if (!workspace) return user;
  if (prdCapabilities(brief).collaboration !== 'team')
    throw new PrdAccessError('Team workspaces are not enabled for this product.');
  await ready();
  const result = await prdDatabase().query(
    `SELECT role FROM "${schema}".workspace_members WHERE workspace_id=$1 AND user_id=$2`,
    [workspace, user],
  );
  const role = result.rows[0]?.role;
  if (!role || (write && role === 'viewer'))
    throw new PrdAccessError('Your account does not have permission for this workspace action.');
  return `workspace:${workspace}`;
}

export async function listPrdWorkspaces(user: string) {
  await ready();
  return (
    await prdDatabase().query(
      `SELECT w.id,w.name,m.role FROM "${schema}".workspaces w JOIN "${schema}".workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.name LIMIT 100`,
      [user],
    )
  ).rows;
}

export async function createPrdWorkspace(user: string, name: string) {
  await ready();
  const db = await prdDatabase().connect();
  try {
    await db.query('BEGIN');
    const id = crypto.randomUUID();
    await db.query(`INSERT INTO "${schema}".workspaces VALUES($1,$2,$3)`, [id, name, user]);
    await db.query(`INSERT INTO "${schema}".workspace_members VALUES($1,$2,'owner')`, [id, user]);
    await db.query('COMMIT');
    return id;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

/** The owner adds an existing account id; no invitation email or inferred email identity. */
export async function setPrdWorkspaceMember(
  owner: string,
  workspace: string,
  member: string,
  role: 'editor' | 'viewer' | null,
) {
  await ready();
  const db = await prdDatabase().connect();
  try {
    await db.query('BEGIN');
    const found = await db.query(
      `SELECT owner_id FROM "${schema}".workspaces WHERE id=$1 FOR UPDATE`,
      [workspace],
    );
    if (found.rows[0]?.owner_id !== owner || member === owner)
      throw new PrdAccessError('Only the workspace owner can manage other members.');
    if (role) {
      const authSchema = projectSchema('auth');
      if (!(await db.query(`SELECT id FROM "${authSchema}"."user" WHERE id=$1`, [member])).rowCount)
        throw new PrdAccessError('Choose an existing account ID.');
      await db.query(
        `INSERT INTO "${schema}".workspace_members VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=$3`,
        [workspace, member, role],
      );
    } else
      await db.query(
        `DELETE FROM "${schema}".workspace_members WHERE workspace_id=$1 AND user_id=$2`,
        [workspace, member],
      );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
