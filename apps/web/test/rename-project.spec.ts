import { describe, expect, it } from 'vitest';
import { replaceToken } from '../../../scripts/rename-project.mjs';

/**
 * APP-017: `pnpm rename` (run by bootstrap) rewrites the placeholder in a project's runtime
 * identity and leaves the boilerplate's own names alone. A registry address published by
 * upstream, the `PRECAST_*` variables scripts read, the boilerplate's own files and the
 * internal `@precast/*` scope all survive it; every one of those once broke a scaffold.
 *
 * This file is itself a rename target, so the placeholder is assembled at runtime: written
 * out, it would be renamed too and every case would fail in a derived project (as they did
 * before this spec existed on its own).
 */
const P = ['pre', 'cast'].join('');
const PT = P[0]!.toUpperCase() + P.slice(1);
const PU = P.toUpperCase();
const REGISTRY = `ghcr.io/jacobfernandez917/${P}-deps`;

describe('rename safety', () => {
  it('leaves an upstream ghcr.io reference untouched', () => {
    const src = `FROM ${REGISTRY}:lock-deadbeef\nRUN echo ${P}`;
    const out = replaceToken(src, 'vectorizer');
    expect(out).toContain(`${REGISTRY}:lock-deadbeef`);
    expect(out).toContain('echo vectorizer');
  });

  it('leaves PRECAST_* environment names untouched, since scripts and hooks read them', () => {
    const src = `process.env.${PU}_MEMORY_DIR || process.env.${PU}_ENFORCE_DOC_FRESHNESS; const n = '${P}';`;
    expect(replaceToken(src, 'x-y')).toBe(
      `process.env.${PU}_MEMORY_DIR || process.env.${PU}_ENFORCE_DOC_FRESHNESS; const n = 'x-y';`,
    );
  });

  it("leaves the boilerplate's own file and script names untouched", () => {
    const src = [
      `import { stampLock } from '../../../scripts/${P}-lock.mjs';`,
      `import { plan } from '../../../scripts/${P}-update.mjs';`,
      `read('${P}.lock.json'); read('${P}.manifest.json'); run('pnpm ${P}:update');`,
      `const name = '${P}'; // still renamed`,
    ].join('\n');
    const out = replaceToken(src, 'x-y');
    expect(out).toContain(`scripts/${P}-lock.mjs'`);
    expect(out).toContain(`scripts/${P}-update.mjs'`);
    expect(out).toContain(`'${P}.lock.json'`);
    expect(out).toContain(`'${P}.manifest.json'`);
    expect(out).toContain(`pnpm ${P}:update`);
    expect(out).toContain("const name = 'x-y';");
  });

  it('still renames every case form outside a protected span', () => {
    expect(replaceToken(`${P} ${PT} ${PU}`, 'vectorizer')).toBe('vectorizer Vectorizer VECTORIZER');
  });

  it('restores protected spans exactly, with no whitespace drift', () => {
    const src = `FROM ${REGISTRY}:lock-abc AS build\n`;
    expect(replaceToken(src, 'vectorizer')).toBe(src);
  });

  it('handles two protected references on one line', () => {
    const src = `${REGISTRY}:a ${REGISTRY}:b`;
    expect(replaceToken(src, 'vectorizer')).toBe(src);
  });

  // The workspace scope stays `@precast/*` in every derived project. It is internal and
  // cannot collide, whereas renaming it made ~36 files differ from upstream by construction
  // on every `precast:update`.
  it('leaves the @precast/* workspace scope alone', () => {
    const src = [
      `import { parseApiEnv } from '@${P}/shared';`,
      `"@${P}/*": ["packages/shared/src"]`,
      `"dev": "pnpm -F @${P}/agents dev"`,
    ].join('\n');
    expect(replaceToken(src, 'vectorizer')).toBe(src);
  });

  // ...but RUNTIME identity must still be renamed: the project's own name, which the
  // database schemas and the storage id are derived from.
  it('still renames runtime identity: the project name and the store id', () => {
    const out = replaceToken(
      [`export const PROJECT_NAME = '${P}';`, `id: '${P}-store',`].join('\n'),
      'vectorizer',
    );
    expect(out).toContain("PROJECT_NAME = 'vectorizer'");
    expect(out).toContain("id: 'vectorizer-store'");
  });
});
