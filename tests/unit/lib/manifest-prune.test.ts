import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import {
  hashFileSync,
  pruneStaleManifestEntriesSync,
  type Manifest,
  type ManifestEntry,
} from '../../../src/lib/manifest.js';

const tempDirs: string[] = [];

function createTargetBase(): string {
  const targetBase = mkdtempSync(join(tmpdir(), 'overdeck-manifest-prune-'));
  tempDirs.push(targetBase);
  return targetBase;
}

function write(targetBase: string, relativePath: string, content: string): string {
  const filePath = join(targetBase, relativePath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function createManifest(installed: Record<string, ManifestEntry>): Manifest {
  return { version: 1, managed_by: 'overdeck', installed };
}

function entry(hash: string, source = 'overdeck'): ManifestEntry {
  return { hash, source, installed_at: '2026-08-01T00:00:00.000Z' };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('pruneStaleManifestEntriesSync', () => {
  it('deletes a stale unmodified file and drops its manifest entry', () => {
    const targetBase = createTargetBase();
    const filePath = write(targetBase, 'skills/removed/SKILL.md', '# removed\n');
    const manifest = createManifest({
      'skills/removed/SKILL.md': entry(hashFileSync(filePath)),
    });

    const result = pruneStaleManifestEntriesSync(targetBase, manifest, new Set());

    expect(result).toEqual({ pruned: ['skills/removed/SKILL.md'], keptModified: [] });
    expect(existsSync(filePath)).toBe(false);
    expect(manifest.installed).toEqual({});
  });

  it('drops a stale manifest entry when its target file is already missing', () => {
    const targetBase = createTargetBase();
    const manifest = createManifest({
      'skills/missing/SKILL.md': entry('sha256:missing'),
    });

    const result = pruneStaleManifestEntriesSync(targetBase, manifest, new Set());

    expect(result).toEqual({ pruned: ['skills/missing/SKILL.md'], keptModified: [] });
    expect(manifest.installed).toEqual({});
  });

  it('drops stale entries when targetBase is already missing', () => {
    const targetBase = createTargetBase();
    rmSync(targetBase, { recursive: true });
    const manifest = createManifest({
      'skills/missing/SKILL.md': entry('sha256:missing'),
    });

    const result = pruneStaleManifestEntriesSync(targetBase, manifest, new Set());

    expect(result).toEqual({ pruned: ['skills/missing/SKILL.md'], keptModified: [] });
    expect(manifest.installed).toEqual({});
  });

  it('preserves a modified stale file but releases its manifest ownership', () => {
    const targetBase = createTargetBase();
    const filePath = write(targetBase, 'rules/removed.md', 'user modification\n');
    const manifest = createManifest({
      'rules/removed.md': entry('sha256:original'),
    });

    const result = pruneStaleManifestEntriesSync(targetBase, manifest, new Set());

    expect(result).toEqual({ pruned: [], keptModified: ['rules/removed.md'] });
    expect(readFileSync(filePath, 'utf-8')).toBe('user modification\n');
    expect(manifest.installed).toEqual({});
  });

  it('preserves non-Overdeck, current-source, and unmanifested files', () => {
    const targetBase = createTargetBase();
    const projectFile = write(targetBase, 'rules/project.md', 'project\n');
    const currentFile = write(targetBase, 'rules/current.md', 'current\n');
    const unmanifestedFile = write(targetBase, 'rules/user.md', 'user\n');
    const manifest = createManifest({
      'rules/project.md': entry(hashFileSync(projectFile), 'project-template'),
      'rules/current.md': entry(hashFileSync(currentFile)),
    });

    const result = pruneStaleManifestEntriesSync(
      targetBase,
      manifest,
      new Set(['rules/current.md']),
    );

    expect(result).toEqual({ pruned: [], keptModified: [] });
    expect(existsSync(projectFile)).toBe(true);
    expect(existsSync(currentFile)).toBe(true);
    expect(existsSync(unmanifestedFile)).toBe(true);
    expect(Object.keys(manifest.installed)).toEqual(['rules/project.md', 'rules/current.md']);
  });

  it('only considers stale entries matching the requested prefixes', () => {
    const targetBase = createTargetBase();
    const skillFile = write(targetBase, 'skills/removed/SKILL.md', 'skill\n');
    const ruleFile = write(targetBase, 'rules/removed.md', 'rule\n');
    const manifest = createManifest({
      'skills/removed/SKILL.md': entry(hashFileSync(skillFile)),
      'rules/removed.md': entry(hashFileSync(ruleFile)),
    });

    const result = pruneStaleManifestEntriesSync(targetBase, manifest, new Set(), {
      prefixes: ['skills/'],
    });

    expect(result).toEqual({ pruned: ['skills/removed/SKILL.md'], keptModified: [] });
    expect(existsSync(skillFile)).toBe(false);
    expect(existsSync(ruleFile)).toBe(true);
    expect(manifest.installed).toHaveProperty('rules/removed.md');
  });

  it('rejects traversal paths without reading or deleting outside targetBase', () => {
    const targetBase = createTargetBase();
    const outsideDir = createTargetBase();
    const outsideFile = write(outsideDir, 'outside.txt', 'outside\n');
    const traversalPath = `skills/../${relative(targetBase, outsideFile)}`;
    const manifest = createManifest({
      [traversalPath]: entry(hashFileSync(outsideFile)),
    });

    const result = pruneStaleManifestEntriesSync(targetBase, manifest, new Set(), {
      prefixes: ['skills/'],
    });

    expect(result).toEqual({ pruned: [], keptModified: [traversalPath] });
    expect(readFileSync(outsideFile, 'utf-8')).toBe('outside\n');
    expect(manifest.installed).toEqual({});
  });

  it('rejects absolute manifest paths without touching their targets', () => {
    const targetBase = createTargetBase();
    const outsideDir = createTargetBase();
    const outsideFile = write(outsideDir, 'absolute.txt', 'outside\n');
    const manifest = createManifest({
      [outsideFile]: entry(hashFileSync(outsideFile)),
    });

    const result = pruneStaleManifestEntriesSync(targetBase, manifest, new Set(), {
      prefixes: ['skills/', 'agents/', 'rules/'],
    });

    expect(result).toEqual({ pruned: [], keptModified: [outsideFile] });
    expect(readFileSync(outsideFile, 'utf-8')).toBe('outside\n');
    expect(manifest.installed).toEqual({});
  });

  it('rejects symlinked ancestors that redirect outside targetBase', () => {
    const targetBase = createTargetBase();
    const outsideDir = createTargetBase();
    const outsideFile = write(outsideDir, 'SKILL.md', 'outside\n');
    const linkedParent = join(targetBase, 'skills', 'linked');
    mkdirSync(join(targetBase, 'skills'), { recursive: true });
    symlinkSync(outsideDir, linkedParent, 'dir');
    const manifest = createManifest({
      'skills/linked/SKILL.md': entry(hashFileSync(outsideFile)),
    });

    const result = pruneStaleManifestEntriesSync(targetBase, manifest, new Set());

    expect(result).toEqual({ pruned: [], keptModified: ['skills/linked/SKILL.md'] });
    expect(readFileSync(outsideFile, 'utf-8')).toBe('outside\n');
    expect(lstatSync(linkedParent).isSymbolicLink()).toBe(true);
    expect(manifest.installed).toEqual({});
  });

  it('preserves stale targets whose filesystem type changed', () => {
    const targetBase = createTargetBase();
    const directoryPath = join(targetBase, 'rules', 'directory.md');
    const danglingLink = join(targetBase, 'skills', 'dangling', 'SKILL.md');
    mkdirSync(directoryPath, { recursive: true });
    mkdirSync(join(danglingLink, '..'), { recursive: true });
    symlinkSync(join(targetBase, 'missing-target'), danglingLink);
    const manifest = createManifest({
      'rules/directory.md': entry('sha256:directory'),
      'skills/dangling/SKILL.md': entry('sha256:link'),
    });

    const result = pruneStaleManifestEntriesSync(targetBase, manifest, new Set());

    expect(result).toEqual({
      pruned: [],
      keptModified: ['rules/directory.md', 'skills/dangling/SKILL.md'],
    });
    expect(lstatSync(directoryPath).isDirectory()).toBe(true);
    expect(lstatSync(danglingLink).isSymbolicLink()).toBe(true);
    expect(manifest.installed).toEqual({});
  });

  it('removes empty ancestor directories but never removes targetBase', () => {
    const targetBase = createTargetBase();
    const filePath = write(targetBase, 'skills/removed/nested/SKILL.md', 'skill\n');
    const manifest = createManifest({
      'skills/removed/nested/SKILL.md': entry(hashFileSync(filePath)),
    });

    pruneStaleManifestEntriesSync(targetBase, manifest, new Set());

    expect(existsSync(join(targetBase, 'skills'))).toBe(false);
    expect(existsSync(targetBase)).toBe(true);
  });

  it('is idempotent after pruning stale entries', () => {
    const targetBase = createTargetBase();
    const filePath = write(targetBase, 'agents/removed.md', 'agent\n');
    const manifest = createManifest({
      'agents/removed.md': entry(hashFileSync(filePath)),
    });

    const first = pruneStaleManifestEntriesSync(targetBase, manifest, new Set());
    const second = pruneStaleManifestEntriesSync(targetBase, manifest, new Set());

    expect(first).toEqual({ pruned: ['agents/removed.md'], keptModified: [] });
    expect(second).toEqual({ pruned: [], keptModified: [] });
  });
});
