import { Agent } from '@mastra/core/agent';
import type { SubAgent } from '@mastra/core/agent';
import { resolveAgentModel } from '../lib/agentbase-model';
import { resolveDefaultModel } from '../lib/default-model';

/**
 * The crew's front-door agent id. Kept here (not in crew.ts) so both the crew
 * wiring and the future `emit:import-manifest` step (Phase 2) read the same
 * constant — the import contract's `orchestration.orchestrator` must equal this.
 */
export const ORCHESTRATOR_ID = 'crew-orchestrator';

/**
 * A minimal shape the orchestrator needs to describe a member in its routing
 * roster. `Agent` satisfies it (via `SubAgent`), so callers pass real agents;
 * unit tests can pass lightweight stubs.
 */
type RosterMember = Pick<SubAgent, 'id' | 'name' | 'getDescription'>;

function buildRoster(members: readonly RosterMember[]): string {
  return members
    .map((m) => {
      const description = safeDescription(m);
      const label = m.name && m.name !== m.id ? `${m.id} (${m.name})` : m.id;
      return description ? `- ${label}: ${description}` : `- ${label}`;
    })
    .join('\n');
}

/** `getDescription()` is part of the SubAgent contract but a stub may throw or return ''. */
function safeDescription(m: RosterMember): string {
  try {
    return m.getDescription?.().trim() ?? '';
  } catch {
    return '';
  }
}

/**
 * Builds the orchestrator — the crew's single point of contact.
 *
 * Transport is **in-process**: the members are attached via Mastra's `agents`
 * field (agents-as-tools / Agent Network), so the orchestrator's model routes
 * to a member by calling it directly in this process — no network hop, no proxy
 * call. Each member remains a plain agent registered on the Mastra instance, so
 * it keeps its own A2A card and stays independently invocable; the orchestrator
 * is purely additive (see docs/plans/orchestrator-crew-plan.md §2).
 *
 * Routing is LLM-decided (a natural-language front door — the actual value):
 * the prompt is kept tight so the model routes rather than guesses. Callers who
 * already know the target can still invoke the member's card directly.
 *
 * No `memory:` — deliberately, on the same rule as `summary-agent`: routing is a
 * transformation of one request into one member call, not a conversation the
 * orchestrator itself holds. Per-member continuity lives in each member's own
 * memory. (Revisit only if the front door needs cross-member continuity of its
 * own — a follow-up, not Phase 1.)
 */
export function createOrchestrator(members: Record<string, Agent>): Agent {
  const roster = buildRoster(Object.values(members));

  return new Agent({
    id: ORCHESTRATOR_ID,
    name: 'Crew Orchestrator',
    instructions:
      'You are the single point of contact for a crew of specialist agents. ' +
      'For each request, pick the ONE member whose description and skills best ' +
      'match, call it, and return its output as the answer. Do not answer a ' +
      "specialist's question yourself — always route it. If no member clearly " +
      'matches, or the request is ambiguous between members, ask one short ' +
      'clarifying question — never guess or fabricate an answer or a route. You ' +
      'may answer directly only meta questions about what this crew can do, ' +
      'using the roster below.\n\n' +
      'Crew members:\n' +
      roster,
    // AgentBase-hosted → org-admin-chosen model; otherwise the repo's default
    // provider (see agentbase-model.ts / default-model.ts) — same resolution as
    // any other agent.
    model: resolveAgentModel(ORCHESTRATOR_ID, resolveDefaultModel()),
    // In-process Agent Network: each member is callable as a routing target.
    agents: members,
  });
}
