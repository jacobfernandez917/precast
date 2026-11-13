import { NextResponse } from 'next/server';
import { z } from 'zod';
import { projectBrief, prdRecordSchema } from '@precast/shared';
import { getSignedInUser } from '../../lib/auth';
import { deletePrdRecord, listPrdRecords, savePrdRecord } from '../../lib/prd-records';
import { log } from '../../lib/logger';

const mutation = z
  .object({
    collection: z.string(),
    id: z.string().uuid().optional(),
    data: z.unknown().optional(),
  })
  .strict();

async function handle(request: Request) {
  const user = await getSignedInUser(request.headers);
  if (!user) return NextResponse.json({ error: 'Sign in to use this app.' }, { status: 401 });
  if (!projectBrief)
    return NextResponse.json({ error: 'No product has been configured.' }, { status: 404 });
  const trustedOrigin =
    process.env.BETTER_AUTH_URL?.replace(/\/$/, '') || new URL(request.url).origin;
  if (request.method !== 'GET' && request.headers.get('origin') !== trustedOrigin)
    return NextResponse.json({ error: 'Use this app to make changes.' }, { status: 403 });
  const parsed =
    request.method === 'GET'
      ? mutation.safeParse({ collection: new URL(request.url).searchParams.get('collection') })
      : mutation.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'Check the record details.' }, { status: 400 });
  const collection = projectBrief.collections.find((item) => item.id === parsed.data.collection);
  if (!collection)
    return NextResponse.json({ error: 'That collection does not exist.' }, { status: 404 });
  try {
    if (request.method === 'GET')
      return NextResponse.json({ records: await listPrdRecords(user.id, collection.id) });
    if (request.method === 'DELETE') {
      if (!parsed.data.id) return NextResponse.json({ error: 'Choose a record.' }, { status: 400 });
      return (await deletePrdRecord(user.id, collection.id, parsed.data.id))
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: 'That record does not exist.' }, { status: 404 });
    }
    const data = prdRecordSchema(collection).safeParse(parsed.data.data);
    if (!data.success)
      return NextResponse.json(
        { error: 'Check the required fields and allowed values.' },
        { status: 400 },
      );
    if (request.method === 'PATCH' && !parsed.data.id)
      return NextResponse.json({ error: 'Choose a record.' }, { status: 400 });
    if (request.method === 'POST' && parsed.data.id)
      return NextResponse.json(
        { error: 'New records cannot supply an identifier.' },
        { status: 400 },
      );
    const id = await savePrdRecord(user.id, collection, data.data, parsed.data.id);
    return id
      ? NextResponse.json({ id }, { status: request.method === 'POST' ? 201 : 200 })
      : NextResponse.json({ error: 'That record does not exist.' }, { status: 404 });
  } catch (error) {
    log.error({ err: (error as Error).message }, 'Product record operation failed');
    return NextResponse.json(
      { error: 'Could not save your changes. Please try again.' },
      { status: 503 },
    );
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
