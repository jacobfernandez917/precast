import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPrd } from '../../../scripts/apply-prd.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'prd-apply-'));
  dirs.push(dir);
  const root = join(dir, 'action-desk');
  for (const path of ['.precast', 'packages/shared/src', 'packages/shared/dist', 'docs'])
    mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, 'package.json'), ' {"name":"action-desk","type":"module"}');
  cpSync(join(ROOT, 'packages/shared/dist'), join(root, 'packages/shared/dist'), {
    recursive: true,
  });
  symlinkSync(
    join(ROOT, 'packages/shared/node_modules'),
    join(root, 'packages/shared/node_modules'),
    'dir',
  );
  writeFileSync(
    join(root, 'packages/shared/src/project-brief.ts'),
    'export const projectBrief: PrdBlueprint | null = null;',
  );
  const sourceText = 'Action Desk must save private actions.';
  const input = {
    projectName: 'action-desk',
    sourceName: 'actions.pdf',
    sourceText,
    sourceHash: createHash('sha256').update(sourceText).digest('hex'),
    clarifications: [],
    blueprint: {
      title: 'Action Desk',
      mission: 'Save private actions.',
      audience: 'Individuals',
      agentJob: 'Help plan actions.',
      collections: [
        {
          id: 'actions',
          label: 'Actions',
          singular: 'Action',
          fields: [{ id: 'title', label: 'Title', type: 'text', required: true, choices: [] }],
        },
      ],
      acceptanceCriteria: ['Save an action.'],
    },
  };
  writeFileSync(join(root, '.precast/prd-build.json'), JSON.stringify(input));
  return { root, input, dir };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
describe('TOOL-018 bounded PRD materialization', () => {
  it('writes the exact PRD, product configuration and feed-forward specs, then refuses to clobber the app', async () => {
    const { root, input } = fixture();
    const receipt = await applyPrd(root, 'action-desk', () => {});
    expect(readFileSync(join(root, 'docs/PRD.md'), 'utf8')).toBe(input.sourceText + '\n');
    expect(readFileSync(join(root, 'packages/shared/src/project-brief.ts'), 'utf8')).toContain(
      'Action Desk',
    );
    for (const path of ['DATA_MODEL', 'AGENT_SPEC', 'DESIGN_SYSTEM', 'PRD_ACCEPTANCE'])
      expect(existsSync(join(root, 'docs', path + '.md'))).toBe(true);
    expect(receipt.sourceHash).toBe(input.sourceHash);
    await expect(applyPrd(root, 'action-desk', () => {})).rejects.toThrow(/already contains/);
  });
  it('refuses a tampered source before running any build or writing a product', async () => {
    const { root, input } = fixture();
    writeFileSync(
      join(root, '.precast/prd-build.json'),
      JSON.stringify({ ...input, sourceText: 'different source' }),
    );
    const build = vi.fn();
    await expect(applyPrd(root, 'action-desk', build)).rejects.toThrow(/source does not match/);
    expect(build).not.toHaveBeenCalled();
    expect(existsSync(join(root, '.precast/prd-applied.json'))).toBe(false);
  });
  it('refuses a symlinked output and an unrelated project directory', async () => {
    const { root, dir } = fixture();
    rmSync(join(root, 'docs'), { recursive: true });
    const outside = join(dir, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(root, 'docs'), 'dir');
    await expect(applyPrd(root, 'action-desk', () => {})).rejects.toThrow(/symlink/);
    expect(existsSync(join(outside, 'PRD.md'))).toBe(false);
    await expect(applyPrd(root, 'other-project', () => {})).rejects.toThrow(/exact new project/);
  });
});
