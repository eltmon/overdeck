import { describe, it, expect, beforeEach, afterEach } from '@effect/vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Effect } from 'effect';
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem';
import {
  VBRIEF_LIFECYCLE_DIRS,
  ensureVBriefDirs,
  generateVBriefFilename,
  parseVBriefFilename,
  resolveVBriefDir,
  slugify,
} from '../lifecycle.js';

let TEST_DIR: string;

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'vbrief-lifecycle-'));
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('VBRIEF_LIFECYCLE_DIRS', () => {
  it('contains exactly the four lifecycle dirs in canonical order', () => {
    expect(VBRIEF_LIFECYCLE_DIRS).toEqual(['proposed', 'active', 'completed', 'cancelled']);
  });
});

describe('slugify', () => {
  it('lowercases and dashes', () => {
    expect(slugify('vBRIEF Lifecycle Foundation')).toBe('vbrief-lifecycle-foundation');
  });
  it('collapses repeated separators', () => {
    expect(slugify('foo___bar baz')).toBe('foo-bar-baz');
  });
  it('returns "plan" for empty input', () => {
    expect(slugify('!!!')).toBe('plan');
  });
});

describe('generateVBriefFilename', () => {
  it('produces YYYY-MM-DD-ISSUE-ID-slug.vbrief.json', () => {
    const fname = generateVBriefFilename('PAN-946', 'vbrief-lifecycle', '2026-05-03');
    expect(fname).toBe('2026-05-03-PAN-946-vbrief-lifecycle.vbrief.json');
  });
  it('accepts a Date object', () => {
    const fname = generateVBriefFilename('PAN-1', 'foo', new Date(Date.UTC(2026, 0, 5)));
    expect(fname).toBe('2026-01-05-PAN-1-foo.vbrief.json');
  });
  it('normalizes the slug', () => {
    const fname = generateVBriefFilename('PAN-100', 'Hello World!', '2026-05-03');
    expect(fname).toBe('2026-05-03-PAN-100-hello-world.vbrief.json');
  });
  it('rejects invalid issue IDs', () => {
    expect(() => generateVBriefFilename('not-an-issue', 'slug', '2026-05-03')).toThrow();
    expect(() => generateVBriefFilename('PAN-', 'slug', '2026-05-03')).toThrow();
  });
});

describe('parseVBriefFilename', () => {
  it('extracts parts from a canonical filename', () => {
    const parts = parseVBriefFilename('2026-05-03-PAN-946-vbrief-lifecycle.vbrief.json');
    expect(parts).toEqual({ date: '2026-05-03', issueId: 'PAN-946', slug: 'vbrief-lifecycle' });
  });
  it('returns null for non-matching filenames', () => {
    expect(parseVBriefFilename('plan.vbrief.json')).toBeNull();
    expect(parseVBriefFilename('continue-PAN-946.vbrief.json')).toBeNull();
    expect(parseVBriefFilename('random.json')).toBeNull();
  });
  it('round-trips with generateVBriefFilename', () => {
    const fname = generateVBriefFilename('PAN-946', 'foo-bar', '2026-05-03');
    const parts = parseVBriefFilename(fname);
    expect(parts).toEqual({ date: '2026-05-03', issueId: 'PAN-946', slug: 'foo-bar' });
  });
});

describe('resolveVBriefDir', () => {
  it('returns absolute path under projectRoot/vbrief/<dir>', () => {
    expect(resolveVBriefDir('/tmp/proj', 'active')).toBe('/tmp/proj/vbrief/active');
    expect(resolveVBriefDir('/tmp/proj', 'completed')).toBe('/tmp/proj/vbrief/completed');
  });
});

describe('ensureVBriefDirs', () => {
  it.effect('creates ./vbrief/{proposed,active,completed,cancelled}/ and returns root', () =>
    Effect.gen(function* () {
      const root = yield* ensureVBriefDirs(TEST_DIR);
      expect(root).toBe(join(TEST_DIR, 'vbrief'));
      for (const dir of VBRIEF_LIFECYCLE_DIRS) {
        expect(existsSync(join(root, dir))).toBe(true);
      }
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  it.effect('is idempotent', () =>
    Effect.gen(function* () {
      yield* ensureVBriefDirs(TEST_DIR);
      yield* ensureVBriefDirs(TEST_DIR);
    }).pipe(Effect.provide(NodeFileSystem.layer)),
  );
});
