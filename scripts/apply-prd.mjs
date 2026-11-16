#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function applyPrd(
  root,
  projectName,
  prepareShared = (cwd) => {
    execFileSync('pnpm', ['--filter', './packages/shared', 'build'], { cwd, stdio: 'pipe' });
  },
) {
  root = resolve(root);
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(projectName) || basename(root) !== projectName)
    throw new Error('Use the exact new project folder.');
  const safe = (relative) => {
    let current = root;
    for (const part of relative.split('/')) {
      current = join(current, part);
      if (existsSync(current) && lstatSync(current).isSymbolicLink())
        throw new Error('A PRD output path is a symlink.');
    }
    return current;
  };
  const marker = safe('.precast/prd-applied.json');
  if (existsSync(marker))
    throw new Error('This project already contains a PRD app. No automatic overwrite.');
  const briefFile = safe('packages/shared/src/project-brief.ts');
  if (
    !readFileSync(briefFile, 'utf8').includes(
      'export const projectBrief: PrdBlueprint | null = null;',
    )
  )
    throw new Error('This project has already been customized.');
  const input = JSON.parse(readFileSync(safe('.precast/prd-build.json'), 'utf8'));
  if (
    input.projectName !== projectName ||
    typeof input.sourceText !== 'string' ||
    !input.sourceText.trim() ||
    input.sourceText.length > 40_000 ||
    createHash('sha256').update(input.sourceText).digest('hex') !== input.sourceHash
  )
    throw new Error('The PRD source does not match this approved project.');
  prepareShared(root);
  const { prdBlueprintSchema, prdCapabilities } = await import(
    pathToFileURL(join(root, 'packages/shared/dist/prd.js')).href
  );
  const brief = prdBlueprintSchema.parse(input.blueprint);
  const capabilities = prdCapabilities(brief);
  const importManifestPath = safe('agentbase.import.json');
  const manifest = JSON.parse(readFileSync(importManifestPath, 'utf8'));
  // This is a capability proposal for the product agent, never a grant. The
  // template builder retains its separate declaration in the original repo.
  delete manifest.computer;
  if (capabilities.computer) {
    const reason = capabilities.computer.purpose.slice(0, 300);
    manifest.computer = {
      agents: ['example-agent'],
      needs: {
        profile: 'general',
        paths: [],
        commandProfiles: [],
        secretAliases: [],
        domains: capabilities.computer.domains.map((domain) => ({ domain, reason })),
        authenticatedSites: capabilities.computer.authenticatedSites ? { reason } : null,
        externalWrite: {
          policy: 'approval',
          reason: 'Ask the owner before browser navigation or any external action.',
        },
        rationale: capabilities.computer.purpose,
      },
    };
    manifest.orchestration = { ...manifest.orchestration, defaultImport: 'full-crew' };
  }
  const files = {
    'docs/PRD.md': input.sourceText + '\n',
    'docs/DATA_MODEL.md': `# ${brief.title} — Data model\n\nRecords belong to the signed-in account or an explicitly selected team workspace and persist in the project's Postgres app schema. Team roles are enforced on the server; linked records must belong to the same workspace and cannot be deleted while referenced. All fields are validated on the server.\n\n${brief.collections.map((c) => `## ${c.label}\n\n${c.fields.map((f) => `- ${f.id}: ${f.type}${f.required ? ', required' : ', optional'}${f.choices.length ? `; allowed values: ${f.choices.join(', ')}` : ''}`).join('\n')}`).join('\n\n')}\n`,
    'docs/AGENT_SPEC.md': `# ${brief.title} — Assistant\n\nMission: ${brief.mission}\n\nUsers: ${brief.audience}\n\nJob: ${brief.agentJob}\n\nThe example-agent A2A endpoint is the product assistant, backed by the approved Gemini connection. It can reason about supplied record details; it cannot independently read or modify saved records. Sign-in and server-derived conversation ownership remain enforced. No unapproved external system is called.\n\nCapabilities: ${JSON.stringify(capabilities)}. Test reminders use a manual durable test outbox; no email is delivered. Test payments simulate outcomes; no provider is called or money charged. If Computer access was requested, import the product agent into AgentBase and approve its own exact sites and authenticated-browser access. Use it from Raya; the ordinary web app cannot borrow the scaffold builder's Computer identity. The browser tool offers no shell, typing, mail sending, deleting or purchases.\n`,
    'docs/DESIGN_SYSTEM.md': `# ${brief.title} — Design\n\nUse the selected APC theme and existing Astryx components in both light and dark mode. The working surface is a responsive, signed-in workspace with a collection navigator, searchable records, typed create/edit forms and the product assistant. No literal brand colours or new UI framework.\n`,
    'docs/PRD_ACCEPTANCE.md': `# ${brief.title} — Acceptance\n\n${brief.acceptanceCriteria.map((criterion) => `- [ ] ${criterion}`).join('\n')}\n\nThese are acceptance requirements, not claims that a live test has passed.\n`,
    'packages/shared/src/project-brief.ts': `import type { PrdBlueprint } from './prd.js';\n\nexport const projectBrief: PrdBlueprint | null = ${JSON.stringify(brief, null, 2)};\n`,
  };
  for (const relative of Object.keys(files)) safe(relative);
  writeFileSync(importManifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(dirname(safe(relative)), { recursive: true });
    writeFileSync(safe(relative), content, { mode: 0o600 });
  }
  const receipt = {
    projectName,
    sourceName: input.sourceName,
    sourceHash: input.sourceHash,
    title: brief.title,
    collections: brief.collections.map((c) => c.id),
    documents: Object.keys(files).filter((p) => p.startsWith('docs/')),
    clarifications: input.clarifications ?? [],
  };
  writeFileSync(marker, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  for (const relative of ['docs/PROGRESS.md', 'docs/HANDOFF.md']) {
    const file = safe(relative);
    writeFileSync(
      file,
      `# ${brief.title} — PRD build\n\n${brief.mission}\n\nSource: docs/PRD.md (sha256 ${input.sourceHash}).\n\nApp: private, validated, persistent records; product assistant.\n\n${receipt.clarifications.length ? `Human clarifications:\n${receipt.clarifications.map((v) => '- ' + v).join('\n')}\n\n` : ''}Verification, build and live acceptance results must be recorded by the scaffold runner.\n`,
      { mode: 0o600 },
    );
  }
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const projectName = process.argv
      .find((arg) => arg.startsWith('--project-name='))
      ?.slice('--project-name='.length);
    const receipt = await applyPrd(process.cwd(), projectName);
    process.stdout.write(
      `PRD product and feed-forward documents created: ${receipt.title}; collections: ${receipt.collections.join(', ')}.\n`,
    );
  } catch (error) {
    process.stderr.write(`PRD build refused: ${String(error.message).split('\n')[0]}\n`);
    process.exitCode = 1;
  }
}
