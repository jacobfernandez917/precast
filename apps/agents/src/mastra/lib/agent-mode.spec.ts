import { describe, expect, it } from 'vitest';
import { resolvePrecastAgentMode } from './agent-mode';

describe('PRECAST_AGENT_MODE', () => {
  it('keeps the existing project crew as the safe default', () => {
    expect(resolvePrecastAgentMode(undefined)).toBe('project');
    expect(resolvePrecastAgentMode('project')).toBe('project');
  });

  it('enables the isolated scaffold builder only by explicit mode', () => {
    expect(resolvePrecastAgentMode('scaffold-builder')).toBe('scaffold-builder');
    expect(() => resolvePrecastAgentMode('builder')).toThrow(/PRECAST_AGENT_MODE/);
  });
});
