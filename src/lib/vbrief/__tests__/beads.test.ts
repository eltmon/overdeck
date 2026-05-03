import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { syncBeadStatusToVBrief, getVBriefACStatus } from '../beads.js';
import { readWorkspacePlan } from '../io.js';
import type { VBriefDocument } from '../types.js';

let TEST_DIR: string;

function writePlan(workspacePath: string, doc: VBriefDocument): void {
  const planDir = join(workspacePath, '.planning');
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, 'plan.vbrief.json'), JSON.stringify(doc));
}

function writeBeadsFile(workspacePath: string, beads: Array<{ id: string; title: string }>): void {
  const beadsDir = join(workspacePath, '.beads');
  mkdirSync(beadsDir, { recursive: true });
  const lines = beads.map(b => JSON.stringify({ id: b.id, title: b.title, status: 'open' }));
  writeFileSync(join(beadsDir, 'issues.jsonl'), lines.join('\n') + '\n');
}

function makePlanDoc(items: Array<{ id: string; title: string; status?: string }>): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'PAN-388',
      title: 'Test Plan',
      status: 'active',
      items: items.map(i => ({ id: i.id, title: i.title, status: (i.status ?? 'pending') as any })),
      edges: [],
    },
  };
}

beforeEach(() => {
  TEST_DIR = join(tmpdir(), `beads-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('syncBeadStatusToVBrief', () => {
  it('returns null when no plan exists', () => {
    writeBeadsFile(TEST_DIR, [{ id: 'bead-1', title: 'Some task' }]);
    expect(syncBeadStatusToVBrief('bead-1', TEST_DIR)).toBeNull();
  });

  it('returns null when .beads/issues.jsonl does not exist', () => {
    writePlan(TEST_DIR, makePlanDoc([{ id: 'item-1', title: 'Some task' }]));
    expect(syncBeadStatusToVBrief('bead-1', TEST_DIR)).toBeNull();
  });

  it('returns null when bead ID not found in issues.jsonl', () => {
    writePlan(TEST_DIR, makePlanDoc([{ id: 'item-1', title: 'Some task' }]));
    writeBeadsFile(TEST_DIR, [{ id: 'other-bead', title: 'PAN-388: Some task' }]);
    expect(syncBeadStatusToVBrief('bead-1', TEST_DIR)).toBeNull();
  });

  it('returns null when no matching vBRIEF item found', () => {
    writePlan(TEST_DIR, makePlanDoc([{ id: 'item-1', title: 'Different title' }]));
    writeBeadsFile(TEST_DIR, [{ id: 'bead-1', title: 'PAN-388: No match here' }]);
    expect(syncBeadStatusToVBrief('bead-1', TEST_DIR)).toBeNull();
  });

  it('syncs status when bead title matches with plan prefix', () => {
    const doc = makePlanDoc([{ id: 'item-1', title: 'Wire the pipeline' }]);
    writePlan(TEST_DIR, doc);

    const result = syncBeadStatusToVBrief('bead-1', TEST_DIR, 'completed', 'PAN-388: Wire the pipeline');
    expect(result).toBe('item-1');

    const updated = readWorkspacePlan(TEST_DIR)!;
    expect(updated.plan.items[0].status).toBe('completed');
  });

  it('syncs status when bead title matches without plan prefix', () => {
    writePlan(TEST_DIR, makePlanDoc([{ id: 'item-2', title: 'Wire the pipeline' }]));

    const result = syncBeadStatusToVBrief('bead-2', TEST_DIR, 'completed', 'Wire the pipeline');
    expect(result).toBe('item-2');
  });

  it('uses in_progress status when specified', () => {
    writePlan(TEST_DIR, makePlanDoc([{ id: 'item-3', title: 'Start work' }]));

    syncBeadStatusToVBrief('bead-3', TEST_DIR, 'in_progress', 'PAN-388: Start work');

    const updated = readWorkspacePlan(TEST_DIR)!;
    expect(updated.plan.items[0].status).toBe('in_progress');
  });

  it('matching is case-insensitive', () => {
    writePlan(TEST_DIR, makePlanDoc([{ id: 'item-4', title: 'Wire The Pipeline' }]));

    const result = syncBeadStatusToVBrief('bead-4', TEST_DIR, 'completed', 'PAN-388: wire the pipeline');
    expect(result).toBe('item-4');
  });

  it('handles malformed lines in issues.jsonl gracefully', () => {
    writePlan(TEST_DIR, makePlanDoc([{ id: 'item-1', title: 'Good task' }]));

    const result = syncBeadStatusToVBrief('bead-1', TEST_DIR, 'completed', 'PAN-388: Good task');
    expect(result).toBe('item-1');
  });
});

describe('getVBriefACStatus', () => {
  function makePlanWithAC(items: Array<{
    id: string;
    title: string;
    subItems?: Array<{ id: string; title: string; status?: string; kind?: string }>;
  }>): VBriefDocument {
    return {
      vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
      plan: {
        id: 'TEST',
        title: 'Test Plan',
        status: 'approved',
        items: items.map(i => ({
          id: i.id,
          title: i.title,
          status: 'pending' as const,
          subItems: i.subItems?.map(s => ({
            id: s.id,
            title: s.title,
            status: (s.status ?? 'pending') as any,
            metadata: { kind: s.kind ?? 'acceptance_criterion' },
          })),
        })),
        edges: [],
      },
    };
  }

  it('returns null when no plan exists', () => {
    expect(getVBriefACStatus(TEST_DIR)).toBeNull();
  });

  it('returns null when plan has no AC subItems', () => {
    writePlan(TEST_DIR, makePlanWithAC([{ id: 'item-1', title: 'Task' }]));
    expect(getVBriefACStatus(TEST_DIR)).toBeNull();
  });

  it('returns structured status for items with AC', () => {
    const doc = makePlanWithAC([{
      id: 'item-1',
      title: 'Build module',
      subItems: [
        { id: 'item-1.ac1', title: 'Function exists', status: 'completed' },
        { id: 'item-1.ac2', title: 'Tests pass', status: 'pending' },
      ],
    }]);
    writePlan(TEST_DIR, doc);

    const result = getVBriefACStatus(TEST_DIR)!;
    expect(result).not.toBeNull();
    expect(result.allCompleted).toBe(false);
    expect(result.totalCompleted).toBe(1);
    expect(result.totalPending).toBe(1);
    expect(result.totalCount).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].itemId).toBe('item-1');
    expect(result.items[0].completed).toBe(1);
    expect(result.items[0].pending).toBe(1);
  });

  it('returns allCompleted=true when all AC are completed', () => {
    const doc = makePlanWithAC([{
      id: 'item-1',
      title: 'Task',
      subItems: [
        { id: 'item-1.ac1', title: 'Done', status: 'completed' },
        { id: 'item-1.ac2', title: 'Also done', status: 'completed' },
      ],
    }]);
    writePlan(TEST_DIR, doc);

    const result = getVBriefACStatus(TEST_DIR)!;
    expect(result.allCompleted).toBe(true);
    expect(result.totalPending).toBe(0);
  });

  it('treats cancelled AC as completed', () => {
    const doc = makePlanWithAC([{
      id: 'item-1',
      title: 'Task',
      subItems: [
        { id: 'item-1.ac1', title: 'Done', status: 'completed' },
        { id: 'item-1.ac2', title: 'Cancelled', status: 'cancelled' },
      ],
    }]);
    writePlan(TEST_DIR, doc);

    const result = getVBriefACStatus(TEST_DIR)!;
    expect(result.allCompleted).toBe(true);
  });

  it('aggregates across multiple items', () => {
    const doc = makePlanWithAC([
      {
        id: 'item-1',
        title: 'First',
        subItems: [{ id: 'item-1.ac1', title: 'A', status: 'completed' }],
      },
      {
        id: 'item-2',
        title: 'Second',
        subItems: [{ id: 'item-2.ac1', title: 'B', status: 'pending' }],
      },
    ]);
    writePlan(TEST_DIR, doc);

    const result = getVBriefACStatus(TEST_DIR)!;
    expect(result.allCompleted).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.totalCompleted).toBe(1);
    expect(result.totalPending).toBe(1);
  });
});
