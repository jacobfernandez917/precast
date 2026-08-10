import type { Agent } from '@mastra/core/agent';
import { createOrchestrator, ORCHESTRATOR_ID } from '../agents/orchestrator';

/**
 * The crew — a project's agent roster plus its (optional) orchestrator front
 * door. `crew.ts` (one level up) is the single place a project declares this;
 * everything else — `mastra/index.ts` registration and, in Phase 2, the
 * `emit:import-manifest` `orchestration` block — derives from the value
 * `defineCrew()` returns, so the Mastra wiring and the AgentBase import contract
 * can't drift. See docs/plans/orchestrator-crew-plan.md §2–§3.
 */
export interface Crew {
  /**
   * The single point of contact.
   *   - 2+ members  → a distinct orchestrator agent (`crew-orchestrator`) that
   *     routes to members in-process (see `createOrchestrator`).
   *   - exactly 1   → the sole member itself (transparent pass-through): no
   *     orchestrator hop, no extra card. "No dead weight at N=1."
   */
  orchestrator: Agent;
  /** The specialist members, in declaration order. Each keeps its own A2A card. */
  members: Agent[];
  /** True only when a distinct orchestrator is in front of 2+ members. */
  isActive: boolean;
}

export interface DefineCrewOptions {
  /** The specialist agents. Order is preserved (used for the routing roster). */
  members: Agent[];
}

/**
 * Declares the crew from its members and scaffolds the orchestrator.
 *
 * The orchestrator is *always* scaffolded but only *activates* at 2+ members —
 * at N=1 it collapses to the sole member so a single-agent project pays no
 * routing hop. The orchestrator id (`crew-orchestrator`) is reserved: a member
 * may not use it, and — to keep the crew a single flat layer for now — a member
 * may not itself already be an orchestrator (that is the cycle/depth risk called
 * out in the plan §6; deeper nesting is deliberately out of Phase 1 scope).
 */
export function defineCrew(opts: DefineCrewOptions): Crew {
  const { members } = opts;

  if (members.length === 0) {
    throw new Error('defineCrew(): a crew needs at least one member.');
  }

  const seen = new Set<string>();
  for (const member of members) {
    if (member.id === ORCHESTRATOR_ID) {
      throw new Error(
        `defineCrew(): "${ORCHESTRATOR_ID}" is reserved for the crew's orchestrator — ` +
          'a member may not use that id.',
      );
    }
    if (seen.has(member.id)) {
      throw new Error(`defineCrew(): duplicate member id "${member.id}".`);
    }
    seen.add(member.id);
    if (member.__hasSubAgentsConfigured?.()) {
      throw new Error(
        `defineCrew(): member "${member.id}" is itself an orchestrator (it has sub-agents). ` +
          'Nested crews are out of scope — flatten the roster into a single layer.',
      );
    }
  }

  // N=1 → transparent pass-through: the sole member IS the front door.
  if (members.length === 1) {
    return { orchestrator: members[0], members, isActive: false };
  }

  const byId: Record<string, Agent> = {};
  for (const member of members) byId[member.id] = member;

  return { orchestrator: createOrchestrator(byId), members, isActive: true };
}

/**
 * The exact set of agents to register on the Mastra instance for a crew, keyed
 * by agent id and de-duplicated. `mastra/index.ts` spreads this into
 * `new Mastra({ agents })`.
 *
 *   - N=1  → just the sole member (the orchestrator IS that member; no dup).
 *   - 2+   → every member plus the distinct orchestrator.
 *
 * Members are always included so each keeps its own A2A card and stays
 * standalone — the orchestrator never swallows them.
 */
export function crewAgents(crew: Crew): Record<string, Agent> {
  const agents: Record<string, Agent> = {};
  for (const member of crew.members) agents[member.id] = member;
  if (crew.isActive) agents[crew.orchestrator.id] = crew.orchestrator;
  return agents;
}
