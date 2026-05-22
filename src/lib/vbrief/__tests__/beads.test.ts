import { Effect } from 'effect';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { syncBeadStatusToVBrief, getVBriefACStatusSync } from '../beads.js';
import { readWorkspacePlanSync } from '../io.js';
import type { VBriefDocument } from '../types.js';

let PROJECT_ROOT: string;
let WORKSPACE_PATH: string;
const ISSUE_ID = 'PAN-388';
const SPEC_FILENAME = '2026-01-01-PAN-388-test-plan.vbrief.json';

function writePlan(doc: VBriefDocument): void {
  const specsDir = join(PROJECT_ROOT, '.pan', 'specs');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, SPEC_FILENAME), JSON.stringify({ ...doc, status: 'active' }, null, 2));
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
  PROJECT_ROOT = join(tmpdir(), `beads-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  WORKSPACE_PATH = join(PROJECT_ROOT, 'workspaces', `feature-${ISSUE_ID.toLowerCase()}`);
  mkdirSync(WORKSPACE_PATH, { recursive: true });
});

afterEach(() => {
  rmSync(PROJECT_ROOT, { recursive: true, force: true });
});

describe('syncBeadStatusToVBrief', () => {
  it('returns null when no plan exists', async () => {
    writeBeadsFile(WORKSPACE_PATH, [{ id: 'bead-1', title: 'Some task' }]);
    expect(await Effect.runPromise(syncBeadStatusToVBrief('bead-1', WORKSPACE_PATH))).toBeNull();
  });

  it('returns null when .beads/issues.jsonl does not exist', async () => {
    writePlan(makePlanDoc([{ id: 'item-1', title: 'Some task' }]));
    expect(await Effect.runPromise(syncBeadStatusToVBrief('bead-1', WORKSPACE_PATH))).toBeNull();
  });

  it('returns null when bead ID not found in issues.jsonl', async () => {
    writePlan(makePlanDoc([{ id: 'item-1', title: 'Some task' }]));
    writeBeadsFile(WORKSPACE_PATH, [{ id: 'other-bead', title: 'PAN-388: Some task' }]);
    expect(await Effect.runPromise(syncBeadStatusToVBrief('bead-1', WORKSPACE_PATH))).toBeNull();
  });

  it('returns null when no matching vBRIEF item found', async () => {
    writePlan(makePlanDoc([{ id: 'item-1', title: 'Different title' }]));
    writeBeadsFile(WORKSPACE_PATH, [{ id: 'bead-1', title: 'PAN-388: No match here' }]);
    expect(await Effect.runPromise(syncBeadStatusToVBrief('bead-1', WORKSPACE_PATH))).toBeNull();
  });

  it('syncs status when bead title matches with plan prefix', async () => {
    const doc = makePlanDoc([{ id: 'item-1', title: 'Wire the pipeline' }]);
    writePlan(doc);
    writeBeadsFile(WORKSPACE_PATH, [{ id: 'bead-1', title: 'PAN-388: Wire the pipeline' }]);

    const result = await Effect.runPromise(syncBeadStatusToVBrief('bead-1', WORKSPACE_PATH));
    expect(result).toBe('item-1');

    const updated = readWorkspacePlanSync(WORKSPACE_PATH)!;
    expect(updated.plan.items[0].status).toBe('completed');
  });

  it('syncs status when bead title has a lowercase plan prefix', async () => {
    writePlan(makePlanDoc([{ id: 'item-lowercase-prefix', title: 'Wire the pipeline' }]));
    writeBeadsFile(WORKSPACE_PATH, [{ id: 'bead-lowercase-prefix', title: 'pan-388: Wire the pipeline' }]);

    const result = await Effect.runPromise(syncBeadStatusToVBrief('bead-lowercase-prefix', WORKSPACE_PATH));
    expect(result).toBe('item-lowercase-prefix');
  });

  it('syncs status when bead title matches without plan prefix', async () => {
    writePlan(makePlanDoc([{ id: 'item-2', title: 'Wire the pipeline' }]));
    writeBeadsFile(WORKSPACE_PATH, [{ id: 'bead-2', title: 'Wire the pipeline' }]);

    const result = await Effect.runPromise(syncBeadStatusToVBrief('bead-2', WORKSPACE_PATH));
    expect(result).toBe('item-2');
  });

  it('uses in_progress status when specified', async () => {
    writePlan(makePlanDoc([{ id: 'item-3', title: 'Start work' }]));
    writeBeadsFile(WORKSPACE_PATH, [{ id: 'bead-3', title: 'PAN-388: Start work' }]);

    await Effect.runPromise(syncBeadStatusToVBrief('bead-3', WORKSPACE_PATH, 'in_progress'));

    const updated = readWorkspacePlanSync(WORKSPACE_PATH)!;
    expect(updated.plan.items[0].status).toBe('in_progress');
  });

  it('matching is case-insensitive', async () => {
    writePlan(makePlanDoc([{ id: 'item-4', title: 'Wire The Pipeline' }]));
    writeBeadsFile(WORKSPACE_PATH, [{ id: 'bead-4', title: 'PAN-388: wire the pipeline' }]);

    const result = await Effect.runPromise(syncBeadStatusToVBrief('bead-4', WORKSPACE_PATH));
    expect(result).toBe('item-4');
  });

  it('handles malformed lines in issues.jsonl gracefully', async () => {
    writePlan(makePlanDoc([{ id: 'item-1', title: 'Good task' }]));
    const beadsDir = join(WORKSPACE_PATH, '.beads');
    mkdirSync(beadsDir, { recursive: true });
    writeFileSync(join(beadsDir, 'issues.jsonl'),
      'not json\n' +
      JSON.stringify({ id: 'bead-1', title: 'PAN-388: Good task', status: 'open' }) + '\n',
    );

    const result = await Effect.runPromise(syncBeadStatusToVBrief('bead-1', WORKSPACE_PATH));
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
        status: 'active',
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

  // getVBriefACStatus uses WORKSPACE_PATH via readWorkspacePlan
  // Need a different issue ID for this describe block to avoid filename collision
  let AC_PROJECT_ROOT: string;
  let AC_WORKSPACE_PATH: string;
  const AC_ISSUE_ID = 'PAN-389';
  const AC_SPEC_FILENAME = '2026-01-01-PAN-389-test-plan.vbrief.json';

  function writeACPlan(doc: VBriefDocument): void {
    const specsDir = join(AC_PROJECT_ROOT, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, AC_SPEC_FILENAME), JSON.stringify({ ...doc, status: 'active' }, null, 2));
  }

  beforeEach(() => {
    AC_PROJECT_ROOT = join(tmpdir(), `beads-ac-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    AC_WORKSPACE_PATH = join(AC_PROJECT_ROOT, 'workspaces', `feature-${AC_ISSUE_ID.toLowerCase()}`);
    mkdirSync(AC_WORKSPACE_PATH, { recursive: true });
  });

  afterEach(() => {
    rmSync(AC_PROJECT_ROOT, { recursive: true, force: true });
  });

  it('returns null when no plan exists', () => {
    expect(getVBriefACStatusSync(AC_WORKSPACE_PATH)).toBeNull();
  });

  it('returns null when plan has no AC subItems', () => {
    writeACPlan(makePlanWithAC([{ id: 'item-1', title: 'Task' }]));
    expect(getVBriefACStatusSync(AC_WORKSPACE_PATH)).toBeNull();
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
    writeACPlan(doc);

    const result = getVBriefACStatusSync(AC_WORKSPACE_PATH)!;
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
    writeACPlan(doc);

    const result = getVBriefACStatusSync(AC_WORKSPACE_PATH)!;
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
    writeACPlan(doc);

    const result = getVBriefACStatusSync(AC_WORKSPACE_PATH)!;
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
    writeACPlan(doc);

    const result = getVBriefACStatusSync(AC_WORKSPACE_PATH)!;
    expect(result.allCompleted).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.totalCompleted).toBe(1);
    expect(result.totalPending).toBe(1);
  });
});
