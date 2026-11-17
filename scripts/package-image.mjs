#!/usr/bin/env node
/**
 * Build-time identity and runtime activation for Precast's optional package image.
 *
 * The published OCI image contains no application source. It carries one zstd archive of the
 * root and workspace node_modules trees, plus a manifest bound to the dependency graph. The
 * scaffold builder may restore that archive only from the signed Developer Computer image and
 * only when this checkout computes the same graph hash. A miss is an optimisation miss, never a
 * build failure: bootstrap retains its frozen pnpm install fallback.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const PACKAGE_IMAGE_KIND = 'precast-pnpm-package-image';
export const PACKAGE_IMAGE_VERSION = 1;
export const DEFAULT_PACKAGE_IMAGE_ROOT = '/opt/precast-package-image';
export const PACKAGE_ARCHIVE = 'node-modules.tar.zst';
export const PACKAGE_MANIFEST = 'manifest.json';

export function workspaceManifests(root = scriptRoot) {
  const workspaces = ['apps', 'packages'].flatMap((group) => {
    const base = join(root, group);
    if (!existsSync(base)) return [];
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(base, entry.name, 'package.json')))
      .map((entry) => `${group}/${entry.name}/package.json`);
  });
  return ['package.json', ...workspaces.sort()];
}

function dependencyShape(path) {
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  return {
    dependencies: pkg.dependencies ?? {},
    devDependencies: pkg.devDependencies ?? {},
    optionalDependencies: pkg.optionalDependencies ?? {},
    peerDependencies: pkg.peerDependencies ?? {},
    pnpm: pkg.pnpm ?? null,
    packageManager: pkg.packageManager ?? null,
  };
}

/** The key ignores package names because bootstrap changes runtime identity, not dependencies. */
export function packageGraphHash(root = scriptRoot) {
  const lock = join(root, 'pnpm-lock.yaml');
  const workspace = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(lock) || !existsSync(workspace)) return null;
  const hash = createHash('sha256').update(readFileSync(lock));
  hash.update('\0pnpm-workspace.yaml\0');
  hash.update(readFileSync(workspace));
  for (const manifest of workspaceManifests(root)) {
    hash.update('\0');
    hash.update(manifest);
    hash.update('\0');
    hash.update(JSON.stringify(dependencyShape(join(root, manifest))));
  }
  return hash.digest('hex');
}

export function packageImageTag(root = scriptRoot) {
  const hash = packageGraphHash(root);
  return hash ? `lock-${hash.slice(0, 16)}` : null;
}

function pnpmVersion(root) {
  const value = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager;
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(value ?? '');
  if (!match) throw new Error('package.json must pin packageManager as pnpm@<version>.');
  return match[1];
}

function sha256File(path) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = openSync(path, 'r');
  try {
    for (;;) {
      const bytes = readSync(fd, buffer, 0, buffer.length, null);
      if (bytes === 0) return hash.digest('hex');
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(fd);
  }
}

function validManifest(value) {
  return (
    value &&
    typeof value === 'object' &&
    value.kind === PACKAGE_IMAGE_KIND &&
    value.v === PACKAGE_IMAGE_VERSION &&
    typeof value.graphHash === 'string' &&
    /^[a-f0-9]{64}$/.test(value.graphHash) &&
    typeof value.sourceRevision === 'string' &&
    /^[a-f0-9]{40}$/.test(value.sourceRevision) &&
    value.platform === 'linux' &&
    value.arch === 'x64' &&
    value.nodeMajor === 24 &&
    typeof value.pnpm === 'string' &&
    /^\d+\.\d+\.\d+$/.test(value.pnpm) &&
    value.archive &&
    typeof value.archive === 'object' &&
    value.archive.file === PACKAGE_ARCHIVE &&
    typeof value.archive.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.archive.sha256) &&
    Number.isSafeInteger(value.archive.bytes) &&
    value.archive.bytes > 0 &&
    value.archive.bytes <= 2_000_000_000
  );
}

function boundedReason(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, ' ').slice(0, 240);
}

export function inspectPackageImage(root = scriptRoot, imageRoot = DEFAULT_PACKAGE_IMAGE_ROOT) {
  try {
    const manifestPath = join(imageRoot, PACKAGE_MANIFEST);
    const archivePath = join(imageRoot, PACKAGE_ARCHIVE);
    if (!existsSync(manifestPath) || !existsSync(archivePath)) {
      return { usable: false, reason: 'no package image is present in this Computer image' };
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!validManifest(manifest)) {
      return { usable: false, reason: 'the package image manifest is invalid' };
    }
    const graphHash = packageGraphHash(root);
    if (!graphHash || manifest.graphHash !== graphHash) {
      return { usable: false, reason: 'the package image does not match this dependency graph' };
    }
    if (manifest.pnpm !== pnpmVersion(root)) {
      return { usable: false, reason: 'the package image uses another pnpm version' };
    }
    if (process.platform !== manifest.platform || process.arch !== manifest.arch) {
      return { usable: false, reason: 'the package image targets another platform' };
    }
    if (Number(process.versions.node.split('.')[0]) !== manifest.nodeMajor) {
      return { usable: false, reason: 'the package image targets another Node major version' };
    }
    const archiveStat = statSync(archivePath);
    if (!archiveStat.isFile() || archiveStat.size !== manifest.archive.bytes) {
      return {
        usable: false,
        reason: 'the package image archive size does not match its manifest',
      };
    }
    if (sha256File(archivePath) !== manifest.archive.sha256) {
      return {
        usable: false,
        reason: 'the package image archive hash does not match its manifest',
      };
    }
    return { usable: true, manifest, archivePath };
  } catch (error) {
    return { usable: false, reason: boundedReason(error) };
  }
}

function extractWithTar(archivePath, destination) {
  const result = spawnSync(
    'tar',
    [
      '--extract',
      '--zstd',
      '--file',
      archivePath,
      '--directory',
      destination,
      '--no-same-owner',
      '--no-same-permissions',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'tar failed').trim();
    throw new Error(`the package archive could not be extracted: ${detail.slice(-180)}`);
  }
}

/**
 * Restore an exact package image into a fresh checkout. `extract` is injectable for unit tests;
 * production uses GNU tar + zstd from the signed Developer Computer image.
 */
export function activatePackageImage(
  root = scriptRoot,
  { imageRoot = DEFAULT_PACKAGE_IMAGE_ROOT, extract = extractWithTar } = {},
) {
  const inspected = inspectPackageImage(root, imageRoot);
  if (!inspected.usable) return { used: false, reason: inspected.reason };

  const moduleTargets = workspaceManifests(root)
    .map((manifest) =>
      manifest === 'package.json' ? 'node_modules' : `${dirname(manifest)}/node_modules`,
    )
    .filter((path, index, values) => values.indexOf(path) === index);
  if (moduleTargets.some((path) => existsSync(join(root, path)))) {
    return { used: false, reason: 'dependencies already exist in this checkout' };
  }

  const stateRoot = join(root, '.precast');
  if (existsSync(stateRoot) && !lstatSync(stateRoot).isDirectory()) {
    return { used: false, reason: 'the project state path is not a directory' };
  }
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(stateRoot, 'package-image-stage-'));
  const moved = [];
  try {
    extract(inspected.archivePath, stage);
    if (!existsSync(join(stage, 'node_modules', '.modules.yaml'))) {
      throw new Error('the package archive has no pnpm installation marker');
    }
    const stagedTargets = moduleTargets.filter((path) => existsSync(join(stage, path)));
    if (!stagedTargets.includes('node_modules')) {
      throw new Error('the package archive has no root node_modules tree');
    }
    for (const rel of stagedTargets) {
      const source = resolve(stage, rel);
      if (relative(stage, source).startsWith('..') || !lstatSync(source).isDirectory()) {
        throw new Error('the package archive contains an invalid dependency tree');
      }
      const target = join(root, rel);
      mkdirSync(dirname(target), { recursive: true });
      renameSync(source, target);
      moved.push(target);
    }
    writeFileSync(
      join(stateRoot, 'package-image.json'),
      JSON.stringify(
        {
          v: PACKAGE_IMAGE_VERSION,
          graphHash: inspected.manifest.graphHash,
          sourceRevision: inspected.manifest.sourceRevision,
          archiveSha256: inspected.manifest.archive.sha256,
          restoredAt: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
    return {
      used: true,
      graphHash: inspected.manifest.graphHash,
      sourceRevision: inspected.manifest.sourceRevision,
    };
  } catch (error) {
    for (const target of moved.reverse()) rmSync(target, { recursive: true, force: true });
    return { used: false, reason: boundedReason(error) };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function flagValue(args, name) {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function writeBuildManifest(args) {
  const archive = flagValue(args, 'archive');
  const revision = flagValue(args, 'revision');
  const expectedHash = flagValue(args, 'graph-hash');
  if (!archive || !revision || !expectedHash) {
    throw new Error('--write-manifest needs --archive, --revision and --graph-hash.');
  }
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('revision must be a full Git SHA.');
  const graphHash = packageGraphHash(scriptRoot);
  if (!graphHash || graphHash !== expectedHash) {
    throw new Error('the supplied graph hash does not match the package-image build context.');
  }
  const archivePath = resolve(archive);
  const archiveStat = statSync(archivePath);
  const manifest = {
    kind: PACKAGE_IMAGE_KIND,
    v: PACKAGE_IMAGE_VERSION,
    graphHash,
    sourceRevision: revision,
    platform: 'linux',
    arch: 'x64',
    nodeMajor: Number(process.versions.node.split('.')[0]),
    pnpm: pnpmVersion(scriptRoot),
    archive: {
      file: PACKAGE_ARCHIVE,
      sha256: sha256File(archivePath),
      bytes: archiveStat.size,
    },
  };
  writeFileSync(
    join(dirname(archivePath), PACKAGE_MANIFEST),
    JSON.stringify(manifest, null, 2) + '\n',
  );
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--hash')) {
    const hash = packageGraphHash();
    if (!hash) process.exit(1);
    process.stdout.write(`${hash}\n`);
    return;
  }
  if (args.includes('--tag')) {
    const tag = packageImageTag();
    if (!tag) process.exit(1);
    process.stdout.write(`${tag}\n`);
    return;
  }
  if (args.includes('--write-manifest')) {
    writeBuildManifest(args);
    return;
  }
  process.stdout.write(`Package image tag: ${packageImageTag() ?? 'unavailable'}\n`);
}

function exitWithReason(error) {
  process.stderr.write(`\n❌ ${boundedReason(error)}\n`);
  if (process.env.PRECAST_DEBUG && error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  } else process.stderr.write('   (PRECAST_DEBUG=1 shows the full error.)\n');
  process.exit(1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  Promise.resolve().then(main).catch(exitWithReason);
}
