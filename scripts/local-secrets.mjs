/**
 * Secrets only this machine needs: minted into .env when missing, never
 * overwritten, and .env kept readable by its owner only.
 *
 * `pnpm bootstrap` calls it for a new project and `pnpm poc` on every run, so a
 * project created before a secret existed gets it the next time someone says
 * "show it to me", with nothing to type.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

export const LOCAL_SECRETS = {
  // The bearer every caller of the agents API must send. AgentBase mints its own
  // for a hosted container and overrides this one.
  AGENT_API_TOKEN: () => randomBytes(32).toString('hex'),
  // Signs sign-in sessions in the web app. Better Auth refuses to run without it.
  BETTER_AUTH_SECRET: () => randomBytes(32).toString('base64url'),
};

/** .env holds the Application secret and the database password: owner only. */
export function restrictEnvFile(envPath) {
  try {
    chmodSync(envPath, 0o600);
  } catch {
    // Not supported on this file system (Windows); nothing more to do.
  }
}

/** The secrets added, by name. An existing non-empty value is never replaced. */
export function ensureLocalSecrets(envPath) {
  if (!existsSync(envPath)) return [];
  let text = readFileSync(envPath, 'utf8');
  const added = [];
  for (const [key, make] of Object.entries(LOCAL_SECRETS)) {
    const current = text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim();
    if (current) continue;
    const line = `${key}=${make()}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
    added.push(key);
  }
  if (added.length) writeFileSync(envPath, text, 'utf8');
  restrictEnvFile(envPath);
  return added;
}
