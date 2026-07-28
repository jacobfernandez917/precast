import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV4 } from '@ai-sdk/provider';

/**
 * DEFAULT-LLM — chooses the *local* (non-AgentBase) fallback model without
 * privileging any single provider. Mastra's built-in model gateway already
 * resolves a `"<provider>/<model>"` string and reads that provider's own
 * standard env var — this module only decides which string to hand it:
 *
 *   1. `DEFAULT_LLM_MODEL` set explicitly → use it verbatim. This is the
 *      user's own declared choice (see .env.example) and always wins.
 *   2. Otherwise, auto-detect from whichever provider key is present, checked
 *      in `PROVIDER_DEFAULTS` order, and use that provider's default model.
 *      The order is an arbitrary, documented tie-break for the case where
 *      more than one key is set — it does not imply a recommended provider.
 *   3. None configured → a call-time-failing model, same shape as
 *      `unconfiguredHostedModel` in ./agentbase-model.ts: boot still
 *      succeeds, but any actual generate/stream call throws a clear,
 *      actionable message naming the supported env vars.
 *
 * Called once per agent, at agent-definition time (see agents/*.ts).
 *
 * The providers below are the ones Mastra ships a first-party package for
 * (`PROVIDERS_WITH_INSTALLED_PACKAGES` in @mastra/core), so each works with a
 * bare `<provider>/<model>` string and no extra dependency. Env var names and
 * model ids are taken from Mastra's own bundled registry, not guessed. Mastra
 * additionally resolves 100+ community providers by the same string form —
 * any of those still work via `DEFAULT_LLM_MODEL` (step 1), they just aren't
 * auto-detected here.
 */

interface ProviderDefault {
  /** Provider id exactly as Mastra's model gateway knows it. */
  id: string;
  /**
   * Env var(s) whose presence selects this provider. Several providers accept
   * more than one name (e.g. Google) — any match selects it; the first is the
   * canonical one used in docs and error messages.
   */
  envVars: readonly string[];
  /** Default `<provider>/<model>` string used when this provider is selected. */
  model: string;
}

/**
 * Direct providers first, then multi-model routers — so that if someone has
 * both a direct key and a router key set, the direct provider wins (a router
 * key is usually the broader fallback, not the intended primary).
 */
const PROVIDER_DEFAULTS: readonly ProviderDefault[] = [
  { id: 'anthropic', envVars: ['ANTHROPIC_API_KEY'], model: 'anthropic/claude-sonnet-5' },
  { id: 'openai', envVars: ['OPENAI_API_KEY'], model: 'openai/gpt-5.1' },
  {
    id: 'google',
    envVars: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
    model: 'google/gemini-2.5-flash',
  },
  { id: 'xai', envVars: ['XAI_API_KEY'], model: 'xai/grok-4.3' },
  { id: 'mistral', envVars: ['MISTRAL_API_KEY'], model: 'mistral/mistral-large-latest' },
  { id: 'deepseek', envVars: ['DEEPSEEK_API_KEY'], model: 'deepseek/deepseek-chat' },
  { id: 'groq', envVars: ['GROQ_API_KEY'], model: 'groq/llama-3.3-70b-versatile' },
  { id: 'cerebras', envVars: ['CEREBRAS_API_KEY'], model: 'cerebras/gpt-oss-120b' },
  { id: 'perplexity', envVars: ['PERPLEXITY_API_KEY'], model: 'perplexity/sonar-pro' },
  // Routers / aggregators — their model ids are themselves `vendor/model`, so
  // the full string has three segments. Mastra splits on the FIRST slash only,
  // so `openrouter/anthropic/claude-sonnet-5` resolves as
  // provider=openrouter, modelId=anthropic/claude-sonnet-5.
  {
    id: 'openrouter',
    envVars: ['OPENROUTER_API_KEY'],
    model: 'openrouter/anthropic/claude-sonnet-5',
  },
  {
    id: 'vercel',
    envVars: ['AI_GATEWAY_API_KEY'],
    model: 'vercel/anthropic/claude-sonnet-5',
  },
];

/** Canonical env var per provider, for docs and error messages. */
export const SUPPORTED_LLM_ENV_VARS: readonly string[] = PROVIDER_DEFAULTS.map((p) => p.envVars[0]);

/**
 * Built from the table above so it can never drift from what's actually
 * detected.
 */
function unconfiguredMessage(): string {
  return (
    'No LLM provider is configured. Set one of these in .env — ' +
    `${SUPPORTED_LLM_ENV_VARS.join(', ')} — or set DEFAULT_LLM_MODEL to a ` +
    '"<provider>/<model>" string if you want a specific model (or a provider ' +
    'not in that list) rather than the auto-detected default.'
  );
}

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
      throw new Error(unconfiguredMessage());
    },
  });
  return provider('unconfigured');
}

function detectProvider(): ProviderDefault | undefined {
  return PROVIDER_DEFAULTS.find(({ envVars }) => envVars.some((v) => process.env[v]));
}

export function resolveDefaultModel(): string | LanguageModelV4 {
  const explicit = process.env.DEFAULT_LLM_MODEL;
  if (explicit) return explicit;

  const match = detectProvider();
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
  return Boolean(process.env.DEFAULT_LLM_MODEL || detectProvider());
}
