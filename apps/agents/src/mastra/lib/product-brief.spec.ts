import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveProductBrief } from './product-brief';
const brief = {
  title: 'Browser assistant',
  mission: 'Read approved pages.',
  audience: 'Account owner',
  agentJob: 'Summarize approved inbox content.',
  collections: [
    {
      id: 'notes',
      label: 'Notes',
      singular: 'Note',
      fields: [{ id: 'title', label: 'Title', type: 'text', required: true, choices: [] }],
    },
  ],
  acceptanceCriteria: ['Read only approved pages.'],
  capabilities: {
    computer: {
      domains: ['mail.google.com'],
      authenticatedSites: true,
      purpose: 'Read the owner’s approved inbox in Raya.',
    },
  },
};
afterEach(() => vi.unstubAllEnvs());
describe('operator-configured product agents in the existing repository', () => {
  it('validates the full product boundary and defaults access off', () => {
    expect(resolveProductBrief('')).toBeNull();
    vi.stubEnv('PRECAST_AGENT_MODE', 'project');
    expect(resolveProductBrief(JSON.stringify(brief))).toMatchObject({
      capabilities: { computer: { domains: ['mail.google.com'] }, payments: 'disabled' },
    });
    expect(() =>
      resolveProductBrief(
        JSON.stringify({ ...brief, capabilities: { computer: { domains: ['*.google.com'] } } }),
      ),
    ).toThrow();
  });
  it('refuses a product override on the privileged scaffold builder surface', () => {
    vi.stubEnv('PRECAST_AGENT_MODE', 'scaffold-builder');
    expect(() => resolveProductBrief(JSON.stringify(brief))).toThrow(/project mode/);
  });
});
