import { describe, it, expect } from 'vitest';
import { Agent } from '@mastra/core/agent';
import { defineCrew, crewAgents } from './crew';
import { ORCHESTRATOR_ID } from '../agents/orchestrator';

/**
 * Lightweight, DB-free member: a real `Agent` with a plain model string and no
 * memory, so construction touches neither Postgres nor an LLM key. This mirrors
 * how the other lib specs test units in isolation rather than importing the
 * real placeholder agents (whose module load eagerly builds Postgres-backed
 * memory).
 */
function stubMember(id: string): Agent {
  return new Agent({
    id,
    name: id,
    instructions: `Test member ${id}.`,
    model: 'openai/gpt-5.1',
  });
}

describe('defineCrew', () => {
  it('activates a distinct orchestrator over the members at 2+', () => {
    const a = stubMember('research-agent');
    const b = stubMember('writer-agent');

    const crew = defineCrew({ members: [a, b] });

    expect(crew.isActive).toBe(true);
    expect(crew.orchestrator.id).toBe(ORCHESTRATOR_ID);
    expect(crew.orchestrator).not.toBe(a);
    expect(crew.members).toEqual([a, b]);

    // Members are wired in-process as the orchestrator's routing targets.
    expect(crew.orchestrator.__hasSubAgentsConfigured?.()).toBe(true);
    const subAgents = crew.orchestrator.__getStaticAgents?.() ?? {};
    expect(Object.keys(subAgents).sort()).toEqual(['research-agent', 'writer-agent']);
  });

  it('collapses to the sole member at N=1 (no orchestrator hop, no extra card)', () => {
    const only = stubMember('solo-agent');

    const crew = defineCrew({ members: [only] });

    expect(crew.isActive).toBe(false);
    expect(crew.orchestrator).toBe(only);
    expect(crew.orchestrator.__hasSubAgentsConfigured?.()).toBeFalsy();
  });

  it('rejects an empty crew', () => {
    expect(() => defineCrew({ members: [] })).toThrow(/at least one member/i);
  });

  it('rejects a member that squats the reserved orchestrator id', () => {
    expect(() => defineCrew({ members: [stubMember(ORCHESTRATOR_ID), stubMember('x')] })).toThrow(
      /reserved/i,
    );
  });

  it('rejects duplicate member ids', () => {
    expect(() => defineCrew({ members: [stubMember('dup'), stubMember('dup')] })).toThrow(
      /duplicate member id/i,
    );
  });

  it('rejects a nested crew (a member that is itself an orchestrator)', () => {
    const inner = defineCrew({ members: [stubMember('a'), stubMember('b')] });
    expect(() => defineCrew({ members: [inner.orchestrator, stubMember('c')] })).toThrow(
      /sub-agents|reserved/i,
    );
  });
});

describe('crewAgents', () => {
  it('registers members + orchestrator (deduped by id) when active', () => {
    const crew = defineCrew({
      members: [stubMember('research-agent'), stubMember('writer-agent')],
    });

    const registry = crewAgents(crew);

    expect(Object.keys(registry).sort()).toEqual([
      'crew-orchestrator',
      'research-agent',
      'writer-agent',
    ]);
    expect(registry['research-agent']).toBe(crew.members[0]);
    expect(registry[ORCHESTRATOR_ID]).toBe(crew.orchestrator);
  });

  it('registers only the sole member at N=1 (no duplicate front-door card)', () => {
    const only = stubMember('solo-agent');
    const crew = defineCrew({ members: [only] });

    const registry = crewAgents(crew);

    expect(Object.keys(registry)).toEqual(['solo-agent']);
    expect(registry['solo-agent']).toBe(only);
  });
});
