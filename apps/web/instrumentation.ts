/**
 * Runs once when the Next.js server starts. Prepares the sign-in tables in the
 * project's Postgres (app/lib/auth.ts); never blocks the app from serving.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { migrateAuthSchema } = await import('./app/lib/auth');
  await migrateAuthSchema();
}
