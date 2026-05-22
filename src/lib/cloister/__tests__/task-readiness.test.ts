import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isTaskReadySync, getUnblockedItemsSync } from '../task-readiness.js';
import type { VBriefDocument } from '../../vbrief/types.js';

let PROJECT_ROOT: string;
let WORKSPACE_PATH: string;
const ISSUE_ID = 'PAN-300';
const SPEC_FILENAME = '2026-01-01-PAN-300-test.vbrief.json';

function writePlan(doc: VBriefDocument): void {
  const specsDir = join(PROJECT_ROOT, '.pan', 'specs');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, SPEC_FILENAME), JSON.stringify({ ...doc, status: 'active' }, null, 2));
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
  PROJECT_ROOT = join(tmpdir(), `task-readiness-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  WORKSPACE_PATH = join(PROJECT_ROOT, 'workspaces', `feature-${ISSUE_ID.toLowerCase()}`);
  mkdirSync(WORKSPACE_PATH, { recursive: true });
});

afterEach(() => {
  rmSync(PROJECT_ROOT, { recursive: true, force: true });
});

describe('isTaskReady', () => {
  it('returns true when no plan exists', () => {
    expect(isTaskReadySync('any-id', WORKSPACE_PATH)).toBe(true);
  });

  it('returns true for item with no blockers', () => {
    writePlan(makeDoc([{ id: 'a' }, { id: 'b' }], []));
    expect(isTaskReadySync('a', WORKSPACE_PATH)).toBe(true);
  });

  it('returns false when blocker is pending', () => {
    writePlan(makeDoc(
      [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }],
      [{ from: 'a', to: 'b' }],
    ));
    expect(isTaskReadySync('b', WORKSPACE_PATH)).toBe(false);
  });

  it('returns false when blocker is in_progress', () => {
    writePlan(makeDoc(
      [{ id: 'a', status: 'in_progress' }, { id: 'b', status: 'pending' }],
      [{ from: 'a', to: 'b' }],
    ));
    expect(isTaskReadySync('b', WORKSPACE_PATH)).toBe(false);
  });

  it('returns true when blocker is completed', () => {
    writePlan(makeDoc(
      [{ id: 'a', status: 'completed' }, { id: 'b', status: 'pending' }],
      [{ from: 'a', to: 'b' }],
    ));
    expect(isTaskReadySync('b', WORKSPACE_PATH)).toBe(true);
  });

  it('returns true when blocker is cancelled', () => {
    writePlan(makeDoc(
      [{ id: 'a', status: 'cancelled' }, { id: 'b', status: 'pending' }],
      [{ from: 'a', to: 'b' }],
    ));
    expect(isTaskReadySync('b', WORKSPACE_PATH)).toBe(true);
  });

  it('returns false when one of multiple blockers is not done', () => {
    writePlan(makeDoc(
      [
        { id: 'a', status: 'completed' },
        { id: 'b', status: 'pending' },
        { id: 'c', status: 'pending' },
      ],
      [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
    ));
    expect(isTaskReadySync('c', WORKSPACE_PATH)).toBe(false);
  });

  it('returns true when all of multiple blockers are done', () => {
    writePlan(makeDoc(
      [
        { id: 'a', status: 'completed' },
        { id: 'b', status: 'cancelled' },
        { id: 'c', status: 'pending' },
      ],
      [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
    ));
    expect(isTaskReadySync('c', WORKSPACE_PATH)).toBe(true);
  });

  it('ignores non-blocking edge types', () => {
    writePlan(makeDoc(
      [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }],
      [{ from: 'a', to: 'b', type: 'informs' }],
    ));
    // 'informs' edge should not block 'b'
    expect(isTaskReadySync('b', WORKSPACE_PATH)).toBe(true);
  });

  it('returns true for unknown blocker ID', () => {
    writePlan(makeDoc(
      [{ id: 'b', status: 'pending' }],
      [{ from: 'ghost', to: 'b' }],
    ));
    expect(isTaskReadySync('b', WORKSPACE_PATH)).toBe(true);
  });

  it('returns true for item ID not present in the plan (phantom item)', () => {
    writePlan(makeDoc(
      [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }],
      [{ from: 'a', to: 'b' }],
    ));
    // 'phantom' is not in the plan at all — should not be blocked
    expect(isTaskReadySync('phantom', WORKSPACE_PATH)).toBe(true);
  });
});

describe('getUnblockedItems', () => {
  it('returns [] when no plan exists', () => {
    expect(getUnblockedItemsSync(WORKSPACE_PATH, 'any-id')).toEqual([]);
  });

  it('returns [] when completed item does not block anything', () => {
    writePlan(makeDoc([{ id: 'a', status: 'completed' }], []));
    expect(getUnblockedItemsSync(WORKSPACE_PATH, 'a')).toEqual([]);
  });

  it('returns newly unblocked item when its only blocker completes', () => {
    writePlan(makeDoc(
      [{ id: 'a', status: 'completed' }, { id: 'b', status: 'pending' }],
      [{ from: 'a', to: 'b' }],
    ));
    expect(getUnblockedItemsSync(WORKSPACE_PATH, 'a')).toEqual(['b']);
  });

  it('does not return item still blocked by other unfinished blockers', () => {
    writePlan(makeDoc(
      [
        { id: 'a', status: 'completed' },
        { id: 'x', status: 'pending' },
        { id: 'b', status: 'pending' },
      ],
      [{ from: 'a', to: 'b' }, { from: 'x', to: 'b' }],
    ));
    // 'a' completed but 'x' is still pending — 'b' is not unblocked
    expect(getUnblockedItemsSync(WORKSPACE_PATH, 'a')).toEqual([]);
  });

  it('returns item when all other blockers are already terminal', () => {
    writePlan(makeDoc(
      [
        { id: 'a', status: 'completed' },
        { id: 'x', status: 'cancelled' },
        { id: 'b', status: 'pending' },
      ],
      [{ from: 'a', to: 'b' }, { from: 'x', to: 'b' }],
    ));
    expect(getUnblockedItemsSync(WORKSPACE_PATH, 'a')).toEqual(['b']);
  });

  it('does not return already-completed items', () => {
    writePlan(makeDoc(
      [{ id: 'a', status: 'completed' }, { id: 'b', status: 'completed' }],
      [{ from: 'a', to: 'b' }],
    ));
    expect(getUnblockedItemsSync(WORKSPACE_PATH, 'a')).toEqual([]);
  });

  it('returns multiple unblocked items', () => {
    writePlan(makeDoc(
      [
        { id: 'a', status: 'completed' },
        { id: 'b', status: 'pending' },
        { id: 'c', status: 'pending' },
      ],
      [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }],
    ));
    const result = getUnblockedItemsSync(WORKSPACE_PATH, 'a');
    expect(result.sort()).toEqual(['b', 'c']);
  });
});
