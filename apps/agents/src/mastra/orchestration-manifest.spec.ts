import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ORCHESTRATOR_ID } from './agents/orchestrator';

/**
 * Mirror of the regex the emitter (`scripts/emit-import-manifest.mjs`,
 * `readOrchestratorId`) uses to read the id in a bare Node/CI context. Kept
 * in lock-step here on purpose — like WEB-005 re-derives `requiredEnv` — so the
 * test fails if the emitter's extraction and the runtime constant ever diverge.
 */
function readOrchestratorIdFromSource(source: string): string | undefined {
  return source.match(/export const ORCHESTRATOR_ID\s*=\s*['"]([^'"]+)['"]/)?.[1];
}

/**
 * ORCH-MANIFEST — guard the crew front-door half of the import contract.
 *
 * `agentbase.import.json` `orchestration.orchestrator` is DERIVED from
 * `ORCHESTRATOR_ID` (agents/orchestrator.ts) by `pnpm emit:import-manifest`.
 * This test asserts the committed manifest matches the code, so the import
 * contract can't drift from the Mastra wiring (rename the orchestrator, forget
 * to re-emit → this fails). It also pins the two invariants AgentBase relies on:
 * `members` stays omitted (discovered, not pinned) and `defaultImport` is one of
 * the two supported modes.
 */
const manifestPath = fileURLToPath(new URL('../../../../agentbase.import.json', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  orchestration?: { orchestrator?: string; members?: unknown; defaultImport?: string };
};

describe('agentbase.import.json orchestration', () => {
  it('is present with the orchestrator id derived from ORCHESTRATOR_ID', () => {
    expect(manifest.orchestration).toBeTypeOf('object');
    expect(manifest.orchestration?.orchestrator).toBe(ORCHESTRATOR_ID);
  });

  it('omits members (AgentBase discovers them — never pinned here)', () => {
    expect(manifest.orchestration?.members).toBeUndefined();
  });

  it('declares a supported defaultImport mode', () => {
    expect(['orchestrator-only', 'full-crew']).toContain(manifest.orchestration?.defaultImport);
  });

  it('the emitter regex reads the same ORCHESTRATOR_ID the runtime imports', () => {
    // The regex reader (used by the emitter in a bare Node/CI context) and the
    // TS constant the runtime imports must agree — otherwise the manifest the
    // script writes would not match what the crew actually registers.
    const source = readFileSync(
      fileURLToPath(new URL('./agents/orchestrator.ts', import.meta.url)),
      'utf8',
    );
    expect(readOrchestratorIdFromSource(source)).toBe(ORCHESTRATOR_ID);
  });
});
