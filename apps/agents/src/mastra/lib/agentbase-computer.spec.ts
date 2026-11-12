import { describe, expect, it } from 'vitest';
import { argumentDigest } from './agentbase-computer';

describe('AgentBase Computer command binding', () => {
  it('matches AgentBase canonical argument hashing', () => {
    expect(argumentDigest({ b: 1, a: 2 })).toBe(argumentDigest({ a: 2, b: 1 }));
    expect(argumentDigest({ a: 2, omitted: undefined })).toBe(argumentDigest({ a: 2 }));
    expect(argumentDigest({ cwd: 'Projects/a' })).not.toBe(argumentDigest({ cwd: 'Projects/b' }));
  });
});
