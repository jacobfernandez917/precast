#!/usr/bin/env node
/**
 * docker-compose.mjs — thin wrapper so every `pnpm docker:*` script reads the
 * root `.env` for Compose's OWN variable interpolation (${AGENTS_HOST_PORT},
 * COMPOSE_PROFILES, ${KEYCLOAK_ADMIN}, …).
 *
 * Docker Compose does NOT read the repo-root .env by default when invoked with
 * `-f docker/docker-compose.yml` from the repo root — it looks for `.env` in the
 * COMPOSE FILE's directory (docker/.env) unless told otherwise. `--env-file .env`
 * (relative to cwd = repo root) fixes that — but it errors if the file is
 * missing, so this wrapper fails fast with a clear message instead (matching
 * CLAUDE.md's "validate env at boot, fail fast" rule; the container-runtime
 * `env_file: ../.env` on each service stays `required: false` — this is a
 * separate, additive check for Compose's own file-level interpolation).
 *
 * Usage: node scripts/docker-compose.mjs <docker compose args...>
 *   e.g. node scripts/docker-compose.mjs -f docker/docker-compose.yml up -d
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dockerStatus } from './check-docker.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Compose files a developer may add locally; git-ignored, so a fresh clone has none. */
export const OPTIONAL_COMPOSE_FILES = ['docker/docker-compose.override.yml'];

/**
 * Drop `-f <file>` pairs that name an optional compose file which does not
 * exist. Compose errors on any explicit `-f` it cannot open, and it only
 * auto-merges `docker-compose.override.yml` when NO `-f` is passed, so a
 * fresh clone (where the git-ignored override is absent) failed `pnpm poc`
 * before a single container started (found by the scaffold gate, 2026-10-22).
 * The base compose file is never dropped: a missing one is a real error.
 */
export function composeArgs(args, exists = (f) => existsSync(join(root, f))) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = args[i + 1];
    if (a === '-f' && OPTIONAL_COMPOSE_FILES.includes(next) && !exists(next)) {
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

function main() {
  // Container-runtime preflight: a missing/stopped engine otherwise surfaces as a
  // raw daemon-socket error, which reads like a Precast bug rather than "install
  // Docker Desktop". scripts/check-docker.mjs owns the platform-specific fix.
  if (dockerStatus() !== 'running') {
    spawnSync('node', ['scripts/check-docker.mjs'], { cwd: root, stdio: 'inherit' });
    process.exit(1);
  }

  if (!existsSync(join(root, '.env'))) {
    console.error('❌ .env not found at the repo root.');
    console.error(
      '   Docker Compose reads it for ports, service selection (COMPOSE_PROFILES), and config.',
    );
    console.error('   Fix: cp .env.example .env');
    console.error(
      '   Then: pnpm connect (AgentBase Application and model) and pnpm db:provision (database).',
    );
    process.exit(1);
  }

  const args = composeArgs(process.argv.slice(2));
  const result = spawnSync('docker', ['compose', '--env-file', '.env', ...args], {
    cwd: root,
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

/** One line a person can act on; the full error only when asked for. */
function exitWithReason(err) {
  console.error(`\n❌ ${err?.message ?? err}`);
  if (process.env.PRECAST_DEBUG) console.error(err?.stack ?? err);
  else console.error('   (PRECAST_DEBUG=1 shows the full error.)');
  process.exit(1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  Promise.resolve().then(main).catch(exitWithReason);
}
