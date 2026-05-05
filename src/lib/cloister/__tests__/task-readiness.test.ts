import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isTaskReady, getUnblockedItems } from '../task-readiness.js';
import { PAN_DIRNAME, PAN_SPEC_FILENAME } from '../../pan-dir/index.js';
import type { VBriefDocument } from '../../vbrief/types.js';

let TEST_DIR: string;

function writePlan(workspacePath: string, doc: VBriefDocument): void {
  const planDir = join(workspacePath, PAN_DIRNAME);
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, PAN_SPEC_FILENAME), JSON.stringify(doc));
}

function makeDoc(
  items: Array<{ id: string; status?: string }>,
  edges: Array<{ from: string; to: string; type?: string }>,
): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'TEST',
      title: 'Test',
      status: 'active',
      items: items.map(i => ({ id: i.id, title: i.id, status: (i.status ?? 'pending') as any })),
      edges: edges.map(e => ({ from: e.from, to: e.to, type: (e.type ?? 'blocks') as any })),
    },
  };
}

beforeEach(() => {
  TEST_DIR = join(tmpdir(), `task-readiness-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('isTaskReady', () => {
  it('returns true when no plan exists', () => {
    expect(isTaskReady('any-id', TEST_DIR)).toBe(true);
  });

  it('returns true for item with no blockers', () => {
    writePlan(TEST_DIR, makeDoc([{ id: 'a' }, { id: 'b' }], []));
    expect(isTaskReady('a', TEST_DIR)).toBe(true);
  });

  it('returns false when blocker is pending', () => {
    writePlan(TEST_DIR, makeDoc(
      [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }],
      [{ from: 'a', to: 'b' }],
    ));
    expect(isTaskReady('b', TEST_DIR)).toBe(false);
  });

  it('returns false when blocker is in_progress', () => {
    writePlan(TEST_DIR, makeDoc(
      [{ id: 'a', status: 'in_progress' }, { id: 'b', status: 'pending' }],
      [{ from: 'a', to: 'b' }],
    ));
    expect(isTaskReady('b', TEST_DIR)).toBe(false);
  });

  it('returns true when blocker is completed', () => {
    writePlan(TEST_DIR, makeDoc(
      [{ id: 'a', status: 'completed' }, { id: 'b', status: 'pending' }],
      [{ from: 'a', to: 'b' }],
    ));
    expect(isTaskReady('b', TEST_DIR)).toBe(true);
  });

  it('returns true when blocker is cancelled', () => {
    writePlan(TEST_DIR, makeDoc(
      [{ id: 'a', status: 'cancelled' }, { id: 'b', status: 'pending' }],
      [{ from: 'a', to: 'b' }],
    ));
    expect(isTaskReady('b', TEST_DIR)).toBe(true);
  });

  it('returns false when one of multiple blockers is not done', () => {
    writePlan(TEST_DIR, makeDoc(
      [
        { id: 'a', status: 'completed' },
        { id: 'b', status: 'pending' },
        { id: 'c', status: 'pending' },
      ],
      [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
    ));
    expect(isTaskReady('c', TEST_DIR)).toBe(false);
  });

  it('returns true when all of multiple blockers are done', () => {
    writePlan(TEST_DIR, makeDoc(
      [
        { id: 'a', status: 'completed' },
        { id: 'b', status: 'cancelled' },
        { id: 'c', status: 'pending' },
      ],
      [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
    ));
    expect(isTaskReady('c', TEST_DIR)).toBe(true);
  });

  it('ignores non-blocking edge types', () => {
    writePlan(TEST_DIR, makeDoc(
      [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }],
      [{ from: 'a', to: 'b', type: 'informs' }],
    ));
    // 'informs' edge should not block 'b'
    expect(isTaskReady('b', TEST_DIR)).toBe(true);
  });

  it('returns true for unknown blocker ID', () => {
    writePlan(TEST_DIR, makeDoc(
      [{ id: 'b', status: 'pending' }],
      [{ from: 'ghost', to: 'b' }],
    ));
    expect(isTaskReady('b', TEST_DIR)).toBe(true);
  });

  it('returns true for item ID not present in the plan (phantom item)', () => {
    writePlan(TEST_DIR, makeDoc(
      [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }],
      [{ from: 'a', to: 'b' }],
    ));
    // 'phantom' is not in the plan at all — should not be blocked
    expect(isTaskReady('phantom', TEST_DIR)).toBe(true);
  });
});

describe('getUnblockedItems', () => {
  it('returns [] when no plan exists', () => {
    expect(getUnblockedItems(TEST_DIR, 'any-id')).toEqual([]);
  });

  it('returns [] when completed item does not block anything', () => {
    writePlan(TEST_DIR, makeDoc([{ id: 'a', status: 'completed' }], []));
    expect(getUnblockedItems(TEST_DIR, 'a')).toEqual([]);
  });

  it('returns newly unblocked item when its only blocker completes', () => {
    writePlan(TEST_DIR, makeDoc(
      [{ id: 'a', status: 'completed' }, { id: 'b', status: 'pending' }],
      [{ from: 'a', to: 'b' }],
    ));
    expect(getUnblockedItems(TEST_DIR, 'a')).toEqual(['b']);
  });

  it('does not return item still blocked by other unfinished blockers', () => {
    writePlan(TEST_DIR, makeDoc(
      [
        { id: 'a', status: 'completed' },
        { id: 'x', status: 'pending' },
        { id: 'b', status: 'pending' },
      ],
      [{ from: 'a', to: 'b' }, { from: 'x', to: 'b' }],
    ));
    // 'a' completed but 'x' is still pending — 'b' is not unblocked
    expect(getUnblockedItems(TEST_DIR, 'a')).toEqual([]);
  });

  it('returns item when all other blockers are already terminal', () => {
    writePlan(TEST_DIR, makeDoc(
      [
        { id: 'a', status: 'completed' },
        { id: 'x', status: 'cancelled' },
        { id: 'b', status: 'pending' },
      ],
      [{ from: 'a', to: 'b' }, { from: 'x', to: 'b' }],
    ));
    expect(getUnblockedItems(TEST_DIR, 'a')).toEqual(['b']);
  });

  it('does not return already-completed items', () => {
    writePlan(TEST_DIR, makeDoc(
      [{ id: 'a', status: 'completed' }, { id: 'b', status: 'completed' }],
      [{ from: 'a', to: 'b' }],
    ));
    expect(getUnblockedItems(TEST_DIR, 'a')).toEqual([]);
  });

  it('returns multiple unblocked items', () => {
    writePlan(TEST_DIR, makeDoc(
      [
        { id: 'a', status: 'completed' },
        { id: 'b', status: 'pending' },
        { id: 'c', status: 'pending' },
      ],
      [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }],
    ));
    const result = getUnblockedItems(TEST_DIR, 'a');
    expect(result.sort()).toEqual(['b', 'c']);
  });
});
