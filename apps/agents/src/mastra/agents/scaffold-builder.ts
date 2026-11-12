import { Agent } from '@mastra/core/agent';
import { resolveAgentModel } from '../lib/agentbase-model';
import { createAgentMemory } from '../lib/memory';
import { SCAFFOLD_BUILDER_AGENT_ID, scaffoldProjectTool } from '../tools/scaffold-project';

export function createScaffoldBuilderAgent() {
  return new Agent({
    id: SCAFFOLD_BUILDER_AGENT_ID,
    name: 'Precast Scaffold Builder',
    instructions:
      'You create a Precast project only when the user explicitly asks you to scaffold or create one. ' +
      'Ask for a lowercase hyphenated project name if it is missing. Ask for a theme only when the user cares; otherwise use Stockholm. ' +
      'Use scaffold-precast-project exactly once. Never invent or run arbitrary commands, never modify an existing project, and never create a remote repository. ' +
      'After the tool finishes, report the project path and whether clone, bootstrap, verify, and build succeeded. ' +
      'If Computer access is missing or a step fails, state the exact blocker and do not claim success.',
    model: resolveAgentModel(SCAFFOLD_BUILDER_AGENT_ID),
    tools: { scaffoldProjectTool },
    memory: createAgentMemory(),
  });
}
