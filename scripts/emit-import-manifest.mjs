#!/usr/bin/env node
/**
 * emit-import-manifest.mjs — derive `requiredEnv` for AgentBase's import gate
 * from the single source of truth: the shared zod env schema.
 *
 * AgentBase blocks a repo import until every variable in `agentbase.import.json`
 * `requiredEnv` has a value in the selected namespace/environment ("settle first").
 * Rather than hand-maintain that list (drift-prone), we derive it: a var is
 * REQUIRED iff the schema rejects `undefined` for it (no `.default()`, not
 * `.optional()`). Names only — never values. AgentBase-managed/reserved names
 * are excluded (AgentBase injects them; user vars can't shadow them).
 *
 * Run after changing `packages/shared/src/env.ts`:  pnpm emit:import-manifest
 * The WEB-005 test guards that the committed manifest matches the schema.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = join(root, 'packages', 'shared', 'dist', 'index.js');
const manifestPath = join(root, 'agentbase.import.json');

// Kept in sync with AgentBase's RESERVED_ENV_NAMES (env-groups.dto.ts): these are
// injected/controlled by AgentBase, so they must never appear in requiredEnv.
const RESERVED = new Set([
  'AGENT_API_TOKEN',
  'AGENT_INBOUND_TOKEN',
  'PORT',
  'MASTRA_PORT',
  'MASTRA_HOST',
]);

export function requiredEnvNames(envSchema) {
  return Object.entries(envSchema.shape)
    .filter(([, field]) => !field.isOptional()) // rejects undefined ⇒ required
    .map(([name]) => name)
    .filter((name) => !RESERVED.has(name))
    .sort();
}

// Only run the file-writing side when invoked directly (the test imports the fn).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!existsSync(distIndex)) {
    execFileSync('pnpm', ['--filter', '@precast/shared', 'build'], { cwd: root, stdio: 'inherit' });
  }
  const { EnvSchema } = await import(pathToFileURL(distIndex).href);
  const required = requiredEnvNames(EnvSchema);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.requiredEnv = required;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('agentbase.import.json requiredEnv =', JSON.stringify(required));
}
