import { afterEach, describe, expect, it, vi } from 'vitest';

const factories = vi.hoisted(() => ({
  example: vi.fn(async () => ({ id: 'example-agent' })),
  summary: vi.fn(() => ({ id: 'summary-agent' })),
  builder: vi.fn(() => ({ id: 'scaffold-builder' })),
}));

vi.mock('./agents/example-agent', () => ({ createExampleAgent: factories.example }));
vi.mock('./agents/summary-agent', () => ({ createSummaryAgent: factories.summary }));
vi.mock('./agents/scaffold-builder', () => ({ createScaffoldBuilderAgent: factories.builder }));
vi.mock('./lib/crew', () => ({ defineCrew: (crew: unknown) => crew, crewAgents: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('scenario-gated crew construction', () => {
  it('constructs the project crew without initializing privileged builder tools or memory', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'project');
    const { crew } = await import('./crew');
    expect(crew.members.map((agent) => agent.id)).toEqual(['example-agent', 'summary-agent']);
    expect(factories.example).toHaveBeenCalledOnce();
    expect(factories.summary).toHaveBeenCalledOnce();
    expect(factories.builder).not.toHaveBeenCalled();
  });

  it('constructs only the builder without running project MCP preflight', async () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    const { crew } = await import('./crew');
    expect(crew.members.map((agent) => agent.id)).toEqual(['scaffold-builder']);
    expect(factories.builder).toHaveBeenCalledOnce();
    expect(factories.example).not.toHaveBeenCalled();
    expect(factories.summary).not.toHaveBeenCalled();
  });
});
