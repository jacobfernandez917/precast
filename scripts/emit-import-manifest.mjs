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
 * It also emits the optional `orchestration` block (the crew front-door
 * contract) from the SAME single source as the Mastra wiring: the orchestrator
 * id is read straight from `ORCHESTRATOR_ID` in `agents/orchestrator.ts`, so the
 * import contract can't drift from `crew.ts`. `members` is deliberately OMITTED
 * — AgentBase discovers the hosted agents post-boot (`GET /api/agents`) and
 * treats every non-orchestrator agent as a member, exactly as it already does
 * for the omitted `agents` list. The block is advisory: AgentBase reconciles it
 * against live discovery, so a single-agent project (whose orchestrator stays
 * dormant, never appearing in discovery) is imported flat.
 *
 * Run after changing `packages/shared/src/env.ts` or the crew:  pnpm emit:import-manifest
 * The WEB-005 test guards `requiredEnv`; the ORCH-MANIFEST test guards `orchestration`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = join(root, 'packages', 'shared', 'dist', 'index.js');
const manifestPath = join(root, 'agentbase.import.json');
const orchestratorPath = join(root, 'apps', 'agents', 'src', 'mastra', 'agents', 'orchestrator.ts');

/**
 * The Studio import default: "orchestrator-only" registers just the front door
 * (members stay internal — "managed crew", sell the outcome); "full-crew"
 * registers every agent as its own listing ("composable agents"). Kept here as
 * the provider's suggested default; the operator can flip it at import time.
 */
const DEFAULT_IMPORT = 'orchestrator-only';

/**
 * Read `ORCHESTRATOR_ID` from the orchestrator agent module — the single source
 * of truth — without importing it (the module pulls in the whole Mastra agent
 * runtime and this script must run in a bare Node/CI context with no DB/LLM env).
 */
export function readOrchestratorId(source) {
  const match = source.match(/export const ORCHESTRATOR_ID\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    throw new Error(
      'emit-import-manifest: could not find `export const ORCHESTRATOR_ID = "..."` in ' +
        'apps/agents/src/mastra/agents/orchestrator.ts',
    );
  }
  return match[1];
}

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

  const orchestratorId = readOrchestratorId(readFileSync(orchestratorPath, 'utf8'));

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.requiredEnv = required;
  manifest.orchestration = {
    orchestrator: orchestratorId,
    defaultImport: DEFAULT_IMPORT,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('agentbase.import.json requiredEnv =', JSON.stringify(required));
  console.log('agentbase.import.json orchestration =', JSON.stringify(manifest.orchestration));
}
