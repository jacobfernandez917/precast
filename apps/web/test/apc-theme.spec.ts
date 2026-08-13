import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APC_THEMES, buildCss } from '../../../scripts/build-apc-theme.mjs';
import { APC_THEME, APC_THEMES as THEME_IDS } from '../app/theme/apc-theme';

/**
 * APC Design System theme guards (APC-001 … APC-004).
 *
 * The five APC themes are layered on top of Astryx as token overrides. Two
 * things went wrong while building that, and both were invisible until rendered
 * — which is exactly why they are pinned here:
 *
 *  1. **The override has to reach the content.** Astryx's <Theme> provider
 *     renders a NESTED `data-astryx-theme` element that re-declares every token.
 *     Layer order only settles conflicts on the same element, so a rule matching
 *     only <html> lost by inheritance proximity and every APC colour was
 *     silently ignored below the provider.
 *  2. **`--color-accent` flips between modes.** APC's `action.primary` is a dark
 *     brand colour in light mode and a bright accent in dark mode, so the
 *     readable foreground flips too. Using one role for both modes rendered
 *     white text on a lime button — 1.3:1, unreadable.
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const css = readFileSync(join(REPO_ROOT, 'apps/web/app/theme/apc-themes.css'), 'utf8');
const tokens = JSON.parse(
  readFileSync(join(REPO_ROOT, 'apps/web/app/theme/apc.tokens.json'), 'utf8'),
);

/** The declaration block for one theme. */
function blockFor(id: string): string {
  const hit = css.match(new RegExp(`\\[data-apc-theme='${id}'\\][^{]*\\{([^}]*)\\}`));
  expect(hit, `apc-themes.css must define a block for "${id}"`).not.toBeNull();
  return hit![1];
}

function declaration(id: string, prop: string): string | null {
  return (
    blockFor(id)
      .match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1]
      .trim() ?? null
  );
}

/** Split `light-dark(a, b)` into its branches; a plain value is used for both. */
function branches(value: string): { light: string; dark: string } {
  const hit = value.match(/^light-dark\(\s*([^,]+),\s*(.+)\)$/);
  return hit
    ? { light: hit[1].trim(), dark: hit[2].trim() }
    : { light: value.trim(), dark: value.trim() };
}

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(full.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

describe('APC token source', () => {
  it('declares exactly the five shipped themes', () => {
    const collections = Object.keys(tokens).filter(
      (k) => !k.startsWith('$') && !['core', 'semantic', 'typography', 'effect'].includes(k),
    );
    expect(collections.sort()).toEqual([...THEME_IDS].sort());
  });

  it('keeps the generator, the constant, and the token file agreeing on theme ids', () => {
    expect(APC_THEMES.map((t) => t.id).sort()).toEqual([...THEME_IDS].sort());
  });

  it('is the source the committed CSS was generated from', () => {
    // Catches an edited apc-themes.css or an un-regenerated token change.
    expect(buildCss(tokens)).toBe(css);
  });
});

describe('generated theme CSS', () => {
  it.each(THEME_IDS)('%s defines the core surface and accent roles', (id) => {
    for (const prop of [
      '--color-text-primary',
      '--color-background-body',
      '--color-background-card',
      '--color-accent',
      '--color-on-accent',
      '--color-border',
    ]) {
      expect(declaration(id, prop), `${id} must set ${prop}`).not.toBeNull();
    }
  });

  it.each(THEME_IDS)('%s also targets Astryx’s nested provider element', (id) => {
    // Regression guard for failure (1) above. Without the descendant selector
    // the tokens stop at <html> and never reach rendered content.
    expect(
      css,
      `"[data-apc-theme='${id}'] [data-astryx-theme]" must be in the selector list, or ` +
        'Astryx’s <Theme> provider overrides every APC colour below it.',
    ).toContain(`[data-apc-theme='${id}'] [data-astryx-theme]`);
  });
});

describe('accent contrast (WCAG AA)', () => {
  // Regression guard for failure (2) above.
  it.each(THEME_IDS)('%s keeps text on the primary action readable in both modes', (id) => {
    const accent = branches(declaration(id, '--color-accent')!);
    const onAccent = branches(declaration(id, '--color-on-accent')!);

    for (const mode of ['light', 'dark'] as const) {
      const ratio = contrast(accent[mode], onAccent[mode]);
      expect(
        ratio,
        `${id} ${mode}: ${onAccent[mode]} on ${accent[mode]} is ${ratio.toFixed(2)}:1 — ` +
          'WCAG AA needs 4.5:1 for body text on a filled button.',
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEME_IDS)('%s keeps body text readable on the page background', (id) => {
    const bg = branches(declaration(id, '--color-background-body')!);
    const fg = branches(declaration(id, '--color-text-primary')!);

    for (const mode of ['light', 'dark'] as const) {
      const ratio = contrast(bg[mode], fg[mode]);
      expect(
        ratio,
        `${id} ${mode}: text ${fg[mode]} on page ${bg[mode]} is ${ratio.toFixed(2)}:1.`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('selected theme', () => {
  it('is one of the five', () => {
    expect(THEME_IDS).toContain(APC_THEME);
  });
});
