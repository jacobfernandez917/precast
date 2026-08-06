#!/usr/bin/env node
/**
 * build-apc-theme.mjs — Generate the APC Design System theme CSS for `apps/web`.
 *
 *   pnpm theme:build          # regenerate apps/web/app/theme/apc-themes.css
 *   pnpm theme:build --check  # fail if the committed CSS is stale (CI guard)
 *
 * ── What this does ────────────────────────────────────────────────────────────
 * Reads `apps/web/app/theme/apc.tokens.json` — the APC Design System's tokens in
 * W3C DTCG format, exported from the Claude Design project (see
 * docs/DESIGN_SYSTEM_APC.md) — and emits CSS custom properties for all five
 * themes: **Stockholm, Prague, Arctic, Nova, Melbourne**.
 *
 * ── Why it layers instead of replacing ────────────────────────────────────────
 * Astryx defines ~178 variables; APC's semantic set maps onto ~90 of them. Rather
 * than swap Astryx's theme out (and leave the unmapped variables undefined), this
 * emits an OVERRIDE layer: Astryx's own theme.css still supplies every value, and
 * `@layer apc-theme` — declared after `astryx-theme` in globals.css — wins for the
 * ones APC actually specifies. Anything APC doesn't define keeps a sane default
 * instead of collapsing to `unset`.
 *
 * ── Light and dark ────────────────────────────────────────────────────────────
 * APC ships light + dark per theme (10 modes). Astryx already opts into CSS
 * `color-scheme`, so each variable is emitted as `light-dark(<light>, <dark>)` —
 * the browser picks the branch, matching how Astryx's own themes behave and
 * keeping `<Theme mode="system">` working with no JS.
 *
 * ── Token shape ───────────────────────────────────────────────────────────────
 * Semantic tokens carry Stockholm-light in `$value` and the other nine modes in
 * `$extensions.apc` keyed by a two-letter theme prefix: `sl` Stockholm, `pr`
 * Prague, `ar` Arctic, `nv` Nova, `mb` Melbourne. Values may be literals or
 * `{dotted.path}` aliases into any collection.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = join(rootDir, 'apps/web/app/theme/apc.tokens.json');
const OUT = join(rootDir, 'apps/web/app/theme/apc-themes.css');

/** Theme id → the prefix used inside `$extensions.apc`. Order = display order. */
export const APC_THEMES = [
  { id: 'stockholm', label: 'Stockholm', prefix: 'sl' },
  { id: 'prague', label: 'Prague', prefix: 'pr' },
  { id: 'arctic', label: 'Arctic', prefix: 'ar' },
  { id: 'nova', label: 'Nova', prefix: 'nv' },
  { id: 'melbourne', label: 'Melbourne', prefix: 'mb' },
];

export const DEFAULT_THEME = 'stockholm';

/**
 * APC semantic role → Astryx custom property. Astryx is the consumer here, so
 * the mapping is written in its vocabulary. Roles APC has no opinion on are
 * simply absent and keep Astryx's own value.
 */
const MAP = {
  'text.primary': ['--color-text-primary'],
  'text.secondary': ['--color-text-secondary'],
  'text.muted': ['--color-text-gray'],
  'text.disabled': ['--color-text-disabled', '--color-icon-disabled'],
  // `text.on-brand` / `text.on-accent` are mode-dependent — see COMPOSITE below.
  'text.link': ['--color-text-accent'],
  'text.code': ['--color-syntax-variable'],

  'surface.page': ['--color-background-body'],
  'surface.raised': ['--color-background-card', '--color-background-popover'],
  'surface.sunken': ['--color-background-muted', '--color-background-surface'],
  'surface.hover': ['--color-overlay-hover', '--color-tint-hover'],
  'surface.selected': ['--color-overlay-pressed'],
  'surface.inverse': ['--color-overlay'],
  'surface.code': ['--color-syntax-background'],
  'surface.tooltip': ['--color-background-gray'],

  'border.default': ['--color-border'],
  'border.strong': ['--color-border-emphasized'],
  'border.divider': ['--color-border-gray'],
  // Astryx has one blue border token; the focus ring is the higher-value use.
  // `border.selected` is deliberately unmapped rather than fighting over it.
  'border.focus': ['--color-border-blue'],

  'action.primary': ['--color-accent'],
  'action.primary-hover': ['--color-accent-muted'],
  'action.secondary': ['--color-neutral'],
  'action.accent': ['--color-icon-accent'],
  // APC distinguishes a destructive ACTION colour from the error STATE colour;
  // Astryx has a single --color-error covering alerts, validation text and
  // danger buttons. `state.error` owns it as the broader use — see
  // docs/DESIGN_SYSTEM_APC.md "Known mapping gaps".

  'state.success': ['--color-success', '--color-icon-green'],
  'state.success-text': ['--color-text-green'],
  'state.success-surface': ['--color-success-muted', '--color-background-green'],
  'state.error': ['--color-error', '--color-icon-red'],
  'state.error-text': ['--color-text-red'],
  'state.error-surface': ['--color-error-muted', '--color-background-red'],
  'state.warning': ['--color-warning', '--color-icon-yellow'],
  'state.warning-text': ['--color-text-yellow'],
  'state.warning-surface': ['--color-warning-muted', '--color-background-yellow'],
  'state.info': ['--color-icon-blue'],
  'state.info-surface': ['--color-background-blue'],

  'code.plain': ['--color-syntax-punctuation'],
  'code.keyword': ['--color-syntax-keyword'],
  'code.function': ['--color-syntax-function'],
  'code.string': ['--color-syntax-string'],
  'code.number': ['--color-syntax-number'],
  'code.comment': ['--color-syntax-comment'],
  'code.punctuation': ['--color-syntax-operator'],
};

/**
 * Variables whose source role differs between light and dark.
 *
 * `action.primary` — which drives `--color-accent` — is a DARK brand colour in
 * light mode and a BRIGHT accent in dark mode (Stockholm: navy #103F58 → lime
 * #D4F553). So the readable foreground on it flips too: APC's `text.on-brand`
 * is always white, `text.on-accent` always near-black. Taking either one for
 * both modes puts white text on a lime button — about 1.3:1, unreadable.
 * `apps/web/test/apc-theme.spec.ts` holds the contrast line.
 */
const COMPOSITE = {
  '--color-on-accent': { light: 'text.on-brand', dark: 'text.on-accent' },
};

const ALIAS = /^\{([^}]+)\}$/;

function lookup(tokens, path) {
  return path.split('.').reduce((node, key) => (node == null ? node : node[key]), tokens);
}

/** Resolve `{a.b.c}` chains to a literal. Depth-capped so a token cycle can't hang the build. */
function resolve(tokens, value, depth = 0) {
  if (typeof value !== 'string' || depth > 10) return value;
  const hit = value.match(ALIAS);
  if (!hit) return value;
  const target = lookup(tokens, hit[1].trim());
  if (target == null) throw new Error(`Unresolved token alias: {${hit[1]}}`);
  return resolve(tokens, target.$value ?? target, depth + 1);
}

/** The literal colour a semantic role takes for one theme + mode. */
function valueFor(tokens, role, prefix, mode) {
  const node = lookup(tokens.semantic, role);
  if (!node) return null;
  // Stockholm-light is the base `$value`; every other mode is an extension.
  const raw =
    prefix === 'sl' && mode === 'light'
      ? node.$value
      : (node.$extensions?.apc?.[`${prefix}-${mode}`] ?? node.$value);
  return raw == null ? null : resolve(tokens, raw);
}

function fontStackFor(tokens, themeId) {
  const body = lookup(tokens.typography, `${themeId}.body`) ?? {};
  const heading = lookup(tokens.typography, `${themeId}.heading`) ?? {};
  const pick = (group) => {
    for (const key of Object.keys(group)) {
      const family = group[key]?.$value?.fontFamily;
      if (family) return family;
    }
    return null;
  };
  return { body: pick(body), heading: pick(heading) };
}

export function buildCss(tokens) {
  const out = [
    '/*',
    ' * @generated by `pnpm theme:build` — do not edit by hand.',
    ' * Source: apps/web/app/theme/apc.tokens.json (APC Design System, W3C DTCG).',
    ' * Reference: https://apc-design-system.917v.dev',
    ' *',
    ' * Overrides Astryx token values per APC theme. Selected with',
    ' * `data-apc-theme` on <html>; see apps/web/app/theme/apc-theme.ts.',
    ' * Declared in @layer apc-theme, which globals.css orders AFTER astryx-theme,',
    ' * so these win without depending on selector specificity.',
    ' */',
    '',
    '@layer apc-theme {',
  ];

  for (const { id, label, prefix } of APC_THEMES) {
    out.push(`  /* ── ${label} ─────────────────────────────────────────────── */`);
    // Two selectors on purpose. Astryx's <Theme> provider renders a NESTED
    // element carrying `data-astryx-theme`, and its @scope rule re-declares
    // every token there. Layer order only settles conflicts on the SAME
    // element, so matching <html> alone loses by inheritance proximity —
    // everything inside the provider would keep Astryx's values. Matching the
    // nested scope roots too puts APC and Astryx on the same element, where the
    // later layer wins.
    out.push(`  [data-apc-theme='${id}'],`);
    out.push(`  [data-apc-theme='${id}'] [data-astryx-theme] {`);

    // Collect before emitting: two roles claiming one Astryx variable would
    // otherwise resolve by source order, which is an arbitrary way to decide a
    // colour. Make it a build error so the mapping stays deliberate.
    const declared = new Map();
    for (const [role, targets] of Object.entries(MAP)) {
      const light = valueFor(tokens, role, prefix, 'light');
      const dark = valueFor(tokens, role, prefix, 'dark');
      if (light == null && dark == null) continue;
      const value =
        light === dark || dark == null ? light : `light-dark(${light}, ${dark ?? light})`;
      for (const target of targets) {
        const prior = declared.get(target);
        if (prior && prior.value !== value) {
          throw new Error(
            `MAP collision on ${target} (${id}): "${prior.role}" and "${role}" resolve to ` +
              `different colours. Pick one owner in MAP.`,
          );
        }
        declared.set(target, { role, value });
      }
    }
    for (const [target, roles] of Object.entries(COMPOSITE)) {
      const light = valueFor(tokens, roles.light, prefix, 'light');
      const dark = valueFor(tokens, roles.dark, prefix, 'dark');
      if (light == null && dark == null) continue;
      declared.set(target, {
        role: `${roles.light}/${roles.dark}`,
        value: light === dark ? light : `light-dark(${light}, ${dark})`,
      });
    }

    for (const [target, { value }] of declared) out.push(`    ${target}: ${value};`);

    const fonts = fontStackFor(tokens, id);
    if (fonts.body) out.push(`    --font-family-body: '${fonts.body}', system-ui, sans-serif;`);
    if (fonts.heading) {
      out.push(`    --font-family-heading: '${fonts.heading}', system-ui, sans-serif;`);
    }

    out.push('  }');
    out.push('');
  }

  out.push('}');
  return out.join('\n') + '\n';
}

function main() {
  if (!existsSync(TOKENS)) {
    console.error(`❌ Missing ${TOKENS}. Re-export it from the APC Claude Design project.`);
    process.exit(1);
  }
  const tokens = JSON.parse(readFileSync(TOKENS, 'utf-8'));
  const css = buildCss(tokens);
  const check = process.argv.slice(2).includes('--check');

  if (check) {
    const current = existsSync(OUT) ? readFileSync(OUT, 'utf-8') : '';
    if (current !== css) {
      console.error('❌ apc-themes.css is stale — run `pnpm theme:build` and commit the result.');
      process.exit(1);
    }
    console.log('✅ apc-themes.css is up to date.');
    return;
  }

  writeFileSync(OUT, css, 'utf-8');
  const vars = (css.match(/^\s+--/gm) ?? []).length;
  console.log(
    `✅ Wrote ${OUT.replace(rootDir + '/', '')} — ${APC_THEMES.length} themes, ${vars} declarations.`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
