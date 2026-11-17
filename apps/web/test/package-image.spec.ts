import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  activatePackageImage,
  inspectPackageImage,
  packageGraphHash,
  packageImageTag,
  workspaceManifests,
} from '../../../scripts/package-image.mjs';

const temporary: string[] = [];

function temp(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}

function write(root: string, rel: string, value: string | object) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
}

function project(root: string, rootName = 'precast') {
  write(root, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
  write(root, 'pnpm-workspace.yaml', "packages: ['apps/*', 'packages/*']\n");
  write(root, 'package.json', {
    name: rootName,
    private: true,
    packageManager: 'pnpm@9.15.9',
    dependencies: { zod: '^3.25.0' },
  });
  write(root, 'apps/web/package.json', {
    name: '@precast/web',
    dependencies: { '@precast/shared': 'workspace:*', next: '^16.0.0' },
  });
  write(root, 'packages/shared/package.json', {
    name: '@precast/shared',
    dependencies: { zod: '^3.25.0' },
  });
}

function packageImage(root: string, imageRoot: string, archive = 'tiny-package-archive') {
  const archivePath = join(imageRoot, 'node-modules.tar.zst');
  mkdirSync(imageRoot, { recursive: true });
  writeFileSync(archivePath, archive);
  write(imageRoot, 'manifest.json', {
    kind: 'precast-pnpm-package-image',
    v: 1,
    graphHash: packageGraphHash(root),
    sourceRevision: 'a'.repeat(40),
    platform: process.platform,
    arch: process.arch,
    nodeMajor: Number(process.versions.node.split('.')[0]),
    pnpm: '9.15.9',
    archive: {
      file: 'node-modules.tar.zst',
      sha256: createHash('sha256').update(archive).digest('hex'),
      bytes: Buffer.byteLength(archive),
    },
  });
}

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('warm package image identity', () => {
  it('keys every workspace dependency graph but ignores runtime project names', () => {
    const root = temp('precast-package-key-');
    project(root);
    const first = packageGraphHash(root);
    expect(workspaceManifests(root)).toEqual([
      'package.json',
      'apps/web/package.json',
      'packages/shared/package.json',
    ]);
    expect(packageImageTag(root)).toBe(`lock-${first?.slice(0, 16)}`);

    const renamed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    renamed.name = 'another-project';
    write(root, 'package.json', renamed);
    expect(packageGraphHash(root)).toBe(first);

    write(root, 'pnpm-workspace.yaml', "packages: ['apps/*']\n");
    expect(packageGraphHash(root)).not.toBe(first);
    write(root, 'pnpm-workspace.yaml', "packages: ['apps/*', 'packages/*']\n");
    expect(packageGraphHash(root)).toBe(first);

    const web = JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8'));
    web.dependencies.next = '^17.0.0';
    write(root, 'apps/web/package.json', web);
    expect(packageGraphHash(root)).not.toBe(first);
  });

  it('refuses stale and corrupted packages before extracting anything', () => {
    const root = temp('precast-package-project-');
    const image = temp('precast-package-image-');
    project(root);
    packageImage(root, image);
    expect(inspectPackageImage(root, image)).toMatchObject({ usable: true });

    writeFileSync(join(image, 'node-modules.tar.zst'), 'changed');
    expect(inspectPackageImage(root, image)).toEqual({
      usable: false,
      reason: 'the package image archive size does not match its manifest',
    });
  });

  it('restores only the package trees into a fresh project and records provenance', () => {
    const root = temp('precast-package-project-');
    const image = temp('precast-package-image-');
    project(root);
    packageImage(root, image);

    const restored = activatePackageImage(root, {
      imageRoot: image,
      extract: (_archive, stage) => {
        write(stage, 'node_modules/.modules.yaml', 'layoutVersion: 5\n');
        write(stage, 'node_modules/.pnpm/zod/package.json', { name: 'zod' });
        mkdirSync(join(stage, 'apps/web/node_modules/@precast'), { recursive: true });
        symlinkSync(
          '../../../../packages/shared',
          join(stage, 'apps/web/node_modules/@precast/shared'),
        );
        mkdirSync(join(stage, 'packages/shared/node_modules'), { recursive: true });
      },
    });

    expect(restored).toMatchObject({ used: true, sourceRevision: 'a'.repeat(40) });
    expect(readFileSync(join(root, 'node_modules/.pnpm/zod/package.json'), 'utf8')).toContain(
      'zod',
    );
    expect(readFileSync(join(root, '.precast/package-image.json'), 'utf8')).toContain(
      packageGraphHash(root),
    );
  });

  it('keeps an existing install and a missing image on the normal fallback path', () => {
    const root = temp('precast-package-project-');
    const image = temp('precast-package-image-');
    project(root);
    expect(activatePackageImage(root, { imageRoot: image })).toEqual({
      used: false,
      reason: 'no package image is present in this Computer image',
    });
    packageImage(root, image);
    mkdirSync(join(root, 'node_modules'));
    expect(activatePackageImage(root, { imageRoot: image })).toEqual({
      used: false,
      reason: 'dependencies already exist in this checkout',
    });
  });
});

describe('package image publication contract', () => {
  it('publishes a source-free scratch image and retains frozen-install fallback in bootstrap', () => {
    const repo = join(import.meta.dirname, '../../..');
    const dockerfile = readFileSync(join(repo, 'docker/package-image.Dockerfile'), 'utf8');
    const bootstrap = readFileSync(join(repo, 'scripts/bootstrap.mjs'), 'utf8');
    expect(dockerfile).toContain('FROM scratch');
    for (const manifest of workspaceManifests(repo).slice(1)) {
      expect(dockerfile).toContain(`COPY ${manifest} ./${manifest}`);
    }
    expect(dockerfile).not.toMatch(/COPY\s+(apps|packages)\/[^*].*\/(src|app)\b/);
    expect(bootstrap).toContain("'--frozen-lockfile'");
    expect(bootstrap).toContain('activatePackageImage(rootDir)');
  });
});
