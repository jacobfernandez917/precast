import { defineCrew } from './lib/crew';
import { resolveAgentMode } from './lib/agent-mode';
import { createExampleAgent } from './agents/example-agent';
import { createSummaryAgent } from './agents/summary-agent';
import { createScaffoldBuilderAgent } from './agents/scaffold-builder';

/**
 * THE CREW — the single source of truth for this project's agent roster and its
 * orchestrator front door. Declare the crew here and nowhere else:
 *
 *   - `mastra/index.ts` registers exactly `crewAgents(crew)` on the Mastra
 *     instance (orchestrator + members, de-duplicated).
 *   - Phase 2 will extend `emit:import-manifest` to write the AgentBase
 *     `orchestration` block from this same value, so the import contract can't
 *     drift from the wiring. (See docs/plans/orchestrator-crew-plan.md.)
 *
 * The orchestrator (`crew-orchestrator`) is a single point of contact that
 * routes to the right member in-process; each member keeps its own A2A card and
 * stays independently invocable. With a single member the orchestrator collapses
 * to that member (no routing hop) — it activates at 2+ members.
 *
 * The example and summary agents are neutral placeholders. Replace them with
 * your project's real agents (designed from templates/AGENT_SPEC.md) — the crew
 * and everything downstream update automatically from this list.
 */
// Factories preserve scenario isolation without awaited dynamic imports. Mastra
// can extract shared code into the entry chunk; awaiting a child that imports
// that chunk deadlocks module initialization in the deployed bundle.
const members =
  resolveAgentMode() === 'scaffold-builder'
    ? [createScaffoldBuilderAgent()]
    : [await createExampleAgent(), createSummaryAgent()];

export const crew = defineCrew({ members });

export { crewAgents } from './lib/crew';
