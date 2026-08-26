import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Repo-hygiene fitness guards — SMOKE-001…015 and DOC-001…007.
 *
 * These were specified in TEST_CASES.md from the beginning and never implemented:
 * 22 rows sitting at `Not Started`, more than a quarter of the catalogue, in a
 * document that otherwise reads as a record of what is covered.
 *
 * What they protect is the part of the boilerplate no unit test touches — that
 * the config files parse, the hooks are executable, the docs still have the
 * sections the contract references, and `.env.example` carries no real
 * credential. Every one of these fails silently: a project scaffolded from a
 * repo with a malformed `turbo.json` or a half-gutted PROGRESS.md looks fine
 * until someone tries to use it.
 *
 * Two of the original specifications could not be implemented as written, and
 * are noted where they occur rather than quietly dropped (SMOKE-013, DOC-006).
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');
const exists = (rel: string) => existsSync(join(REPO_ROOT, rel));

// ── SMOKE-001 ───────────────────────────────────────────────────────────────
describe('SMOKE-001 — required files exist', () => {
  const REQUIRED = [
    'CLAUDE.md',
    'README.md',
    'package.json',
    'pnpm-workspace.yaml',
    'turbo.json',
    'tsconfig.base.json',
    'eslint.config.js',
    '.env.example',
    '.gitignore',
    '.nvmrc',
    '.githooks/pre-commit',
    'docs/HANDOFF.md',
    'docs/PROGRESS.md',
    'docs/SPEC.md',
    'docs/TECH_STACK.md',
    'docs/ADRS.md',
    'docs/STYLE_GUIDE.md',
    'docs/TEST_CASES.md',
    'docs/SCRIPTS.md',
    'docs/MIGRATIONS.md',
  ];
  it.each(REQUIRED)('%s is present', (rel) => {
    expect(exists(rel), `${rel} is referenced by the doc contract but missing`).toBe(true);
  });
});

// ── SMOKE-002 / 015 ─────────────────────────────────────────────────────────
describe('SMOKE-002 — root package.json is coherent', () => {
  const pkg = JSON.parse(read('package.json'));

  it('parses and declares the pinned package manager', () => {
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });

  it('pins the Node engine, so a wrong runtime fails at install not at runtime', () => {
    // .nvmrc is advisory — nothing reads it during `pnpm install`. Without an
    // engines field, Node 20 installs happily and fails later, confusingly.
    expect(pkg.engines?.node, 'package.json needs an engines.node range').toBeTruthy();
    const nvmrc = read('.nvmrc').trim();
    expect(
      pkg.engines.node.includes(nvmrc),
      `engines.node (${pkg.engines.node}) must agree with .nvmrc (${nvmrc})`,
    ).toBe(true);
  });

  it('every script has a non-empty command', () => {
    for (const [name, cmd] of Object.entries(pkg.scripts as Record<string, string>)) {
      expect(typeof cmd === 'string' && cmd.trim().length > 0, `script "${name}" is empty`).toBe(
        true,
      );
    }
  });
});

describe('SMOKE-015 — every workspace package.json is valid', () => {
  const dirs = ['apps/agents', 'apps/web', 'packages/shared'];
  it.each(dirs)('%s/package.json parses and is named', (dir) => {
    const pkg = JSON.parse(read(join(dir, 'package.json')));
    expect(pkg.name, `${dir} needs a name`).toBeTruthy();
    expect(pkg.name).toMatch(/^@precast\//);
  });
});

// ── SMOKE-003 / 004 / 007 / 010 ─────────────────────────────────────────────
describe('SMOKE-003/004/007/010 — JSON configs parse', () => {
  // turbo.json and tsconfig.base.json allow comments (JSONC), so strip them
  // before parsing rather than reporting a false failure.
  const stripJsonc = (t: string) =>
    t.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const FILES = ['tsconfig.base.json', 'turbo.json', '.prettierrc', '.claude/settings.json'];
  it.each(FILES)('%s is valid JSON', (rel) => {
    if (rel === '.claude/settings.json' && !exists(rel)) return; // optional, local-only
    expect(() => JSON.parse(stripJsonc(read(rel))), `${rel} does not parse`).not.toThrow();
  });
});

// ── SMOKE-005 ───────────────────────────────────────────────────────────────
describe('SMOKE-005 — pnpm-workspace.yaml', () => {
  it('declares the workspace globs the repo actually uses', () => {
    const text = read('pnpm-workspace.yaml');
    // Hand-parsed on purpose: adding a YAML dependency to assert one file's
    // shape would cost more than it protects.
    expect(text).toMatch(/^packages:/m);
    expect(text).toMatch(/['"]?apps\/\*/);
    expect(text).toMatch(/['"]?packages\/\*/);
    for (const line of text.split('\n')) {
      expect(line, 'tabs are invalid YAML indentation').not.toMatch(/^\t/);
    }
  });
});

// ── SMOKE-006 ───────────────────────────────────────────────────────────────
describe('SMOKE-006 — .editorconfig', () => {
  it('is a valid INI with a root declaration and a wildcard section', () => {
    const text = read('.editorconfig');
    expect(text).toMatch(/^root\s*=\s*true/m);
    expect(text).toMatch(/^\[\*\]/m);
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('[')) continue;
      expect(t, `"${t}" is neither a section, comment, nor key=value`).toMatch(/^[\w_]+\s*=/);
    }
  });
});

// ── SMOKE-008 ───────────────────────────────────────────────────────────────
describe('SMOKE-008 — .env.example carries no secrets', () => {
  const lines = read('.env.example')
    .split('\n')
    .map((l, i) => ({ n: i + 1, raw: l }))
    .filter((l) => l.raw.trim() && !l.raw.trim().startsWith('#') && l.raw.includes('='));

  // `admin`/`postgres`/`changeme` are documented local-dev defaults, not
  // credentials. A guard that cries wolf over them gets ignored, and then it
  // misses the real thing.
  const PLACEHOLDER =
    /^(|<.*>|your[-_].*|change[-_]?me|replace[-_]?me|example|todo|xxx+|admin|postgres|password|dev|local|test)$/i;

  it('every credential-shaped key is empty or an obvious placeholder', () => {
    const SENSITIVE = /(SECRET|TOKEN|PASSWORD|_KEY|APIKEY|CREDENTIAL)/i;
    for (const { n, raw } of lines) {
      const key = raw.slice(0, raw.indexOf('='));
      const value = raw.slice(raw.indexOf('=') + 1).trim();
      if (!SENSITIVE.test(key) || !value) continue;
      const looksPlaceholder =
        PLACEHOLDER.test(value) ||
        /example\.com|localhost|127\.0\.0\.1|\bREPLACE\b|\byour\b/i.test(value);
      expect(
        looksPlaceholder,
        `.env.example:${n} — ${key} has a non-placeholder value. This file is COMMITTED.`,
      ).toBe(true);
    }
  });

  it('no value carries a high-entropy token-shaped string', () => {
    // Catches a pasted real key even under a key name the pattern above misses.
    for (const { n, raw } of lines) {
      const value = raw.slice(raw.indexOf('=') + 1).trim();
      if (!value || /^https?:\/\//.test(value)) continue;
      const suspicious = /\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,})/;
      expect(suspicious.test(value), `.env.example:${n} looks like a real credential`).toBe(false);
    }
  });

  it('no assignment has a trailing inline comment', () => {
    // APP-019: `KEY=      # or OTHER_KEY — either works` shipped the COMMENT as
    // a 48-character value, which failed every LLM call with a ByteString error.
    // Comments belong above the assignment.
    for (const { n, raw } of lines) {
      const value = raw.slice(raw.indexOf('=') + 1);
      expect(value.includes('#'), `.env.example:${n} — move the comment above the assignment`).toBe(
        false,
      );
    }
  });
});

// ── SMOKE-009 ───────────────────────────────────────────────────────────────
describe('SMOKE-009 — git hooks', () => {
  it('.githooks/pre-commit is executable', () => {
    const mode = statSync(join(REPO_ROOT, '.githooks/pre-commit')).mode;
    expect(
      (mode & 0o111) !== 0,
      'pre-commit is not executable — the doc contract silently stops being enforced',
    ).toBe(true);
  });
});

// ── SMOKE-011 ───────────────────────────────────────────────────────────────
describe('SMOKE-011 — eslint config', () => {
  it('exports a flat config array covering the framework scripts', () => {
    const src = read('eslint.config.js');
    expect(src).toMatch(/export default/);
    // scripts/*.mjs live outside every workspace package, so `turbo run lint`
    // never reaches them; the root config is the only thing that does.
    expect(src).toContain('scripts/**/*.mjs');
  });
});

// ── SMOKE-012 ───────────────────────────────────────────────────────────────
describe('SMOKE-012 — internal doc links resolve', () => {
  it('every relative .md link points at a file that exists', () => {
    const roots = ['README.md', 'CLAUDE.md', ...readdirSync(join(REPO_ROOT, 'docs')).map((f) => join('docs', f))];
    const broken: string[] = [];
    for (const rel of roots.filter((r) => r.endsWith('.md'))) {
      const abs = join(REPO_ROOT, rel);
      if (!existsSync(abs)) continue;
      for (const m of read(rel).matchAll(/\]\(([^)#:]+\.md)(#[^)]*)?\)/g)) {
        if (!existsSync(resolve(dirname(abs), m[1]))) broken.push(`${rel} -> ${m[1]}`);
      }
    }
    expect(broken, `broken internal links:\n${broken.join('\n')}`).toEqual([]);
  });
});

// ── SMOKE-013 ───────────────────────────────────────────────────────────────
describe('SMOKE-013 — PROGRESS freshness marker', () => {
  /**
   * The original row specified "HANDOFF.md freshness gate (< 14 days)". That is
   * not implementable here as written: HANDOFF.md carries no date field, and in
   * PRECAST ITSELF both docs ship as pristine templates that are meant to stay
   * static — so a live 14-day gate would fail permanently in the repo it is
   * supposed to protect.
   *
   * What is implementable, and is what the gate was actually for: the marker
   * exists and parses. A derived project can turn the window on with
   * PRECAST_ENFORCE_DOC_FRESHNESS=1, which is where a stale handoff genuinely
   * signals lost context.
   */
  const stamp = /\*\*Last Updated:\*\*\s*(\d{4}-\d{2}-\d{2})/.exec(read('docs/PROGRESS.md'));

  it('PROGRESS.md carries a parseable Last Updated date', () => {
    expect(stamp, 'PROGRESS.md must carry `**Last Updated:** YYYY-MM-DD`').not.toBeNull();
    expect(Number.isNaN(Date.parse(stamp![1]))).toBe(false);
  });

  it.skipIf(process.env.PRECAST_ENFORCE_DOC_FRESHNESS !== '1')(
    'PROGRESS.md was updated within 14 days',
    () => {
      const age = (Date.now() - Date.parse(stamp![1])) / 86_400_000;
      expect(age, `PROGRESS.md is ${Math.round(age)} days old`).toBeLessThan(14);
    },
  );
});

// ── SMOKE-014 ───────────────────────────────────────────────────────────────
describe('SMOKE-014 — PROGRESS.md is structurally intact', () => {
  it('has no unfilled template markers left in it', () => {
    const text = read('docs/PROGRESS.md');
    for (const marker of ['<!-- TODO', 'LOREM IPSUM', 'FIXME:']) {
      expect(text.includes(marker), `PROGRESS.md still contains ${marker}`).toBe(false);
    }
  });
});

// ── DOC-001 ─────────────────────────────────────────────────────────────────
describe('DOC-001 — CLAUDE.md references the docs it depends on', () => {
  const claude = read('CLAUDE.md');
  const REFERENCED = [
    'docs/HANDOFF.md',
    'docs/SPEC.md',
    'docs/TECH_STACK.md',
    'docs/PROGRESS.md',
    'docs/ADRS.md',
    'docs/STYLE_GUIDE.md',
    'docs/TEST_CASES.md',
    'docs/SCRIPTS.md',
    'docs/MIGRATIONS.md',
  ];
  it.each(REFERENCED)('links %s', (doc) => {
    expect(claude).toContain(doc);
  });
});

// ── DOC-002 / 003 / 004 ─────────────────────────────────────────────────────
describe('DOC-002/003/004 — required doc sections are present', () => {
  const sections = (rel: string) =>
    [...read(rel).matchAll(/^##\s+(\d+)\./gm)].map((m) => Number(m[1]));

  it('HANDOFF.md has §1–§4 (the takeover contract)', () => {
    const s = sections('docs/HANDOFF.md');
    for (const n of [1, 2, 3, 4]) expect(s, `HANDOFF.md is missing §${n}`).toContain(n);
  });

  it('PROGRESS.md has §0–§10', () => {
    const s = sections('docs/PROGRESS.md');
    for (let n = 0; n <= 10; n++) expect(s, `PROGRESS.md is missing §${n}`).toContain(n);
  });

  it('TECH_STACK.md covers the facts other docs defer to it for', () => {
    const t = read('docs/TECH_STACK.md');
    for (const heading of ['Quick Reference', 'Port Assignments', 'Docker Compose Services']) {
      expect(t, `TECH_STACK.md is missing "${heading}"`).toContain(heading);
    }
  });
});

// ── DOC-005 ─────────────────────────────────────────────────────────────────
describe('DOC-005 — ADRs are well formed', () => {
  const adrs = [...read('docs/ADRS.md').matchAll(/^##\s+(ADR-\d{3}):\s*(.+)$/gm)];

  it('every ADR has an id and a title', () => {
    expect(adrs.length, 'no ADRs found — the heading format may have drifted').toBeGreaterThan(0);
    for (const [, id, title] of adrs) {
      expect(title.trim().length, `${id} has no title`).toBeGreaterThan(0);
    }
  });

  it('ADR ids are unique and sequential from 000', () => {
    const ids = adrs.map(([, id]) => Number(id.slice(4)));
    expect(new Set(ids).size, 'duplicate ADR ids').toBe(ids.length);
    expect([...ids].sort((a, b) => a - b)).toEqual(
      Array.from({ length: ids.length }, (_, i) => i),
    );
  });
});

// ── DOC-006 ─────────────────────────────────────────────────────────────────
describe('DOC-006 — STYLE_GUIDE covers the rules other docs enforce', () => {
  /**
   * The original row said "covers all required topics" without naming them. The
   * defensible reading is the topics CLAUDE.md's working rules actually point at
   * — validation, logging, testing, git — since those are the ones a reviewer
   * will be sent here to settle. Inventing a longer list would make this test
   * assert a contract nobody agreed to.
   */
  const guide = read('docs/STYLE_GUIDE.md');
  it.each(['TypeScript', 'Git', 'Validation', 'Logging', 'Error Handling', 'Testing'])(
    'covers %s',
    (topic) => {
      expect(guide).toContain(topic);
    },
  );
});

// ── DOC-007 ─────────────────────────────────────────────────────────────────
describe('DOC-007 — SCRIPTS.md documents every root script', () => {
  it('no script is undocumented', () => {
    const scripts = Object.keys(JSON.parse(read('package.json')).scripts);
    const doc = read('docs/SCRIPTS.md');
    // A plain includes() would let `verify` pass on the strength of
    // `verify:poc` being documented — a prefix must not satisfy the check.
    const documented = (name: string) =>
      new RegExp(`pnpm ${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(?![\\w:-])`).test(doc);
    const missing = scripts.filter((s) => !documented(s));
    expect(missing, `undocumented scripts: ${missing.join(', ')}`).toEqual([]);
  });
});


// ── SMOKE-017 ───────────────────────────────────────────────────────────────
describe('SMOKE-017 — a fresh scaffold can actually boot', () => {
  /**
   * The bug this exists to prevent, in full: `.env.example` ships
   * `AGENT_API_TOKEN=` (empty), the runtime images bake `NODE_ENV=production`,
   * and the boot guard refuses to start an unauthenticated agent API. So a
   * brand-new project failed on `pnpm poc` — the first command anyone runs.
   *
   * Nothing caught it because each piece was individually correct. The contract
   * only breaks when you look at all three together, which is what these
   * assertions do.
   */
  const bootstrap = read('scripts/bootstrap.mjs');
  const example = read('.env.example');

  it('bootstrap mints an AGENT_API_TOKEN', () => {
    expect(
      /AGENT_API_TOKEN:\s*randomBytes\(/.test(bootstrap),
      'bootstrap must generate AGENT_API_TOKEN — an empty one makes the production ' +
        'boot guard reject a fresh scaffold',
    ).toBe(true);
  });

  it('and actually CALLS the generator', () => {
    // Asserting the function exists is not enough: deleting only the call site
    // leaves the definition in place, the regex above still matches, and the
    // original bug returns with a green suite. Caught by mutation-testing this
    // very test.
    const defAt = bootstrap.indexOf('function generateLocalSecrets');
    const calls = [...bootstrap.matchAll(/generateLocalSecrets\(\)/g)].map((m) => m.index!);
    const invocations = calls.filter((i) => i < defAt || i > bootstrap.indexOf('}', defAt));
    expect(
      invocations.length,
      'generateLocalSecrets() is defined but never invoked — a fresh .env would ship an ' +
        'empty AGENT_API_TOKEN and the agents container would refuse to boot',
    ).toBeGreaterThan(0);
    expect(bootstrap).toMatch(/writeEnvValues\(generateLocalSecrets\(\)\)/);
  });

  it('generates it with a CSPRNG, not Math.random', () => {
    const fn = bootstrap.slice(
      bootstrap.indexOf('function generateLocalSecrets'),
      bootstrap.indexOf('function writeEnvValues'),
    );
    expect(fn).toContain('randomBytes');
    expect(fn, 'Math.random is not suitable for a credential').not.toContain('Math.random');
  });

  it('.env.example still ships it EMPTY — the committed file must carry no secret', () => {
    // The two halves are a pair: example stays blank, bootstrap fills it. If
    // someone "fixes" the boot failure by putting a value in .env.example
    // instead, every clone would share one token.
    const line = /^AGENT_API_TOKEN=(.*)$/m.exec(example);
    expect(line, '.env.example must declare AGENT_API_TOKEN').not.toBeNull();
    expect(line![1].trim(), '.env.example must not carry a real token').toBe('');
  });

  it('every placeholder host in .env.example is an obvious non-address', () => {
    // A placeholder that looks routable is worse than an empty value: code that
    // checks truthiness accepts it and fails later at the network. That is
    // exactly how AGENTBASE_URL slipped past discovery's `!base` check.
    const hosts = [...example.matchAll(/^([A-Z_]+)=(https?:\/\/[^\s]+)$/gm)];
    expect(hosts.length).toBeGreaterThan(0);
    for (const [, key, url] of hosts) {
      if (/localhost|127\.0\.0\.1/.test(url)) continue;
      expect(
        /example\.com|example\.org|your-|REPLACE/i.test(url),
        `${key}=${url} — a committed placeholder must be recognisably fake, so guards can ` +
          'detect it and users cannot mistake it for configuration',
      ).toBe(true);
    }
  });
});

// ── SMOKE-018 ───────────────────────────────────────────────────────────────
describe('SMOKE-018 — AGENTS.md stays true to the repo', () => {
  /**
   * Most non-Claude harnesses look for `AGENTS.md`; only Claude Code reads
   * `CLAUDE.md`. Without the former, a different agent starts with no
   * instructions at all — it would not know web→agents is A2A-only, that
   * Postgres is mandatory, or that a git hook enforces the doc contract.
   *
   * A pointer file rots quickly, so this asserts the CLAIMS rather than the
   * file's existence: every doc it cites must resolve, every command it names
   * must exist, and every invariant it states must still be stated in
   * CLAUDE.md. Rename a doc or drop a rule and this fails — which is the point.
   */
  const agents = read('AGENTS.md');
  const claude = read('CLAUDE.md');

  it('points at CLAUDE.md as the full contract', () => {
    expect(agents).toContain('CLAUDE.md');
  });

  it('every doc it links to exists', () => {
    const broken = [...agents.matchAll(/\]\(([^)#:]+\.md)\)/g)]
      .map((m) => m[1])
      .filter((rel) => !exists(rel));
    expect(broken, `AGENTS.md links to missing docs: ${broken.join(', ')}`).toEqual([]);
  });

  it('every pnpm command it names is a real script', () => {
    const scripts = Object.keys(JSON.parse(read('package.json')).scripts);
    const cited = [...new Set([...agents.matchAll(/`pnpm ([a-z:]+)`/g)].map((m) => m[1]))];
    expect(cited.length, 'AGENTS.md should name the commands an agent needs').toBeGreaterThan(3);
    const missing = cited.filter((c) => !scripts.includes(c));
    expect(missing, `AGENTS.md cites commands that do not exist: ${missing.join(', ')}`).toEqual([]);
  });

  it('every invariant it states is still stated in CLAUDE.md', () => {
    // The drift that matters: AGENTS.md keeps asserting a rule after CLAUDE.md
    // has changed or dropped it. Anchored on the distinctive phrase for each
    // rule rather than whole sentences, which would break on any rewording.
    const ANCHORS = [
      'a2a-only.spec.ts', // web→agents transport guard
      'SKIP_DOC_CHECK', // the doc-contract bypass
      'ADR-002', // Postgres-only
      'console.log', // the logging rule
      'pnpm poc', // the PoC-first workflow
    ];
    for (const anchor of ANCHORS) {
      if (!agents.includes(anchor)) continue; // AGENTS.md may legitimately drop one
      expect(
        claude.includes(anchor),
        `AGENTS.md states "${anchor}" but CLAUDE.md no longer mentions it — one of the two ` +
          'has moved on without the other',
      ).toBe(true);
    }
  });

  it('carries no port numbers, which `set-ports` would silently invalidate', () => {
    // set-ports.mjs rewrites CLAUDE.md, SPEC.md and INTEGRATION_AGENTBASE.md —
    // not this file. A port printed here would be wrong the moment a project is
    // scaffolded, and nothing would catch it.
    expect(
      /\b4[5-9]\d{3}\b/.test(agents),
      'AGENTS.md must not hardcode ports — set-ports.mjs does not rewrite it',
    ).toBe(false);
  });
});
