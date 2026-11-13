export type AgentMode = 'project' | 'scaffold-builder';

/** Match AgentBase's bounded turn window for the builder's long Computer workflow. */
export function serverOptionsForMode(mode: AgentMode): { timeout: number } {
  return { timeout: mode === 'scaffold-builder' ? 15 * 60_000 : 3 * 60_000 };
}

export function resolveAgentMode(
  value: string | undefined = process.env.PRECAST_AGENT_MODE,
): AgentMode {
  if (!value || value === 'project') return 'project';
  if (value === 'scaffold-builder') return value;
  throw new Error(`PRECAST_AGENT_MODE must be "project" or "scaffold-builder" (got "${value}").`);
}
