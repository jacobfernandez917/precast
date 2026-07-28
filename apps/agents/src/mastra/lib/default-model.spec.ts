import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SUPPORTED_LLM_ENV_VARS, isLlmProviderConfigured, resolveDefaultModel } from './default-model';

/**
 * Every env var the module can read — the canonical ones plus the non-canonical
 * aliases (e.g. GOOGLE_API_KEY) that aren't in SUPPORTED_LLM_ENV_VARS. Cleared
 * before each test so a real key in the developer's shell can't make these pass
 * or fail spuriously.
 */
const ENV_KEYS = ['DEFAULT_LLM_MODEL', ...SUPPORTED_LLM_ENV_VARS, 'GOOGLE_API_KEY'] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe('resolveDefaultModel', () => {
  it('uses DEFAULT_LLM_MODEL verbatim when set, regardless of which keys are also present', () => {
    process.env.DEFAULT_LLM_MODEL = 'openai/gpt-5.1';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(resolveDefaultModel()).toBe('openai/gpt-5.1');
  });

  it('passes through a router model string with its vendor prefix intact', () => {
    // Mastra splits on the FIRST slash only, so the extra segment is the
    // router's own vendor-qualified model id — not a malformed string.
    process.env.DEFAULT_LLM_MODEL = 'openrouter/anthropic/claude-opus-5';
    expect(resolveDefaultModel()).toBe('openrouter/anthropic/claude-opus-5');
  });

  // One row per auto-detected provider — keep in sync with PROVIDER_DEFAULTS.
  it.each([
    ['ANTHROPIC_API_KEY', 'anthropic/claude-sonnet-5'],
    ['OPENAI_API_KEY', 'openai/gpt-5.1'],
    ['GOOGLE_GENERATIVE_AI_API_KEY', 'google/gemini-2.5-flash'],
    ['XAI_API_KEY', 'xai/grok-4.3'],
    ['MISTRAL_API_KEY', 'mistral/mistral-large-latest'],
    ['DEEPSEEK_API_KEY', 'deepseek/deepseek-chat'],
    ['GROQ_API_KEY', 'groq/llama-3.3-70b-versatile'],
    ['CEREBRAS_API_KEY', 'cerebras/gpt-oss-120b'],
    ['PERPLEXITY_API_KEY', 'perplexity/sonar-pro'],
    ['OPENROUTER_API_KEY', 'openrouter/anthropic/claude-sonnet-5'],
    ['AI_GATEWAY_API_KEY', 'vercel/anthropic/claude-sonnet-5'],
  ])('auto-detects the provider when only %s is set', (envVar, expected) => {
    process.env[envVar] = 'test-key';
    expect(resolveDefaultModel()).toBe(expected);
  });

  it('accepts GOOGLE_API_KEY as an alias for GOOGLE_GENERATIVE_AI_API_KEY', () => {
    process.env.GOOGLE_API_KEY = 'test-key';
    expect(resolveDefaultModel()).toBe('google/gemini-2.5-flash');
  });

  it('prefers the earliest-listed provider when several keys are set (documented tie-break, not a recommendation)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.GROQ_API_KEY = 'test-key';
    expect(resolveDefaultModel()).toBe('anthropic/claude-sonnet-5');
  });

  it('prefers a direct provider over a router when both are set', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.MISTRAL_API_KEY = 'test-key';
    expect(resolveDefaultModel()).toBe('mistral/mistral-large-latest');
  });

  it('returns a call-time-failing model when nothing is configured, not a string', () => {
    const result = resolveDefaultModel();
    expect(typeof result).toBe('object');
    expect((result as { modelId: string }).modelId).toBe('unconfigured');
  });

  it('the unconfigured model fails at CALL time with a message naming every supported env var', async () => {
    const result = resolveDefaultModel() as unknown as {
      doGenerate: (o: unknown) => Promise<unknown>;
    };
    // Generated from PROVIDER_DEFAULTS, so this can't drift as providers are added.
    await expect(
      result.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
    ).rejects.toThrow(
      new RegExp(SUPPORTED_LLM_ENV_VARS.map((v) => `(?=.*${v})`).join('') + '.*DEFAULT_LLM_MODEL', 's'),
    );
  });
});

describe('isLlmProviderConfigured', () => {
  it('is false when nothing is set', () => {
    expect(isLlmProviderConfigured()).toBe(false);
  });

  it('is true when DEFAULT_LLM_MODEL is set', () => {
    process.env.DEFAULT_LLM_MODEL = 'openai/gpt-5.1';
    expect(isLlmProviderConfigured()).toBe(true);
  });

  it.each(SUPPORTED_LLM_ENV_VARS)('is true when %s is set', (envVar) => {
    process.env[envVar] = 'test-key';
    expect(isLlmProviderConfigured()).toBe(true);
  });

  it('is true for the GOOGLE_API_KEY alias', () => {
    process.env.GOOGLE_API_KEY = 'test-key';
    expect(isLlmProviderConfigured()).toBe(true);
  });
});
