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
import { fileURLToPath } from 'node:url';
import { dockerStatus } from './check-docker.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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
  console.error('   Fix: cp .env.example .env   (then edit with your values)');
  process.exit(1);
}

const result = spawnSync('docker', ['compose', '--env-file', '.env', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
