/**
 * Tests for manifest read/write/compare utilities (PAN-266)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  hashFileSync,
  createEmptyManifest,
  readManifestSync,
  writeManifestSync,
  setManifestEntry,
  removeManifestEntry,
  compareFileToManifest,
  collectSourceFilesSync,
  buildManifestFromDirectory,
} from '../manifest.js';
import type { Manifest } from '../manifest.js';

let TEST_DIR: string;

beforeEach(() => {
  TEST_DIR = join(tmpdir(), `manifest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('hashFile', () => {
  it('returns sha256-prefixed hash', () => {
    const filePath = join(TEST_DIR, 'test.md');
    writeFileSync(filePath, 'hello world');
    const hash = hashFileSync(filePath);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('returns consistent hashes for same content', () => {
    const file1 = join(TEST_DIR, 'a.md');
    const file2 = join(TEST_DIR, 'b.md');
    writeFileSync(file1, 'same content');
    writeFileSync(file2, 'same content');
    expect(hashFileSync(file1)).toBe(hashFileSync(file2));
  });

  it('returns different hashes for different content', () => {
    const file1 = join(TEST_DIR, 'a.md');
    const file2 = join(TEST_DIR, 'b.md');
    writeFileSync(file1, 'content A');
    writeFileSync(file2, 'content B');
    expect(hashFileSync(file1)).not.toBe(hashFileSync(file2));
  });
});

describe('createEmptyManifest', () => {
  it('creates valid empty manifest', () => {
    const m = createEmptyManifest();
    expect(m.version).toBe(1);
    expect(m.managed_by).toBe('panopticon');
    expect(m.installed).toEqual({});
  });
});

describe('readManifest / writeManifest', () => {
  it('round-trips a manifest', () => {
    const manifestPath = join(TEST_DIR, '.panopticon-manifest.json');
    const manifest = createEmptyManifest();
    setManifestEntry(manifest, 'skills/beads/SKILL.md', 'sha256:abc123', 'panopticon');

    writeManifestSync(manifestPath, manifest);
    const loaded = readManifestSync(manifestPath);

    expect(loaded.version).toBe(1);
    expect(loaded.managed_by).toBe('panopticon');
    expect(loaded.installed['skills/beads/SKILL.md'].hash).toBe('sha256:abc123');
    expect(loaded.installed['skills/beads/SKILL.md'].source).toBe('panopticon');
  });

  it('returns empty manifest for nonexistent file', () => {
    const m = readManifestSync(join(TEST_DIR, 'does-not-exist.json'));
    expect(m.installed).toEqual({});
  });

  it('returns empty manifest for invalid JSON', () => {
    const manifestPath = join(TEST_DIR, 'bad.json');
    writeFileSync(manifestPath, 'not json!!!');
    const m = readManifestSync(manifestPath);
    expect(m.installed).toEqual({});
  });

  it('returns empty manifest for wrong schema', () => {
    const manifestPath = join(TEST_DIR, 'wrong.json');
    writeFileSync(manifestPath, JSON.stringify({ version: 99, other: true }));
    const m = readManifestSync(manifestPath);
    expect(m.installed).toEqual({});
  });

  it('creates parent directories when writing', () => {
    const manifestPath = join(TEST_DIR, 'deep', 'nested', 'manifest.json');
    writeManifestSync(manifestPath, createEmptyManifest());
    expect(existsSync(manifestPath)).toBe(true);
  });
});

describe('setManifestEntry / removeManifestEntry', () => {
  it('adds entries', () => {
    const m = createEmptyManifest();
    setManifestEntry(m, 'skills/foo/SKILL.md', 'sha256:aaa', 'panopticon');
    expect(m.installed['skills/foo/SKILL.md']).toBeDefined();
    expect(m.installed['skills/foo/SKILL.md'].hash).toBe('sha256:aaa');
    expect(m.installed['skills/foo/SKILL.md'].source).toBe('panopticon');
    expect(m.installed['skills/foo/SKILL.md'].installed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('overwrites existing entries', () => {
    const m = createEmptyManifest();
    setManifestEntry(m, 'skills/foo/SKILL.md', 'sha256:old', 'panopticon');
    setManifestEntry(m, 'skills/foo/SKILL.md', 'sha256:new', 'project-template');
    expect(m.installed['skills/foo/SKILL.md'].hash).toBe('sha256:new');
    expect(m.installed['skills/foo/SKILL.md'].source).toBe('project-template');
  });

  it('removes entries', () => {
    const m = createEmptyManifest();
    setManifestEntry(m, 'skills/foo/SKILL.md', 'sha256:aaa', 'panopticon');
    removeManifestEntry(m, 'skills/foo/SKILL.md');
    expect(m.installed['skills/foo/SKILL.md']).toBeUndefined();
  });

  it('removing nonexistent entry is a no-op', () => {
    const m = createEmptyManifest();
    removeManifestEntry(m, 'skills/nope/SKILL.md');
    expect(Object.keys(m.installed)).toHaveLength(0);
  });
});

describe('compareFileToManifest', () => {
  let manifest: Manifest;

  beforeEach(() => {
    manifest = createEmptyManifest();
  });

  it('returns "new" when file does not exist', () => {
    const result = compareFileToManifest(
      join(TEST_DIR, 'nonexistent.md'),
      'skills/foo/SKILL.md',
      manifest,
    );
    expect(result.action).toBe('new');
  });

  it('returns "user-owned" when file exists but not in manifest', () => {
    const filePath = join(TEST_DIR, 'user-file.md');
    writeFileSync(filePath, 'user content');
    const result = compareFileToManifest(filePath, 'skills/user/SKILL.md', manifest);
    expect(result.action).toBe('user-owned');
  });

  it('returns "update" when file hash matches manifest', () => {
    const filePath = join(TEST_DIR, 'managed.md');
    writeFileSync(filePath, 'managed content');
    const hash = hashFileSync(filePath);
    setManifestEntry(manifest, 'skills/managed/SKILL.md', hash, 'panopticon');

    const result = compareFileToManifest(filePath, 'skills/managed/SKILL.md', manifest);
    expect(result.action).toBe('update');
  });

  it('returns "modified" when file hash differs from manifest', () => {
    const filePath = join(TEST_DIR, 'modified.md');
    writeFileSync(filePath, 'original content');
    const originalHash = hashFileSync(filePath);
    setManifestEntry(manifest, 'skills/mod/SKILL.md', originalHash, 'panopticon');

    // User modifies the file
    writeFileSync(filePath, 'user modified this');

    const result = compareFileToManifest(filePath, 'skills/mod/SKILL.md', manifest);
    expect(result.action).toBe('modified');
    if (result.action === 'modified') {
      expect(result.manifestHash).toBe(originalHash);
      expect(result.currentHash).not.toBe(originalHash);
    }
  });
});

describe('collectSourceFiles', () => {
  it('collects files recursively with prefix', () => {
    const skillsDir = join(TEST_DIR, 'skills');
    mkdirSync(join(skillsDir, 'beads'), { recursive: true });
    mkdirSync(join(skillsDir, 'pan-help'), { recursive: true });
    writeFileSync(join(skillsDir, 'beads', 'SKILL.md'), 'beads skill');
    writeFileSync(join(skillsDir, 'pan-help', 'SKILL.md'), 'help skill');
    writeFileSync(join(skillsDir, 'pan-help', 'README.md'), 'readme');

    const files = collectSourceFilesSync(skillsDir, 'skills/');
    const paths = files.map(f => f.relativePath).sort();

    expect(paths).toEqual([
      'skills/beads/SKILL.md',
      'skills/pan-help/README.md',
      'skills/pan-help/SKILL.md',
    ]);
  });

  it('returns empty array for nonexistent directory', () => {
    const files = collectSourceFilesSync(join(TEST_DIR, 'nope'), 'skills/');
    expect(files).toEqual([]);
  });

  it('returns absolute paths that exist', () => {
    const skillsDir = join(TEST_DIR, 'skills');
    mkdirSync(join(skillsDir, 'test'), { recursive: true });
    writeFileSync(join(skillsDir, 'test', 'SKILL.md'), 'test');

    const files = collectSourceFilesSync(skillsDir, 'skills/');
    expect(files).toHaveLength(1);
    expect(existsSync(files[0].absolutePath)).toBe(true);
  });
});

describe('buildManifestFromDirectory', () => {
  it('builds manifest from directory with multiple categories', () => {
    // Set up a mock cache directory
    mkdirSync(join(TEST_DIR, 'skills', 'beads'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'agents'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'skills', 'beads', 'SKILL.md'), 'beads content');
    writeFileSync(join(TEST_DIR, 'agents', 'code-reviewer.md'), 'reviewer content');

    const manifest = buildManifestFromDirectory(TEST_DIR, ['skills', 'agents'], 'panopticon');

    expect(manifest.installed['skills/beads/SKILL.md']).toBeDefined();
    expect(manifest.installed['skills/beads/SKILL.md'].source).toBe('panopticon');
    expect(manifest.installed['skills/beads/SKILL.md'].hash).toMatch(/^sha256:/);

    expect(manifest.installed['agents/code-reviewer.md']).toBeDefined();
    expect(manifest.installed['agents/code-reviewer.md'].source).toBe('panopticon');
  });

  it('skips nonexistent categories', () => {
    const manifest = buildManifestFromDirectory(TEST_DIR, ['skills', 'rules'], 'panopticon');
    expect(Object.keys(manifest.installed)).toHaveLength(0);
  });

  it('generates correct hashes', () => {
    mkdirSync(join(TEST_DIR, 'skills', 'test'), { recursive: true });
    const filePath = join(TEST_DIR, 'skills', 'test', 'SKILL.md');
    writeFileSync(filePath, 'test content');

    const manifest = buildManifestFromDirectory(TEST_DIR, ['skills'], 'panopticon');
    const expectedHash = hashFileSync(filePath);
    expect(manifest.installed['skills/test/SKILL.md'].hash).toBe(expectedHash);
  });
});
