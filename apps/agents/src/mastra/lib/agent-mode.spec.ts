import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveAgentMode } from './agent-mode';

describe('PRECAST_AGENT_MODE', () => {
  it('keeps the existing project crew as the safe default', () => {
    expect(resolveAgentMode(undefined)).toBe('project');
    expect(resolveAgentMode('project')).toBe('project');
  });

  it('enables the isolated scaffold builder only by explicit mode', () => {
    expect(resolveAgentMode('scaffold-builder')).toBe('scaffold-builder');
    expect(() => resolveAgentMode('builder')).toThrow(/PRECAST_AGENT_MODE/);
  });

  it('limits Computer and network access to the builder and its two public dependency hosts', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../../../../agentbase.import.json', import.meta.url), 'utf8'),
    );
    expect(manifest.computer.agents).toEqual(['scaffold-builder']);
    expect(manifest.computer.needs.domains.map((item: { domain: string }) => item.domain)).toEqual([
      'github.com',
      'registry.npmjs.org',
    ]);
    expect(manifest.computer.needs.authenticatedSites).toBeNull();
    expect(manifest.computer.needs.secretAliases).toEqual([]);
  });
});
