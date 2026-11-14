import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDatabaseSetupMode } from './database-setup-mode';
afterEach(() => vi.unstubAllEnvs());
describe('AGT-045 operator database mode is fail closed', () => {
  it('preserves the ordinary default and explicit reuse mode', () => {
    vi.stubEnv('PRECAST_DATABASE_SETUP_MODE', undefined);
    expect(resolveDatabaseSetupMode()).toBe('provision');
    vi.stubEnv('PRECAST_DATABASE_SETUP_MODE', 'existing');
    expect(resolveDatabaseSetupMode()).toBe('existing');
  });
  it.each(['exsting', '', 'EXISTING'])('rejects an invalid restriction %s', (mode) => {
    vi.stubEnv('PRECAST_DATABASE_SETUP_MODE', mode);
    expect(() => resolveDatabaseSetupMode()).toThrow(/not configured correctly/);
  });
});
