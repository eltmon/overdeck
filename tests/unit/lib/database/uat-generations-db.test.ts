/**
 * Tests for uat-generations-db.ts (PAN-1737 UAT batch trains).
 * Uses an in-memory SQLite database injected via vi.mock, matching
 * review-status-db.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../../../../src/lib/database/schema.js';

// ============== In-memory DB injection ==============

let testDb: Database.Database;

vi.mock('../../../../src/lib/database/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../src/lib/database/index.js')>();
  return {
    ...original,
    getDatabase: () => testDb,
  };
});

beforeEach(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

// ============== Imports (after mock is set up) ==============

import {
  insertUatGenerationSync,
  getUatGenerationSync,
  listUatGenerationsSync,
  listUatGenerationNamesSync,
  listUatGenerationsWithStacksSync,
  updateUatGenerationStatusSync,
  updateUatGenerationSync,
  setUatGenerationStackStartedAtSync,
  type UatGeneration,
} from '../../../../src/lib/database/uat-generations-db.js';

// ============== Helpers ==============

let seq = 0;

function makeGeneration(overrides: Partial<UatGeneration> = {}): Omit<UatGeneration, 'createdAt' | 'updatedAt'> & { createdAt?: string } {
  seq += 1;
  return {
    name: `uat/test-gen-${seq}-0610`,
    worktreePath: `/tmp/workspaces/uat-test-gen-${seq}-0610`,
    projectRoot: '/tmp/project',
    baseSha: 'abc123',
    status: 'assembling',
    members: [
      { issueId: 'PAN-1', title: 'First feature', branch: 'feature/pan-1', headSha: 'aaa111', mergeOrder: 1 },
      { issueId: 'PAN-2', title: 'Second feature', branch: 'feature/pan-2', headSha: 'bbb222', mergeOrder: 2, pr: 42, prUrl: 'https://github.com/o/r/pull/42' },
    ],
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    ...overrides,
  };
}

// ============== Tests ==============

describe('insert + get round-trip', () => {
  it('round-trips members, heldOut, and resolutions JSON', () => {
    const gen = makeGeneration({
      heldOut: [{ issueId: 'PAN-3', reason: 'conflict with PAN-1 could not be resolved' }],
      resolutions: [{ issueIds: ['PAN-2', 'PAN-1'], files: ['src/a.ts'], commitSha: 'ccc333' }],
    });
    insertUatGenerationSync(gen);

    const loaded = getUatGenerationSync(gen.name);
    expect(loaded).not.toBeNull();
    expect(loaded!.members).toHaveLength(2);
    expect(loaded!.members[1]).toMatchObject({ issueId: 'PAN-2', pr: 42, mergeOrder: 2 });
    expect(loaded!.heldOut).toEqual([{ issueId: 'PAN-3', reason: 'conflict with PAN-1 could not be resolved' }]);
    expect(loaded!.resolutions).toEqual([{ issueIds: ['PAN-2', 'PAN-1'], files: ['src/a.ts'], commitSha: 'ccc333' }]);
    expect(loaded!.baseSha).toBe('abc123');
    expect(loaded!.status).toBe('assembling');
    expect(loaded!.stackStartedAt).toBeNull();
  });

  it('returns null for an unknown name', () => {
    expect(getUatGenerationSync('uat/nope-0101')).toBeNull();
  });
});

describe('listUatGenerationsSync', () => {
  it('orders newest first by created_at', () => {
    insertUatGenerationSync(makeGeneration({ name: 'uat/older-0610', createdAt: '2026-06-10T01:00:00.000Z' }));
    insertUatGenerationSync(makeGeneration({ name: 'uat/newer-0610', createdAt: '2026-06-10T02:00:00.000Z' }));

    const chain = listUatGenerationsSync();
    expect(chain.map((g) => g.name)).toEqual(['uat/newer-0610', 'uat/older-0610']);
  });

  it('filters by status and projectRoot', () => {
    insertUatGenerationSync(makeGeneration({ name: 'uat/a-0610', status: 'ready' }));
    insertUatGenerationSync(makeGeneration({ name: 'uat/b-0610', status: 'invalidated' }));
    insertUatGenerationSync(makeGeneration({ name: 'uat/c-0610', status: 'ready', projectRoot: '/tmp/other' }));

    const ready = listUatGenerationsSync({ statuses: ['ready'], projectRoot: '/tmp/project' });
    expect(ready.map((g) => g.name)).toEqual(['uat/a-0610']);

    const live = listUatGenerationsSync({ statuses: ['ready', 'invalidated'] });
    expect(live).toHaveLength(3);
  });

  it('lists all names for collision checks', () => {
    insertUatGenerationSync(makeGeneration({ name: 'uat/x-0610' }));
    insertUatGenerationSync(makeGeneration({ name: 'uat/y-0610' }));
    expect(listUatGenerationNamesSync().sort()).toEqual(['uat/x-0610', 'uat/y-0610']);
  });
});

describe('status transitions', () => {
  it('flips status and bumps updated_at', () => {
    const gen = makeGeneration();
    insertUatGenerationSync(gen);

    updateUatGenerationStatusSync(gen.name, 'ready');
    expect(getUatGenerationSync(gen.name)!.status).toBe('ready');

    updateUatGenerationStatusSync(gen.name, 'superseded');
    expect(getUatGenerationSync(gen.name)!.status).toBe('superseded');

    updateUatGenerationStatusSync(gen.name, 'promoted');
    expect(getUatGenerationSync(gen.name)!.status).toBe('promoted');
  });

  it('throws DatabaseError for an unknown generation', () => {
    expect(() => updateUatGenerationStatusSync('uat/ghost-0101', 'ready')).toThrow();
  });
});

describe('updateUatGenerationSync patch', () => {
  it('patches members/heldOut/resolutions/status in one call', () => {
    const gen = makeGeneration();
    insertUatGenerationSync(gen);

    updateUatGenerationSync(gen.name, {
      status: 'ready',
      heldOut: [{ issueId: 'PAN-9', reason: 'agent timeout' }],
      resolutions: [{ issueIds: ['PAN-2', 'PAN-1'], files: ['x.ts', 'y.ts'], commitSha: 'ddd444' }],
    });

    const loaded = getUatGenerationSync(gen.name)!;
    expect(loaded.status).toBe('ready');
    expect(loaded.heldOut).toEqual([{ issueId: 'PAN-9', reason: 'agent timeout' }]);
    expect(loaded.resolutions[0]!.files).toEqual(['x.ts', 'y.ts']);
    // untouched fields preserved
    expect(loaded.members).toHaveLength(2);
    expect(loaded.baseSha).toBe('abc123');
  });

  it('is a no-op with an empty patch', () => {
    const gen = makeGeneration();
    insertUatGenerationSync(gen);
    expect(() => updateUatGenerationSync(gen.name, {})).not.toThrow();
  });
});

describe('stack state', () => {
  it('sets and clears stack_started_at, and lists running stacks oldest first', () => {
    const a = makeGeneration({ name: 'uat/stack-a-0610' });
    const b = makeGeneration({ name: 'uat/stack-b-0610' });
    insertUatGenerationSync(a);
    insertUatGenerationSync(b);

    setUatGenerationStackStartedAtSync(a.name, '2026-06-10T02:00:00.000Z');
    setUatGenerationStackStartedAtSync(b.name, '2026-06-10T01:00:00.000Z');

    const running = listUatGenerationsWithStacksSync();
    expect(running.map((g) => g.name)).toEqual(['uat/stack-b-0610', 'uat/stack-a-0610']);

    setUatGenerationStackStartedAtSync(b.name, null);
    expect(listUatGenerationsWithStacksSync().map((g) => g.name)).toEqual(['uat/stack-a-0610']);
  });
});
