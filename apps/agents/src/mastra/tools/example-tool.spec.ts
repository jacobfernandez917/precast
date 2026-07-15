import { describe, expect, it } from 'vitest';
import { echo } from './example-tool';

describe('echo', () => {
  it('returns its input message', () => {
    expect(echo({ message: 'hello' })).toEqual({ echoed: 'hello' });
  });
});
