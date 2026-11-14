import { z } from 'zod';

const setupMode = z.enum(['provision', 'existing']);

/** A misspelled operator restriction must never become permission to provision. */
export function resolveDatabaseSetupMode() {
  const mode = setupMode.safeParse(process.env.PRECAST_DATABASE_SETUP_MODE ?? 'provision');
  if (!mode.success)
    throw new Error('The operator database setup mode is not configured correctly.');
  return mode.data;
}
