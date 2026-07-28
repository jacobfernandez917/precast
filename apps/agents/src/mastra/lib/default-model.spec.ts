import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveDefaultModel } from './default-model';

const ENV_KEYS = ['DEFAULT_LLM_MODEL', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'] as const;
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

  it('auto-detects Anthropic when only ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(resolveDefaultModel()).toBe('anthropic/claude-sonnet-5');
  });

  it('auto-detects OpenAI when only OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(resolveDefaultModel()).toBe('openai/gpt-5.1');
  });

  it('auto-detects Google when only GOOGLE_GENERATIVE_AI_API_KEY is set', () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key';
    expect(resolveDefaultModel()).toBe('google/gemini-2.5-flash');
  });

  it('prefers Anthropic over OpenAI/Google when multiple keys are set (documented tie-break, not a recommendation)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key';
    expect(resolveDefaultModel()).toBe('anthropic/claude-sonnet-5');
  });

  it('returns a call-time-failing model when nothing is configured, not a string', () => {
    const result = resolveDefaultModel();
    expect(typeof result).toBe('object');
    expect((result as { modelId: string }).modelId).toBe('unconfigured');
  });

  it('the unconfigured model fails at CALL time with an actionable message naming all three env vars', async () => {
    const result = resolveDefaultModel() as unknown as {
      doGenerate: (o: unknown) => Promise<unknown>;
    };
    await expect(
      result.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY.*OPENAI_API_KEY.*GOOGLE_GENERATIVE_AI_API_KEY/s);
  });
});
