#!/usr/bin/env node
/**
 * bootstrap.mjs — Turn Precast into your project in one command.
 *
 *   pnpm bootstrap                 # interactive
 *   pnpm bootstrap my-project      # non-interactive (name as arg)
 *   pnpm bootstrap my-project --yes# skip the confirmation prompt
 *
 * Steps, in order:
 *   1. Ask for (or read) the project name.
 *   2. Pick the stack's ports. By DEFAULT this auto-selects a random, free,
 *      CONSECUTIVE triple in the 45000–49100 range (agents / web / keycloak,
 *      e.g. 45000/45001/45002) — see scripts/set-ports.mjs for why that range.
 *      Consecutive keeps the stack one memorable block; random+free means two
 *      Precast projects on one machine don't fight over 3000/4111 the way they
 *      always did. Any port can still be pinned explicitly.
 *   3. Ask which LLM provider the project will use (see LLM_PROVIDERS below —
 *      Anthropic, OpenAI, Google, xAI, Mistral, DeepSeek, Groq, Cerebras,
 *      Perplexity, the OpenRouter / Vercel AI Gateway routers, **AgentBase
 *      Models** — or skip). For a vendor provider it never collects the key
 *      value, only which one to remind about later. AgentBase Models is the one
 *      exception: it needs five interdependent settings (gateway base URL,
 *      token endpoint, client id, client secret, model), so bootstrap asks for
 *      them together and writes them to `.env` — four of five would look
 *      complete and fail at the first chat. No provider is hardcoded as the default; the agents auto-detect
 *      from whichever single key ends up set in `.env` (see
 *      apps/agents/src/mastra/lib/default-model.ts).
 *   4. Ask which APC Design System theme the web app should use — Stockholm,
 *      Prague, Arctic, Nova, or Melbourne (preview them at
 *      https://apc-design-system.917v.dev). All five share one token
 *      architecture, so this is a token swap rather than a rewrite; asking here
 *      is what keeps Precast-derived products looking like one family.
 *   5. Rename the `precast` placeholder everywhere (scripts/rename-project.mjs).
 *   6. Apply the chosen ports across env, configs, pnpm scripts, Docker, docs
 *      (scripts/set-ports.mjs), and the chosen theme (scripts/set-theme.mjs).
 *   7. Install + update dependencies to latest compatible (scripts/update-deps.mjs).
 *   8. Record provenance in precast.lock.json, then remove Precast's own git
 *      history and re-initialize a BLANK repo on the `develop` branch with a
 *      single initial commit, hooks activated.
 *   9. Create a real `.env` from `.env.example` (if one doesn't already exist),
 *      and print an ACTION-REQUIRED reminder naming the exact env var to set —
 *      not a vague "go edit .env.example" — so an unconfigured LLM provider
 *      can't quietly slip past scaffolding unannounced.
 *
 * Non-interactive port selection uses equals-form flags (anything not pinned is
 * still auto-picked from the same free consecutive block):
 *   pnpm bootstrap my-project --mastra-port=45000 --web-port=45001 --keycloak-port=45002
 *   pnpm bootstrap my-project --ports=keep        # keep the committed defaults
 * Non-interactive LLM provider selection (see LLM_PROVIDERS below for the full
 * set, or `skip` to decide later):
 *   pnpm bootstrap my-project --llm-provider=anthropic
 * AgentBase Models non-interactively needs all five:
 *   pnpm bootstrap my-project --llm-provider=agentbase \
 *     --agentbase-base-url=… --agentbase-token-url=… --agentbase-client-id=… \
 *     --agentbase-client-secret=… --agentbase-model=anthropic/claude-sonnet-5
 * Non-interactive theme selection (defaults to Stockholm when a name is passed
 * as an argument, since there is nobody at the prompt to answer):
 *   pnpm bootstrap my-project --theme=arctic
 *
 * This is destructive to .git on purpose: a project bootstrapped from Precast
 * must not inherit Precast's commit history. It runs LAST so a failure earlier
 * leaves your git history intact.
 */

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickConsecutivePorts, PORT_RANGE } from './set-ports.mjs';
import { dockerStatus } from './check-docker.mjs';
import { stampLock, readManifest } from './precast-lock.mjs';
import { APC_THEMES, DEFAULT_THEME } from './build-apc-theme.mjs';
import { THEME_IDS, setTheme } from './set-theme.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BRANCH = 'develop';
const RESERVED_PORTS = { 5432: 'Postgres', 6379: 'Redis' };
// Keep in sync with PROVIDER_DEFAULTS in
// apps/agents/src/mastra/lib/default-model.ts — that module owns the canonical
// list (and each provider's default model); this one only needs the env var to
// name in the closing reminder.
const LLM_PROVIDERS = [
  { key: 'anthropic', envVar: 'ANTHROPIC_API_KEY', label: 'Anthropic' },
  { key: 'openai', envVar: 'OPENAI_API_KEY', label: 'OpenAI' },
  { key: 'google', envVar: 'GOOGLE_GENERATIVE_AI_API_KEY', label: 'Google' },
  { key: 'xai', envVar: 'XAI_API_KEY', label: 'xAI' },
  { key: 'mistral', envVar: 'MISTRAL_API_KEY', label: 'Mistral' },
  { key: 'deepseek', envVar: 'DEEPSEEK_API_KEY', label: 'DeepSeek' },
  { key: 'groq', envVar: 'GROQ_API_KEY', label: 'Groq' },
  { key: 'cerebras', envVar: 'CEREBRAS_API_KEY', label: 'Cerebras' },
  { key: 'perplexity', envVar: 'PERPLEXITY_API_KEY', label: 'Perplexity' },
  { key: 'openrouter', envVar: 'OPENROUTER_API_KEY', label: 'OpenRouter (router)' },
  { key: 'vercel', envVar: 'AI_GATEWAY_API_KEY', label: 'Vercel AI Gateway (router)' },
  // Not a vendor key: AgentBase's gateway serves the models your org has
  // already onboarded, and the real provider key stays server-side. `envVar` is
  // null because this option needs a SET of values, collected below — so unlike
  // every other entry there is nothing to remind the user about afterwards.
  {
    key: 'agentbase',
    envVar: null,
    label: "AgentBase Models (your org's gateway — no vendor key needed)",
  },
];

/**
 * The account-level AgentBase gateway settings, in prompt order.
 *
 * Token URL, client id and client secret authenticate you. Base URL and model
 * are asked for too, and deliberately: without them the gateway cannot be
 * called at all, so collecting only the credentials would write a config that
 * looks complete and fails at the first chat — the exact silent-misconfiguration
 * this scaffold keeps trying to eliminate.
 */
const AGENTBASE_LLM_FIELDS = [
  {
    env: 'AGENTBASE_LLM_BASE_URL',
    flag: 'agentbase-base-url',
    prompt: 'AgentBase LLM gateway base URL (e.g. https://api.agentbase.../llm/v1)',
    secret: false,
  },
  {
    env: 'AGENTBASE_TOKEN_URL',
    flag: 'agentbase-token-url',
    prompt: 'AgentBase token endpoint URL (OAuth2 client_credentials)',
    secret: false,
  },
  {
    env: 'AGENTBASE_CLIENT_ID',
    flag: 'agentbase-client-id',
    prompt: 'AgentBase Application client id',
    secret: false,
  },
  {
    env: 'AGENTBASE_CLIENT_SECRET',
    flag: 'agentbase-client-secret',
    prompt: 'AgentBase Application client secret',
    secret: true,
  },
  {
    env: 'AGENTBASE_LLM_MODEL',
    flag: 'agentbase-model',
    prompt: 'Model to use, as onboarded in your org (e.g. anthropic/claude-sonnet-5)',
    secret: false,
  },
];

const rawArgs = process.argv.slice(2);
const assumeYes = rawArgs.includes('--yes') || rawArgs.includes('-y');
const skipDeps = rawArgs.includes('--skip-deps');
const nameArg = rawArgs.find((a) => !a.startsWith('-'));

function flagVal(name) {
  const pref = `--${name}=`;
  const hit = rawArgs.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}

function validatePort(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return { err: `Ports must be an integer 1–65535 (got "${v}").` };
  }
  if (RESERVED_PORTS[n]) return { err: `Port ${n} is used by ${RESERVED_PORTS[n]}. Pick another.` };
  return { port: n };
}

function run(cmd, args, { allowFail = false } = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd: rootDir, stdio: 'inherit', shell: false });
  if (res.status !== 0 && !allowFail) {
    console.error(
      `\n❌ \`${cmd} ${args.join(' ')}\` failed (exit ${res.status}). Bootstrap aborted.`,
    );
    process.exit(res.status ?? 1);
  }
  return res.status ?? 0;
}

function validateName(name) {
  if (!name) return 'A project name is required.';
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return `Invalid name "${name}". Use lowercase letters, digits, and hyphens (start with a letter).`;
  }
  if (name === 'precast') return 'Pick a name other than "precast".';
  return null;
}

async function resolveName() {
  if (nameArg) {
    const err = validateName(nameArg);
    if (err) {
      console.error(`❌ ${err}`);
      process.exit(1);
    }
    return nameArg;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      const answer = (await rl.question('Project name (lowercase, hyphens): ')).trim();
      const err = validateName(answer);
      if (!err) return answer;
      console.error(`  ${err}`);
    }
  } finally {
    rl.close();
  }
}

/**
 * Decide the stack's three ports.
 *
 * Default: a random FREE CONSECUTIVE triple in PORT_RANGE (agents / web /
 * keycloak). Two Precast projects on one machine used to collide on 3000/4111
 * every time; a per-project block in the high private range just works, and
 * being consecutive keeps it memorable.
 *
 * Overrides: `--mastra-port` / `--web-port` / `--keycloak-port` pin individual
 * ports (anything unpinned still comes from the auto block); `--ports=keep`
 * keeps whatever the repo currently ships with. Interactive runs are shown the
 * auto-picked block and can accept it with Enter.
 */
async function resolvePorts() {
  const pinned = {};
  for (const [flag, label, key] of [
    ['mastra-port', 'Mastra', 'mastra'],
    ['web-port', 'Web', 'web'],
    ['keycloak-port', 'Keycloak', 'keycloak'],
  ]) {
    const fv = flagVal(flag);
    if (fv === undefined) continue;
    const r = validatePort(fv);
    if (r.err) {
      console.error(`❌ ${label} port: ${r.err}`);
      process.exit(1);
    }
    pinned[key] = r.port;
  }

  if (flagVal('ports') === 'keep') return { keep: true, ...pinned };

  const [mastra, web, keycloak] = await pickConsecutivePorts();
  const auto = { mastra, web, keycloak, ...pinned };

  // Non-interactive (name given as an arg): take the block as-is.
  if (nameArg) return auto;

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      console.log(
        `\nPorts — auto-picked a free consecutive block in ${PORT_RANGE.min}–${PORT_RANGE.max}:`,
      );
      console.log(`  agents ${auto.mastra} · web ${auto.web} · keycloak ${auto.keycloak}`);
      const answer = (
        await rl.question('Enter to accept, or type a base port for the block: ')
      ).trim();
      if (!answer) return auto;
      const r = validatePort(answer);
      if (r.err) {
        console.error(`  ${r.err}`);
        continue;
      }
      return { mastra: r.port, web: r.port + 1, keycloak: r.port + 2, ...pinned };
    }
  } finally {
    rl.close();
  }
}

/**
 * Ask which LLM provider this project will use. Never collects the actual key
 * value — only which one, so the final "Next steps" can name one exact env
 * var instead of a vague "edit .env.example". Non-interactive mode requires
 * an explicit `--llm-provider=` flag (unlike ports, which fall back to a
 * default silently) — an unconfigured provider is exactly the gap this
 * question exists to close, so we don't want a scripted call skipping it
 * without at least an explicit `skip`.
 */
/**
 * Which APC Design System theme the web app ships with. Asked here rather than
 * left to chance because it is the one choice that makes every Precast-derived
 * product look like it belongs to the same family — and because retro-fitting a
 * look after the UI is built is far more work than picking one now.
 */
/**
 * Collect the account-level AgentBase gateway settings.
 *
 * This is the ONE place bootstrap accepts secret values. Every other provider
 * is recorded by name only, and the closing reminder tells you which key to set
 * yourself — because a vendor key is a single value that is easy to paste into
 * `.env`. The AgentBase option is five interdependent values, and a project
 * that gets four of them right fails at the first chat with an auth error that
 * points nowhere. Asking here, together, is what makes the option usable.
 *
 * The values are written to `.env` only — which is git-ignored and excluded
 * from the Docker build context. `.env.example`, which IS committed, keeps the
 * empty placeholders.
 */
async function resolveAgentBaseLlm(rl) {
  const values = {};

  // Flags first, so CI / non-interactive runs work without a TTY.
  for (const field of AGENTBASE_LLM_FIELDS) {
    const fromFlag = flagVal(field.flag);
    if (fromFlag) values[field.env] = fromFlag;
  }

  const missing = AGENTBASE_LLM_FIELDS.filter((f) => !values[f.env]);
  if (missing.length === 0) return values;

  if (!rl) {
    console.error(
      `\n❌ --llm-provider=agentbase needs ${missing.map((f) => `--${f.flag}=`).join(' ')}` +
        ' when running non-interactively.',
    );
    process.exit(1);
  }

  console.log('\nAgentBase Models — create an Application in Studio, subscribe it to the');
  console.log('model listing, then paste its details here. Stored in .env (git-ignored).');
  for (const field of missing) {
    for (;;) {
      const answer = (await rl.question(`  ${field.prompt}: `)).trim();
      if (answer) {
        values[field.env] = answer;
        break;
      }
      console.error('    Required — all five are needed for the gateway to answer.');
    }
  }
  return values;
}

async function resolveApcTheme() {
  const fv = flagVal('theme');
  if (fv) {
    const normalized = fv.toLowerCase();
    if (!THEME_IDS.includes(normalized)) {
      console.error(`❌ --theme must be one of: ${THEME_IDS.join(', ')} (got "${fv}").`);
      process.exit(1);
    }
    return normalized;
  }
  // Non-interactive (name passed as an arg): keep the shipped default rather
  // than blocking on a prompt nobody is there to answer.
  if (nameArg) return DEFAULT_THEME;

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    console.log('\nWhich APC Design System theme should the web app use?');
    console.log('Preview all five: https://apc-design-system.917v.dev');
    APC_THEMES.forEach((t, i) =>
      console.log(`  ${i + 1}. ${t.label}${t.id === DEFAULT_THEME ? ' (default)' : ''}`),
    );
    for (;;) {
      const answer = (
        await rl.question(`Choice [1-${APC_THEMES.length}, or a theme name]: `)
      ).trim();
      if (!answer) return DEFAULT_THEME;
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= APC_THEMES.length) return APC_THEMES[n - 1].id;
      const normalized = answer.toLowerCase();
      if (THEME_IDS.includes(normalized)) return normalized;
      console.error(`  Enter 1-${APC_THEMES.length}, or a theme name (e.g. arctic).`);
    }
  } finally {
    rl.close();
  }
}

async function resolveLlmProvider() {
  const fv = flagVal('llm-provider');
  if (nameArg) {
    if (!fv) return null; // no flag given — proceed, but the closing reminder still warns loudly
    const normalized = fv.toLowerCase();
    if (normalized === 'skip') return null;
    const match = LLM_PROVIDERS.find((p) => p.key === normalized);
    if (!match) {
      console.error(
        `❌ --llm-provider must be one of: ${LLM_PROVIDERS.map((p) => p.key).join(', ')}, skip (got "${fv}").`,
      );
      process.exit(1);
    }
    return match;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const skipChoice = LLM_PROVIDERS.length + 1;
    console.log('\nWhich LLM provider will this project use?');
    LLM_PROVIDERS.forEach((p, i) => console.log(`  ${i + 1}. ${p.label} (${p.envVar})`));
    console.log(`  ${skipChoice}. Skip for now (you'll set it up later)`);
    for (;;) {
      const answer = (await rl.question(`Choice [1-${skipChoice}, or a provider name]: `)).trim();
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= LLM_PROVIDERS.length) return LLM_PROVIDERS[n - 1];
      if (n === skipChoice) return null;
      // Also accept the provider key by name — with this many options, typing
      // "openrouter" is friendlier than counting rows.
      const normalized = answer.toLowerCase();
      if (normalized === 'skip') return null;
      const byName = LLM_PROVIDERS.find((p) => p.key === normalized);
      if (byName) return byName;
      console.error(`  Enter a number 1-${skipChoice}, or a provider name (e.g. anthropic).`);
    }
  } finally {
    rl.close();
  }
}

async function confirm(question) {
  if (assumeYes) return true;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function main() {
  console.log('── Precast bootstrap ────────────────────────────────────────────\n');

  const name = await resolveName();
  const ports = await resolvePorts();
  if (!ports.keep && new Set([ports.mastra, ports.web, ports.keycloak]).size !== 3) {
    console.error(
      `❌ Mastra, web, and Keycloak ports must all differ ` +
        `(got ${ports.mastra}, ${ports.web}, ${ports.keycloak}).`,
    );
    process.exit(1);
  }
  const llmProvider = await resolveLlmProvider();
  // Only the AgentBase option needs values rather than a name.
  let agentBaseLlm = null;
  if (llmProvider?.key === 'agentbase') {
    const rl = nameArg ? null : createInterface({ input: stdin, output: stdout });
    try {
      agentBaseLlm = await resolveAgentBaseLlm(rl);
    } finally {
      rl?.close();
    }
  }
  const apcTheme = await resolveApcTheme();
  const manifest = readManifest(rootDir);

  console.log(`\nThis will:`);
  console.log(`  1. Rename the "precast" placeholder → "${name}"`);
  console.log(
    ports.keep
      ? '  2. Keep the current ports'
      : `  2. Set ports — agents ${ports.mastra}, web ${ports.web}, keycloak ${ports.keycloak}`,
  );
  console.log(
    `  3. Install${skipDeps ? '' : ' + update'} dependencies${skipDeps ? '' : ' to latest compatible'}`,
  );
  console.log(
    `  4. Apply the ${APC_THEMES.find((t) => t.id === apcTheme).label} APC theme + reset progress docs to a clean slate`,
  );
  console.log(
    `  5. Record which Precast this came from in precast.lock.json (so \`pnpm precast:update\` works later)`,
  );
  console.log(`  6. DELETE Precast's git history and start a blank repo on "${DEFAULT_BRANCH}"`);
  console.log(
    `  7. Create .env from .env.example${llmProvider ? ` (reminding you to set ${llmProvider.envVar})` : ' (no LLM provider chosen yet — you will be reminded)'}`,
  );

  if (!(await confirm('\nProceed?'))) {
    console.log('Aborted — nothing changed.');
    process.exit(0);
  }

  // 1. Rename placeholder.
  run('node', ['scripts/rename-project.mjs', name]);

  // 2. Wire chosen ports through env, configs, pnpm scripts, Docker, docs.
  if (!ports.keep) {
    run('node', [
      'scripts/set-ports.mjs',
      `--mastra=${ports.mastra}`,
      `--web=${ports.web}`,
      `--keycloak=${ports.keycloak}`,
    ]);
  }

  // 3. Dependencies.
  if (skipDeps) {
    run('pnpm', ['install']);
  } else {
    run('node', ['scripts/update-deps.mjs', '--no-verify']);
  }

  // 4. Apply the chosen APC theme, then reset progress memory so the new
  // project starts with a clean slate.
  setTheme(apcTheme);
  resetDocs();

  // 5. Record provenance. MUST run before resetGit — the upstream commit is only
  // readable while Precast's own .git is still here, and the hashes must be taken
  // after the rename so they describe this project's files, not the placeholder's.
  const lock = stampLock(rootDir, { projectName: name, commit: upstreamCommit(), manifest });

  // 6. Reset git history → blank repo on develop.
  resetGit(name);

  // 7. Create .env from .env.example so there's a real file to edit, not just
  // an instruction to copy one — this is the gap that let an unconfigured LLM
  // provider go unnoticed until a chat actually failed.
  const envCreated = copyEnvFile();
  if (envCreated) writeEnvValues(generateLocalSecrets());
  if (agentBaseLlm) writeEnvValues(agentBaseLlm);

  console.log(`\n✅ ${name} is ready.`);
  if (lock) {
    console.log(
      `   Derived from Precast ${lock.precastVersion}` +
        (lock.precastCommit ? ` (${lock.precastCommit.slice(0, 7)})` : '') +
        ` — ${Object.keys(lock.files).length} files tracked for upgrades.`,
    );
  }
  console.log('\nNext steps:');
  console.log('  • Set your project name + mission in docs/PROGRESS.md §1 and the README title.');
  if (!envCreated && !existsSync(join(rootDir, '.env'))) {
    console.log('  • Copy env:            cp .env.example .env');
  }
  // PoC first: the fastest route to something the user can look at and react to
  // (CLAUDE.md §4.9). Full `pnpm test` belongs to the hardening pass, after the
  // PoC has been reviewed — a green test run on the wrong product is wasted time.
  console.log('  • See it run:          pnpm poc            (builds + starts the Docker stack)');
  console.log('  • Fast check:          pnpm verify:poc     (typecheck only — PoC bar)');
  console.log('  • Full verify later:   pnpm build && pnpm test && pnpm test:e2e');
  console.log(
    '  • Add your remote:     git remote add origin <url> && git push -u origin ' + DEFAULT_BRANCH,
  );
  console.log('  • Later, pull Precast improvements in:  pnpm precast:update');

  printDockerPrerequisite();

  console.log('');
  if (llmProvider?.key === 'agentbase') {
    console.log('✅ AgentBase Models configured — no vendor key needed; the org key stays');
    console.log('   server-side. Verify with `pnpm poc` and one chat message.');
  } else if (llmProvider) {
    console.log(
      `⚠️  ACTION REQUIRED — set ${llmProvider.envVar} in .env before the agents will respond.`,
    );
  } else {
    console.log(
      '⚠️  ACTION REQUIRED — no LLM provider configured yet. Before the agents will respond,',
    );
    console.log(
      '   open .env and set ONE of: ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY',
    );
    console.log('   (or DEFAULT_LLM_MODEL for a specific "<provider>/<model>" string).');
  }

  printFeedForwardGuidance();
}

/**
 * `pnpm poc` runs the stack in Docker Compose, so a first-time user needs a
 * container runtime before anything is visible. Say so HERE — at the end of
 * bootstrap, while they're still at the keyboard — rather than letting it
 * surface later as a daemon-socket error.
 */
function printDockerPrerequisite() {
  const state = dockerStatus();
  if (state === 'running') return;
  console.log('');
  if (state === 'missing') {
    console.log('🐳 PREREQUISITE — Docker is not installed, and `pnpm poc` needs it.');
    console.log('   Install Docker Desktop:  https://www.docker.com/products/docker-desktop/');
  } else {
    console.log('🐳 PREREQUISITE — Docker is installed but the engine is not running.');
    console.log('   Start Docker Desktop, then continue.');
  }
  console.log('   Then run:  pnpm docker:wait   (waits for the engine, exits as soon as it is up)');
  console.log('   Details:   pnpm docker:check');
}

/**
 * Create `.env` from `.env.example` if one doesn't already exist. Never
 * overwrites an existing `.env` (e.g. a re-run, or one already hand-created).
 * Returns whether it actually created the file.
 */
function copyEnvFile() {
  const envPath = join(rootDir, '.env');
  const examplePath = join(rootDir, '.env.example');
  if (existsSync(envPath) || !existsSync(examplePath)) return false;
  writeFileSync(envPath, readFileSync(examplePath, 'utf-8'), 'utf-8');
  console.log('\nCreated .env from .env.example.');
  return true;
}

/**
 * Feed-forward docs are the highest-leverage thing to write before building:
 * they give every agent the same intent up front. Point the user at the
 * templates so they fill them in first.
 */
/**
 * Secrets that have no reason to be blank, minted locally at scaffold time.
 *
 * `AGENT_API_TOKEN` was the gap this closes. `.env.example` ships it empty,
 * which is correct for a committed file — but the runtime images bake
 * `NODE_ENV=production`, and an empty token there means the agent API is open,
 * so the boot guard refuses to start. The result was that `pnpm poc` — the
 * FIRST thing anyone runs on a new project — failed on a fresh scaffold.
 *
 * Generated unconditionally rather than gated on deployment mode. There is no
 * mode where a local token does harm: on an AgentBase-hosted import the
 * platform mints its own inbound bearer and injects it, overriding whatever
 * `.env` holds (docs/INTEGRATION_AGENTBASE.md §7), and Standalone/External is
 * exactly the case that needs one. Gating would mean teaching bootstrap a
 * deployment-mode concept it does not have, for no gain.
 *
 * 32 bytes of CSPRNG, hex-encoded: no shell-quoting or dotenv-parsing hazards,
 * and long enough that the value is not the weak link.
 */
function generateLocalSecrets() {
  return { AGENT_API_TOKEN: randomBytes(32).toString('hex') };
}

/**
 * Set keys in the real `.env`, replacing the empty placeholders `.env.example`
 * ships. Never touches `.env.example` — that file is committed, and a secret
 * landing there would reach every clone.
 *
 * Values are written raw and alone on the line: an inline comment after the
 * value would become PART of it under Docker Compose's env_file parser, which
 * is exactly how a placeholder once shipped as a live "API key" (APP-019).
 */
function writeEnvValues(values) {
  const envPath = join(rootDir, '.env');
  if (!existsSync(envPath)) return;
  let text = readFileSync(envPath, 'utf-8');

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
  }

  writeFileSync(envPath, text, 'utf-8');
  console.log(`\nWrote ${Object.keys(values).length} AgentBase gateway settings into .env.`);
}

function printFeedForwardGuidance() {
  console.log('\n📄 Write your feed-forward docs first (templates in templates/):');
  console.log('   These give any coding agent shared intent before a line of code is written.');
  console.log('     • templates/PRD.md           — problem, goals, personas, scope, metrics');
  console.log('     • templates/DATA_MODEL.md     — entities, relationships, invariants');
  console.log('     • templates/AGENT_SPEC.md     — Mastra agents: job, tools, guardrails');
  console.log(
    '     • templates/DESIGN_SYSTEM.md  — UI design language + tokens (Material 3 Expressive example)',
  );
  console.log('   Copy the ones you need into docs/, replace the example content, then build.');
  console.log('   The example content walks a chat-based meeting-room reservation app end to end.');
}

/**
 * Wipe any accumulated progress memory so the new project starts clean:
 * drop the auto-journal file and strip stray <auto-journal> markers from
 * PROGRESS.md's Session Log. PROGRESS.md/HANDOFF.md ship as empty templates,
 * so no full rewrite is needed here.
 */
function resetDocs() {
  const journal = join(rootDir, 'docs', '.progress-journal.jsonl');
  if (existsSync(journal)) rmSync(journal, { force: true });

  const progress = join(rootDir, 'docs', 'PROGRESS.md');
  if (existsSync(progress)) {
    const cleaned = readFileSync(progress, 'utf-8')
      .split('\n')
      .filter((line) => !line.startsWith('<auto-journal:'))
      .join('\n');
    writeFileSync(progress, cleaned, 'utf-8');
  }
}

/**
 * The upstream commit this clone sits on, read while Precast's `.git` is still
 * present. Returns null for a tarball download or an already-detached copy —
 * the version in precast.manifest.json is still enough to upgrade from.
 */
function upstreamCommit() {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf-8' });
  return res.status === 0 ? res.stdout.trim() : null;
}

function resetGit(name) {
  const gitDir = join(rootDir, '.git');
  if (existsSync(gitDir)) {
    console.log('\nRemoving Precast git history…');
    rmSync(gitDir, { recursive: true, force: true });
  }
  run('git', ['init', '-b', DEFAULT_BRANCH]);
  run('git', ['config', 'core.hooksPath', '.githooks']);
  run('git', ['add', '-A']);
  // `git add -A` stages the required docs, so the doc-contract pre-commit hook
  // is satisfied on this first commit.
  run('git', ['commit', '-m', `chore: initialize ${name} from Precast`]);
}

main();
