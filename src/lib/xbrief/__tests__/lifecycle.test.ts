import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  VBRIEF_LIFECYCLE_DIRS,
  ensureXBriefDirsSync,
  generateXBriefFilename,
  isXBriefFilename,
  parseXBriefFilename,
  resolveXBriefDir,
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

describe('generateXBriefFilename', () => {
  it('produces YYYY-MM-DD-ISSUE-ID-slug.xbrief.json', () => {
    const fname = generateXBriefFilename('PAN-946', 'vbrief-lifecycle', '2026-05-03');
    expect(fname).toBe('2026-05-03-PAN-946-vbrief-lifecycle.xbrief.json');
  });
  it('accepts a Date object', () => {
    const fname = generateXBriefFilename('PAN-1', 'foo', new Date(Date.UTC(2026, 0, 5)));
    expect(fname).toBe('2026-01-05-PAN-1-foo.xbrief.json');
  });
  it('normalizes the slug', () => {
    const fname = generateXBriefFilename('PAN-100', 'Hello World!', '2026-05-03');
    expect(fname).toBe('2026-05-03-PAN-100-hello-world.xbrief.json');
  });
  it('rejects invalid issue IDs', () => {
    expect(() => generateXBriefFilename('not-an-issue', 'slug', '2026-05-03')).toThrow();
    expect(() => generateXBriefFilename('PAN-', 'slug', '2026-05-03')).toThrow();
  });
  it('normalizes a lowercase issue ID to uppercase (PAN-1050)', () => {
    const fname = generateXBriefFilename('pan-1194', 'foo', '2026-05-18');
    expect(fname).toBe('2026-05-18-PAN-1194-foo.xbrief.json');
  });
});

describe('isXBriefFilename', () => {
  it.each([
    '2026-05-03-PAN-946-vbrief-lifecycle.vbrief.json',
    '2026-05-03-PAN-946-vbrief-lifecycle.xbrief.json',
  ])('accepts %s', (filename) => {
    expect(isXBriefFilename(filename)).toBe(true);
  });

  it('rejects unrelated JSON files', () => {
    expect(isXBriefFilename('plan.json')).toBe(false);
  });
});

describe('parseXBriefFilename', () => {
  it.each([
    '2026-05-03-PAN-946-vbrief-lifecycle.vbrief.json',
    '2026-05-03-PAN-946-vbrief-lifecycle.xbrief.json',
  ])('extracts parts from %s', (filename) => {
    const parts = parseXBriefFilename(filename);
    expect(parts).toEqual({ date: '2026-05-03', issueId: 'PAN-946', slug: 'vbrief-lifecycle' });
  });
  it('returns null for non-matching filenames', () => {
    expect(parseXBriefFilename('plan.vbrief.json')).toBeNull();
    expect(parseXBriefFilename('continue-PAN-946.vbrief.json')).toBeNull();
    expect(parseXBriefFilename('random.json')).toBeNull();
  });
  it('round-trips with generateXBriefFilename', () => {
    const fname = generateXBriefFilename('PAN-946', 'foo-bar', '2026-05-03');
    const parts = parseXBriefFilename(fname);
    expect(parts).toEqual({ date: '2026-05-03', issueId: 'PAN-946', slug: 'foo-bar' });
  });
});

describe('resolveXBriefDir', () => {
  it('returns absolute path under projectRoot/vbrief/<dir>', () => {
    expect(resolveXBriefDir('/tmp/proj', 'active')).toBe('/tmp/proj/vbrief/active');
    expect(resolveXBriefDir('/tmp/proj', 'completed')).toBe('/tmp/proj/vbrief/completed');
  });
});

describe('ensureXBriefDirs', () => {
  it('creates ./vbrief/{proposed,active,completed,cancelled}/ and returns root', () => {
    const root = ensureXBriefDirsSync(TEST_DIR);
    expect(root).toBe(join(TEST_DIR, 'vbrief'));
    for (const dir of VBRIEF_LIFECYCLE_DIRS) {
      expect(existsSync(join(root, dir))).toBe(true);
    }
  });
  it('is idempotent', () => {
    ensureXBriefDirsSync(TEST_DIR);
    expect(() => ensureXBriefDirsSync(TEST_DIR)).not.toThrow();
  });
});
