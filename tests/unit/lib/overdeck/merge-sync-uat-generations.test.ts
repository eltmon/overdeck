/**
 * Tests for merge-sync.ts UAT generation functions (PAN-1938).
 *
 * Ports the existing uat-generations-db.test.ts logic onto overdeck.db via
 * setupOverdeckTestDb / teardownOverdeckTestDb. Asserts round-trip correctness
 * including ISO timestamp serialization of integer-stored timestamps.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';

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
} from '../../../../src/lib/overdeck/merge-sync.js';

let odb: OverdeckTestDb;

beforeEach(() => { odb = setupOverdeckTestDb(); });
afterEach(()  => { teardownOverdeckTestDb(odb); });

// ── seed an issue row (FK required by uat_generation_members) ─────────────────
function seedIssue(db: ReturnType<typeof odb.raw>, id: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, 'open', ?)",
  ).run(id, Date.now());
}

// ── helpers ───────────────────────────────────────────────────────────────────

let seq = 0;

function makeGeneration(
  overrides: Partial<UatGeneration> = {},
): Omit<UatGeneration, 'createdAt' | 'updatedAt'> & { createdAt?: string } {
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

// ── tests ─────────────────────────────────────────────────────────────────────

describe('insert + get round-trip', () => {
  it('round-trips members, heldOut, and resolutions across separate tables', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    seedIssue(db, 'PAN-2');
    seedIssue(db, 'PAN-3');

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
    expect(loaded!.cleanedAt).toBeNull();
  });

  it('serializes ISO timestamps correctly (not raw epoch integers)', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    seedIssue(db, 'PAN-2');

    const gen = makeGeneration({ createdAt: '2026-06-10T12:00:00.000Z' });
    insertUatGenerationSync(gen);

    const loaded = getUatGenerationSync(gen.name)!;
    // createdAt must round-trip as ISO string, not as a raw number
    expect(loaded.createdAt).toBe('2026-06-10T12:00:00.000Z');
    expect(typeof loaded.updatedAt).toBe('string');
    expect(loaded.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns null for an unknown name', () => {
    expect(getUatGenerationSync('uat/nope-0101')).toBeNull();
  });

  it('resets an existing deterministic daily generation on insert', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    seedIssue(db, 'PAN-2');
    seedIssue(db, 'PAN-3');

    const first = makeGeneration({
      name: 'uat/pan-otter-0610',
      status: 'ready',
      heldOut: [{ issueId: 'PAN-3', reason: 'old conflict' }],
      resolutions: [{ issueIds: ['PAN-2', 'PAN-1'], files: ['old.ts'], commitSha: 'old-sha' }],
    });
    insertUatGenerationSync(first);

    const replacement = makeGeneration({
      name: 'uat/pan-otter-0610',
      baseSha: 'new-main',
      status: 'assembling',
      members: [],
      heldOut: [],
      resolutions: [],
      createdAt: '2026-06-10T03:00:00.000Z',
    });
    insertUatGenerationSync(replacement);

    const loaded = getUatGenerationSync('uat/pan-otter-0610')!;
    expect(loaded.baseSha).toBe('new-main');
    expect(loaded.status).toBe('assembling');
    expect(loaded.members).toEqual([]);
    expect(loaded.heldOut).toEqual([]);
    expect(loaded.resolutions).toEqual([]);
    expect(loaded.createdAt).toBe('2026-06-10T03:00:00.000Z');
  });
});

describe('listUatGenerationsSync', () => {
  it('orders newest first by created_at', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    seedIssue(db, 'PAN-2');

    insertUatGenerationSync(makeGeneration({ name: 'uat/older-0610', createdAt: '2026-06-10T01:00:00.000Z' }));
    insertUatGenerationSync(makeGeneration({ name: 'uat/newer-0610', createdAt: '2026-06-10T02:00:00.000Z' }));

    const chain = listUatGenerationsSync();
    expect(chain.map((g) => g.name)).toEqual(['uat/newer-0610', 'uat/older-0610']);
  });

  it('filters by status and projectRoot', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    seedIssue(db, 'PAN-2');

    insertUatGenerationSync(makeGeneration({ name: 'uat/a-0610', status: 'ready' }));
    insertUatGenerationSync(makeGeneration({ name: 'uat/b-0610', status: 'invalidated' }));
    insertUatGenerationSync(makeGeneration({ name: 'uat/c-0610', status: 'ready', projectRoot: '/tmp/other' }));

    const ready = listUatGenerationsSync({ statuses: ['ready'], projectRoot: '/tmp/project' });
    expect(ready.map((g) => g.name)).toEqual(['uat/a-0610']);

    const live = listUatGenerationsSync({ statuses: ['ready', 'invalidated'] });
    expect(live).toHaveLength(3);
  });

  it('lists existing generation names', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    seedIssue(db, 'PAN-2');

    insertUatGenerationSync(makeGeneration({ name: 'uat/x-0610' }));
    insertUatGenerationSync(makeGeneration({ name: 'uat/y-0610' }));
    expect(listUatGenerationNamesSync().sort()).toEqual(['uat/x-0610', 'uat/y-0610']);
  });
});

describe('status transitions', () => {
  it('flips status and bumps updated_at', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    seedIssue(db, 'PAN-2');

    const gen = makeGeneration();
    insertUatGenerationSync(gen);

    updateUatGenerationStatusSync(gen.name, 'ready');
    expect(getUatGenerationSync(gen.name)!.status).toBe('ready');

    updateUatGenerationStatusSync(gen.name, 'superseded');
    expect(getUatGenerationSync(gen.name)!.status).toBe('superseded');

    updateUatGenerationStatusSync(gen.name, 'promoted');
    expect(getUatGenerationSync(gen.name)!.status).toBe('promoted');
  });

  it('throws for an unknown generation', () => {
    expect(() => updateUatGenerationStatusSync('uat/ghost-0101', 'ready')).toThrow();
  });
});

describe('updateUatGenerationSync patch', () => {
  it('patches members/heldOut/resolutions/status in one call', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    seedIssue(db, 'PAN-2');
    seedIssue(db, 'PAN-9');

    const gen = makeGeneration();
    insertUatGenerationSync(gen);

    updateUatGenerationSync(gen.name, {
      status: 'ready',
      heldOut: [{ issueId: 'PAN-9', branch: 'feature/pan-9', headSha: 'hhh999', reason: 'agent timeout' }],
      resolutions: [{ issueIds: ['PAN-2', 'PAN-1'], files: ['x.ts', 'y.ts'], commitSha: 'ddd444' }],
      cleanedAt: '2026-06-10T03:00:00.000Z',
    });

    const loaded = getUatGenerationSync(gen.name)!;
    expect(loaded.status).toBe('ready');
    expect(loaded.heldOut).toEqual([{ issueId: 'PAN-9', branch: 'feature/pan-9', headSha: 'hhh999', reason: 'agent timeout' }]);
    expect(loaded.resolutions[0]!.files).toEqual(['x.ts', 'y.ts']);
    expect(loaded.cleanedAt).toBe('2026-06-10T03:00:00.000Z');
    // untouched fields preserved
    expect(loaded.members).toHaveLength(2);
    expect(loaded.baseSha).toBe('abc123');
  });

  it('is a no-op with an empty patch', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    seedIssue(db, 'PAN-2');

    const gen = makeGeneration();
    insertUatGenerationSync(gen);
    expect(() => updateUatGenerationSync(gen.name, {})).not.toThrow();
  });
});

describe('stack state', () => {
  it('sets and clears stack_started_at, and lists running stacks oldest first', () => {
    const db = odb.raw();
    seedIssue(db, 'PAN-1');
    seedIssue(db, 'PAN-2');

    const a = makeGeneration({ name: 'uat/stack-a-0610' });
    const b = makeGeneration({ name: 'uat/stack-b-0610' });
    insertUatGenerationSync(a);
    insertUatGenerationSync(b);

    setUatGenerationStackStartedAtSync(a.name, '2026-06-10T02:00:00.000Z');
    setUatGenerationStackStartedAtSync(b.name, '2026-06-10T01:00:00.000Z');

    const running = listUatGenerationsWithStacksSync();
    expect(running.map((g) => g.name)).toEqual(['uat/stack-b-0610', 'uat/stack-a-0610']);

    // Verify stackStartedAt round-trips as ISO string
    expect(running[0]!.stackStartedAt).toBe('2026-06-10T01:00:00.000Z');

    setUatGenerationStackStartedAtSync(b.name, null);
    expect(listUatGenerationsWithStacksSync().map((g) => g.name)).toEqual(['uat/stack-a-0610']);
  });
});
