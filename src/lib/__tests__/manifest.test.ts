/**
 * Tests for manifest read/write/compare utilities (PAN-266)
 * Migrated to @effect/vitest as part of PAN-1249 wave-0.
 */

import { describe, beforeEach, afterEach, expect } from '@effect/vitest';
import { it } from '@effect/vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Effect } from 'effect';
import {
  hashFile,
  createEmptyManifest,
  readManifest,
  writeManifest,
  setManifestEntry,
  removeManifestEntry,
  compareFileToManifest,
  collectSourceFiles,
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
  it.effect('returns sha256-prefixed hash', () =>
    Effect.gen(function* () {
      const filePath = join(TEST_DIR, 'test.md');
      writeFileSync(filePath, 'hello world');
      const hash = yield* hashFile(filePath);
      expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    }),
  );

  it.effect('returns consistent hashes for same content', () =>
    Effect.gen(function* () {
      const file1 = join(TEST_DIR, 'a.md');
      const file2 = join(TEST_DIR, 'b.md');
      writeFileSync(file1, 'same content');
      writeFileSync(file2, 'same content');
      const hash1 = yield* hashFile(file1);
      const hash2 = yield* hashFile(file2);
      expect(hash1).toBe(hash2);
    }),
  );

  it.effect('returns different hashes for different content', () =>
    Effect.gen(function* () {
      const file1 = join(TEST_DIR, 'a.md');
      const file2 = join(TEST_DIR, 'b.md');
      writeFileSync(file1, 'content A');
      writeFileSync(file2, 'content B');
      const hash1 = yield* hashFile(file1);
      const hash2 = yield* hashFile(file2);
      expect(hash1).not.toBe(hash2);
    }),
  );
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
  it.effect('round-trips a manifest', () =>
    Effect.gen(function* () {
      const manifestPath = join(TEST_DIR, '.panopticon-manifest.json');
      const manifest = createEmptyManifest();
      setManifestEntry(manifest, 'skills/beads/SKILL.md', 'sha256:abc123', 'panopticon');

      yield* writeManifest(manifestPath, manifest);
      const loaded = yield* readManifest(manifestPath);

      expect(loaded.version).toBe(1);
      expect(loaded.managed_by).toBe('panopticon');
      expect(loaded.installed['skills/beads/SKILL.md'].hash).toBe('sha256:abc123');
      expect(loaded.installed['skills/beads/SKILL.md'].source).toBe('panopticon');
    }),
  );

  it.effect('returns empty manifest for nonexistent file', () =>
    Effect.gen(function* () {
      const m = yield* readManifest(join(TEST_DIR, 'does-not-exist.json'));
      expect(m.installed).toEqual({});
    }),
  );

  it.effect('fails with ConfigParseError for invalid JSON', () =>
    Effect.gen(function* () {
      const manifestPath = join(TEST_DIR, 'bad.json');
      writeFileSync(manifestPath, 'not json!!!');
      const err = yield* readManifest(manifestPath).pipe(Effect.flip);
      expect(err._tag).toBe('ConfigParseError');
    }),
  );

  it.effect('returns empty manifest for wrong schema', () =>
    Effect.gen(function* () {
      const manifestPath = join(TEST_DIR, 'wrong.json');
      writeFileSync(manifestPath, JSON.stringify({ version: 99, other: true }));
      const m = yield* readManifest(manifestPath);
      expect(m.installed).toEqual({});
    }),
  );

  it.effect('creates parent directories when writing', () =>
    Effect.gen(function* () {
      const manifestPath = join(TEST_DIR, 'deep', 'nested', 'manifest.json');
      yield* writeManifest(manifestPath, createEmptyManifest());
      expect(existsSync(manifestPath)).toBe(true);
    }),
  );
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

  it.effect('returns "new" when file does not exist', () =>
    Effect.gen(function* () {
      const result = yield* compareFileToManifest(
        join(TEST_DIR, 'nonexistent.md'),
        'skills/foo/SKILL.md',
        manifest,
      );
      expect(result.action).toBe('new');
    }),
  );

  it.effect('returns "user-owned" when file exists but not in manifest', () =>
    Effect.gen(function* () {
      const filePath = join(TEST_DIR, 'user-file.md');
      writeFileSync(filePath, 'user content');
      const result = yield* compareFileToManifest(filePath, 'skills/user/SKILL.md', manifest);
      expect(result.action).toBe('user-owned');
    }),
  );

  it.effect('returns "update" when file hash matches manifest', () =>
    Effect.gen(function* () {
      const filePath = join(TEST_DIR, 'managed.md');
      writeFileSync(filePath, 'managed content');
      const hash = yield* hashFile(filePath);
      setManifestEntry(manifest, 'skills/managed/SKILL.md', hash, 'panopticon');

      const result = yield* compareFileToManifest(filePath, 'skills/managed/SKILL.md', manifest);
      expect(result.action).toBe('update');
    }),
  );

  it.effect('returns "modified" when file hash differs from manifest', () =>
    Effect.gen(function* () {
      const filePath = join(TEST_DIR, 'modified.md');
      writeFileSync(filePath, 'original content');
      const originalHash = yield* hashFile(filePath);
      setManifestEntry(manifest, 'skills/mod/SKILL.md', originalHash, 'panopticon');

      // User modifies the file
      writeFileSync(filePath, 'user modified this');

      const result = yield* compareFileToManifest(filePath, 'skills/mod/SKILL.md', manifest);
      expect(result.action).toBe('modified');
      if (result.action === 'modified') {
        expect(result.manifestHash).toBe(originalHash);
        expect(result.currentHash).not.toBe(originalHash);
      }
    }),
  );
});

describe('collectSourceFiles', () => {
  it.effect('collects files recursively with prefix', () =>
    Effect.gen(function* () {
      const skillsDir = join(TEST_DIR, 'skills');
      mkdirSync(join(skillsDir, 'beads'), { recursive: true });
      mkdirSync(join(skillsDir, 'pan-help'), { recursive: true });
      writeFileSync(join(skillsDir, 'beads', 'SKILL.md'), 'beads skill');
      writeFileSync(join(skillsDir, 'pan-help', 'SKILL.md'), 'help skill');
      writeFileSync(join(skillsDir, 'pan-help', 'README.md'), 'readme');

      const files = yield* collectSourceFiles(skillsDir, 'skills/');
      const paths = files.map(f => f.relativePath).sort();

      expect(paths).toEqual([
        'skills/beads/SKILL.md',
        'skills/pan-help/README.md',
        'skills/pan-help/SKILL.md',
      ]);
    }),
  );

  it.effect('returns empty array for nonexistent directory', () =>
    Effect.gen(function* () {
      const files = yield* collectSourceFiles(join(TEST_DIR, 'nope'), 'skills/');
      expect(files).toEqual([]);
    }),
  );

  it.effect('returns absolute paths that exist', () =>
    Effect.gen(function* () {
      const skillsDir = join(TEST_DIR, 'skills');
      mkdirSync(join(skillsDir, 'test'), { recursive: true });
      writeFileSync(join(skillsDir, 'test', 'SKILL.md'), 'test');

      const files = yield* collectSourceFiles(skillsDir, 'skills/');
      expect(files).toHaveLength(1);
      expect(existsSync(files[0].absolutePath)).toBe(true);
    }),
  );
});

describe('buildManifestFromDirectory', () => {
  it.effect('builds manifest from directory with multiple categories', () =>
    Effect.gen(function* () {
      mkdirSync(join(TEST_DIR, 'skills', 'beads'), { recursive: true });
      mkdirSync(join(TEST_DIR, 'agents'), { recursive: true });
      writeFileSync(join(TEST_DIR, 'skills', 'beads', 'SKILL.md'), 'beads content');
      writeFileSync(join(TEST_DIR, 'agents', 'code-reviewer.md'), 'reviewer content');

      const manifest = yield* buildManifestFromDirectory(TEST_DIR, ['skills', 'agents'], 'panopticon');

      expect(manifest.installed['skills/beads/SKILL.md']).toBeDefined();
      expect(manifest.installed['skills/beads/SKILL.md'].source).toBe('panopticon');
      expect(manifest.installed['skills/beads/SKILL.md'].hash).toMatch(/^sha256:/);

      expect(manifest.installed['agents/code-reviewer.md']).toBeDefined();
      expect(manifest.installed['agents/code-reviewer.md'].source).toBe('panopticon');
    }),
  );

  it.effect('skips nonexistent categories', () =>
    Effect.gen(function* () {
      const manifest = yield* buildManifestFromDirectory(TEST_DIR, ['skills', 'rules'], 'panopticon');
      expect(Object.keys(manifest.installed)).toHaveLength(0);
    }),
  );

  it.effect('generates correct hashes', () =>
    Effect.gen(function* () {
      mkdirSync(join(TEST_DIR, 'skills', 'test'), { recursive: true });
      const filePath = join(TEST_DIR, 'skills', 'test', 'SKILL.md');
      writeFileSync(filePath, 'test content');

      const manifest = yield* buildManifestFromDirectory(TEST_DIR, ['skills'], 'panopticon');
      const expectedHash = yield* hashFile(filePath);
      expect(manifest.installed['skills/test/SKILL.md'].hash).toBe(expectedHash);
    }),
  );
});
