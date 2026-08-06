#!/usr/bin/env node
/**
 * set-theme.mjs — Choose the APC Design System theme this project uses.
 *
 *   pnpm set-theme arctic        # switch to Arctic
 *   pnpm set-theme               # list the themes and show the current one
 *
 * The five APC themes share one token architecture — shared core neutrals and
 * scale, a per-theme colour primitive set, and a semantic alias layer that
 * components bind to — so switching is a token swap, not a rewrite. Preview them
 * all at https://apc-design-system.917v.dev.
 *
 * `pnpm bootstrap` asks for this up front; this script is how you change your
 * mind later. It rewrites the single constant in
 * `apps/web/app/theme/apc-theme.ts`, which `layout.tsx` renders as
 * `data-apc-theme` on <html>.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APC_THEMES, DEFAULT_THEME } from './build-apc-theme.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const THEME_TS = join(rootDir, 'apps/web/app/theme/apc-theme.ts');
const THEME_RE = /(export const APC_THEME: ApcTheme = ')([a-z]+)(';)/;

export const THEME_IDS = APC_THEMES.map((t) => t.id);

/** The theme currently wired into the web app, or null if it can't be read. */
export function currentTheme() {
  if (!existsSync(THEME_TS)) return null;
  return readFileSync(THEME_TS, 'utf-8').match(THEME_RE)?.[2] ?? null;
}

/** Point the web app at `id`. Returns false when it was already set. */
export function setTheme(id) {
  const before = readFileSync(THEME_TS, 'utf-8');
  if (!THEME_RE.test(before)) {
    throw new Error(
      `Could not find the APC_THEME constant in ${THEME_TS}. ` +
        'If it was reformatted, keep the literal on one line.',
    );
  }
  const after = before.replace(THEME_RE, `$1${id}$3`);
  if (after === before) return false;
  writeFileSync(THEME_TS, after, 'utf-8');
  return true;
}

function list(current) {
  console.log('\nAPC Design System themes — https://apc-design-system.917v.dev\n');
  for (const { id, label } of APC_THEMES) {
    const mark = id === current ? '●' : '○';
    const note = id === DEFAULT_THEME ? ' (default)' : '';
    console.log(`  ${mark} ${label.padEnd(10)} ${id}${note}`);
  }
  console.log(`\nCurrent: ${current ?? 'unknown'}`);
  console.log('Switch:  pnpm set-theme <name>\n');
}

function main() {
  if (!existsSync(THEME_TS)) {
    console.error(`❌ ${THEME_TS} not found — is this a Precast web app?`);
    process.exit(1);
  }
  const current = currentTheme();
  const requested = process.argv.slice(2).find((a) => !a.startsWith('--'));

  if (!requested) {
    list(current);
    return;
  }

  const id = requested.toLowerCase();
  if (!THEME_IDS.includes(id)) {
    console.error(`❌ Unknown theme "${requested}". Choose one of: ${THEME_IDS.join(', ')}.`);
    console.error('   Preview them at https://apc-design-system.917v.dev');
    process.exit(1);
  }

  const changed = setTheme(id);
  const label = APC_THEMES.find((t) => t.id === id).label;
  console.log(
    changed
      ? `✅ Theme set to ${label}. Run \`pnpm poc web\` to see it, or \`pnpm dev:web\` locally.`
      : `Already on ${label} — nothing to change.`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
