import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Text-wrapping guards (WEB-009).
 *
 * Precast never leaves an orphaned final word. `globals.css` sets
 * `text-wrap: pretty` on `body` (inherited) and `text-wrap: balance` on
 * headings. Three ways that regresses silently, all pinned here:
 *
 *  1. **`normal` is not a valid `text-wrap` value.** The values are
 *     `wrap | nowrap | balance | pretty | stable`. A declaration of
 *     `text-wrap: normal` is dropped by the parser, so it looks like an opt-out
 *     in the source while the inherited value quietly stays in force. This cost
 *     real debugging time — the guard exists so it costs none next time.
 *  2. **Enumerating tags misses the actual text.** Astryx renders prose inside
 *     `<span>`, not `<p>`, so `p, li, …` covers almost none of a real Precast
 *     UI. Setting it on `body` and letting it inherit is what makes it work.
 *  3. **Layer order.** The rules live in `@layer components`, which must come
 *     after Astryx's layers or Astryx's own typography wins.
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const css = readFileSync(join(REPO_ROOT, 'apps/web/app/globals.css'), 'utf8');

/** Values the `text-wrap` shorthand actually accepts. */
const VALID = ['wrap', 'nowrap', 'balance', 'pretty', 'stable'];

describe('text-wrap declarations', () => {
  it('only ever uses values the property accepts', () => {
    const used = [...css.matchAll(/^\s*text-wrap:\s*([a-z-]+)\s*;/gm)].map((m) => m[1]);
    expect(used.length, 'globals.css should declare text-wrap at least twice').toBeGreaterThan(1);
    const invalid = used.filter((v) => !VALID.includes(v));
    expect(
      invalid,
      `invalid text-wrap value(s): ${invalid.join(', ')}. "normal" in particular is silently ` +
        `dropped — the opt-out value is "wrap". Valid: ${VALID.join(' | ')}.`,
    ).toEqual([]);
  });

  it('sets `pretty` on body so it inherits to component-rendered prose', () => {
    // Keyed on body, NOT a tag list — Astryx renders body copy in <span>.
    expect(
      css,
      'text-wrap: pretty must be set on body so it inherits into Astryx components',
    ).toMatch(/:where\(body\)\s*\{\s*text-wrap:\s*pretty;/);
  });

  it('balances headings, which are short enough for the browser line cap', () => {
    const block = css.match(/:where\(([^)]*h1[^)]*)\)\s*\{\s*text-wrap:\s*balance;/);
    expect(block, 'headings must declare text-wrap: balance').not.toBeNull();
    for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      expect(block![1], `${tag} should be balanced`).toContain(tag);
    }
  });

  it('declares the components layer after Astryx’s, so these rules win', () => {
    const order = css.match(/@layer\s+([^;]+);/)?.[1].split(',').map((s) => s.trim()) ?? [];
    expect(order).toContain('components');
    expect(
      order.indexOf('components'),
      'components must be ordered after astryx-base/astryx-theme',
    ).toBeGreaterThan(order.indexOf('astryx-theme'));
  });
});
