import { PostgresStore } from '@mastra/pg';
import { parseApiEnv, resolveMastraDbUrl } from '@precast/shared';

/**
 * The single Postgres store backing everything Mastra persists — threads,
 * messages, working memory, workflow state.
 *
 * Shared deliberately. The Mastra instance (`mastra/index.ts`) and every
 * `Memory` instance are handed this *same object* rather than each constructing
 * their own from the same URL, so the process keeps ONE connection pool. Two
 * `PostgresStore`s pointed at one database would work, but would silently
 * double the connection count — which matters on managed Postgres, where the
 * connection cap is usually the first limit a project hits.
 *
 * Postgres-only by construction: `resolveMastraDbUrl()` returns `MASTRA_DB_URL`
 * when set and `DATABASE_URL` otherwise, and the env schema validates both as
 * Postgres URLs (ADR-002). There is no local-file fallback to degrade to.
 */
let store: PostgresStore | undefined;

export function getPrecastStore(): PostgresStore {
  if (!store) {
    const env = parseApiEnv();
    store = new PostgresStore({
      id: 'precast-store',
      connectionString: resolveMastraDbUrl(env),
      // Namespaces Mastra's own tables so they can't collide with the
      // project's application tables when MASTRA_DB_URL is unset and both
      // share one database (the default, single-instance setup).
      schemaName: env.MASTRA_DB_SCHEMA,
    });
  }
  return store;
}
