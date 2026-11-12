export type AgentMode = 'project' | 'scaffold-builder';

export function resolveAgentMode(
  value: string | undefined = process.env.PRECAST_AGENT_MODE,
): AgentMode {
  if (!value || value === 'project') return 'project';
  if (value === 'scaffold-builder') return value;
  throw new Error(`PRECAST_AGENT_MODE must be "project" or "scaffold-builder" (got "${value}").`);
}
