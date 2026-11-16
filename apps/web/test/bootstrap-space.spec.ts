import { describe, expect, it } from 'vitest';
import { checkBootstrapSpace } from '../../../scripts/bootstrap-space.mjs';

describe('bootstrap disk-space boundary', () => {
  const stats = (gib: number) => () => ({ bavail: gib * 1024 ** 3, bsize: 1 });
  it('refuses a cold install before it partially fills the project volume', () => {
    expect(() => checkBootstrapSpace('/unused', stats(5), false)).toThrow(
      /6 GiB.*5.0 GiB available/,
    );
    expect(() => checkBootstrapSpace('/unused', stats(6), false)).not.toThrow();
  });
  it('allows an installed workspace to reserve only the remaining build space', () => {
    expect(() => checkBootstrapSpace('/unused', stats(2), true)).not.toThrow();
    expect(() => checkBootstrapSpace('/unused', stats(1), true)).toThrow(/2 GiB/);
  });
});
