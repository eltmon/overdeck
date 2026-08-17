import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  lookupSkipVerdict,
  recordSkipVerdict,
  type SkipVerdict,
} from '../../../../src/lib/costs/skip-cache.js';
import {
  closeOverdeckDatabaseSync,
  getOverdeckDatabaseSync,
} from '../../../../src/lib/overdeck/infra.js';

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-3743-skip-cache-'));
  process.env.OVERDECK_HOME = testHome;
});

afterEach(() => {
  closeOverdeckDatabaseSync();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('cost reconcile skip cache', () => {
  it('creates the file-state table with the expected columns', () => {
    const columns = getOverdeckDatabaseSync()
      .prepare('PRAGMA table_info(cost_reconcile_file_state)')
      .all() as Array<{ name: string }>;

    expect(columns.map(({ name }) => name)).toEqual(['path', 'mtime_ms', 'size', 'verdict']);
  });

  it('returns a recorded verdict for an exact file stat match', () => {
    recordSkipVerdict('/sessions/a.jsonl', 1_000, 200, 'no-usage');

    expect(lookupSkipVerdict('/sessions/a.jsonl', 1_000, 200)).toBe('no-usage');
  });

  it('returns null when the file mtime changes', () => {
    recordSkipVerdict('/sessions/a.jsonl', 1_000, 200, 'imported');

    expect(lookupSkipVerdict('/sessions/a.jsonl', 1_001, 200)).toBeNull();
  });

  it('returns null when the file size changes', () => {
    recordSkipVerdict('/sessions/a.jsonl', 1_000, 200, 'unknown-model');

    expect(lookupSkipVerdict('/sessions/a.jsonl', 1_000, 201)).toBeNull();
  });

  it('returns null for an unknown path', () => {
    expect(lookupSkipVerdict('/sessions/missing.jsonl', 1_000, 200)).toBeNull();
  });

  it('only admits terminal verdicts at the type boundary', () => {
    const verdicts = [
      'imported',
      'no-usage',
      'unknown-model',
      'unpriced-model',
    ] satisfies SkipVerdict[];

    expect(verdicts).toHaveLength(4);
    // @ts-expect-error Error outcomes must be retried and cannot be cached.
    const errorVerdict: SkipVerdict = 'error';
    // @ts-expect-error Unreadable files must be retried and cannot be cached.
    const unreadableVerdict: SkipVerdict = 'unreadable';
    expect([errorVerdict, unreadableVerdict]).toEqual(['error', 'unreadable']);
  });
});
