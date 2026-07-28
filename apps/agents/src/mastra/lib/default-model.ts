import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV4 } from '@ai-sdk/provider';

/**
 * DEFAULT-LLM — chooses the *local* (non-AgentBase) fallback model without
 * privileging any single provider. Mastra's built-in model gateway already
 * resolves a `"<provider>/<model>"` string and reads that provider's own
 * standard env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
 * `GOOGLE_GENERATIVE_AI_API_KEY`) — this module only decides which string to
 * hand it, in order:
 *
 *   1. `DEFAULT_LLM_MODEL` set explicitly → use it verbatim. This is the
 *      user's own declared choice (see .env.example) and always wins.
 *   2. Otherwise, auto-detect from whichever provider key is present, checked
 *      in the order below, and use that provider's current default model.
 *      The order is an arbitrary, documented tie-break for the rare case more
 *      than one key is set — it does not imply a recommended provider.
 *   3. None configured → a call-time-failing model, same shape as
 *      `unconfiguredHostedModel` in ./agentbase-model.ts: boot still
 *      succeeds, but any actual generate/stream call throws a clear,
 *      actionable message naming the supported env vars.
 *
 * Called once per agent, at agent-definition time (see agents/*.ts) — same
 * call site as the old hardcoded `'google/gemini-2.5-flash'` literal it
 * replaces.
 */

const PROVIDER_DEFAULTS: ReadonlyArray<{ envVar: string; model: string }> = [
  { envVar: 'ANTHROPIC_API_KEY', model: 'anthropic/claude-sonnet-5' },
  { envVar: 'OPENAI_API_KEY', model: 'openai/gpt-5.1' },
  { envVar: 'GOOGLE_GENERATIVE_AI_API_KEY', model: 'google/gemini-2.5-flash' },
];

/**
 * A model whose every call fails with a clear, actionable message. Used when
 * no supported provider key is set and `DEFAULT_LLM_MODEL` wasn't given
 * either. The failure is at CALL time, not construction time, so `mastra dev`
 * still boots and the agent card is still discoverable before a key is set.
 */
function unconfiguredLocalModel(): LanguageModelV4 {
  const provider = createOpenAICompatible({
    name: 'unconfigured',
    // Never actually contacted — the fetch below throws first.
    baseURL: 'https://unconfigured.invalid/v1',
    apiKey: 'unused',
    fetch: async () => {
      throw new Error(
        'No LLM provider is configured. Set exactly one of ANTHROPIC_API_KEY, ' +
          'OPENAI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY in .env, or set ' +
          'DEFAULT_LLM_MODEL to a "<provider>/<model>" string if you want a ' +
          'specific model rather than the auto-detected default.',
      );
    },
  });
  return provider('unconfigured');
}

export function resolveDefaultModel(): string | LanguageModelV4 {
  const explicit = process.env.DEFAULT_LLM_MODEL;
  if (explicit) return explicit;

  const match = PROVIDER_DEFAULTS.find(({ envVar }) => process.env[envVar]);
  if (match) return match.model;

  return unconfiguredLocalModel();
}

/**
 * True if `resolveDefaultModel()` would resolve to a real model rather than
 * the call-time-failing stub. Used for a boot-time warning (see
 * `mastra/index.ts`) so an unconfigured provider is visible the moment
 * `mastra dev`/`mastra start` boots, instead of surfacing only when a user
 * actually chats with an agent and hits `unconfiguredLocalModel()`'s error.
 */
export function isLlmProviderConfigured(): boolean {
  return Boolean(
    process.env.DEFAULT_LLM_MODEL || PROVIDER_DEFAULTS.some(({ envVar }) => process.env[envVar]),
  );
}
