import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { findPlan, isPlanningComplete, isPlanningProposed, readPlan, readWorkspacePlan, updateItemStatus, updateSubItemStatus } from '../io.js';
import type { VBriefDocument } from '../types.js';

let TEST_DIR: string;

function makePlanDoc(items: Array<{ id: string; status?: string }> = []): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'TEST',
      title: 'Test Plan',
      status: 'active',
      items: items.map(i => ({ id: i.id, title: i.id, status: (i.status ?? 'pending') as any })),
      edges: [],
    },
  };
}

function writePlanDoc(workspacePath: string, doc: VBriefDocument): string {
  const planDir = join(workspacePath, '.planning');
  mkdirSync(planDir, { recursive: true });
  const planPath = join(planDir, 'plan.vbrief.json');
  writeFileSync(planPath, JSON.stringify(doc, null, 2));
  return planPath;
}

beforeEach(() => {
  TEST_DIR = join(tmpdir(), `vbrief-io-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('findPlan', () => {
  it('returns null when workspace has no .planning directory', () => {
    expect(findPlan(TEST_DIR)).toBeNull();
  });

  it('returns null when .planning exists but plan.vbrief.json does not', () => {
    mkdirSync(join(TEST_DIR, '.planning'), { recursive: true });
    expect(findPlan(TEST_DIR)).toBeNull();
  });

  it('returns the plan path when plan.vbrief.json exists', () => {
    writePlanDoc(TEST_DIR, makePlanDoc());
    const result = findPlan(TEST_DIR);
    expect(result).not.toBeNull();
    expect(result).toContain('plan.vbrief.json');
    expect(existsSync(result!)).toBe(true);
  });
});

describe('readPlan', () => {
  it('parses and returns VBriefDocument', () => {
    const doc = makePlanDoc([{ id: 'item-1' }]);
    const planPath = writePlanDoc(TEST_DIR, doc);
    const result = readPlan(planPath);
    expect(result.plan.id).toBe('TEST');
    expect(result.plan.items).toHaveLength(1);
    expect(result.plan.items[0].id).toBe('item-1');
  });

  it('throws for nonexistent file', () => {
    expect(() => readPlan(join(TEST_DIR, 'nonexistent.json'))).toThrow();
  });

  it('throws for invalid JSON', () => {
    const badPath = join(TEST_DIR, 'bad.json');
    writeFileSync(badPath, 'not valid json!!!');
    expect(() => readPlan(badPath)).toThrow();
  });
});

describe('readWorkspacePlan', () => {
  it('returns null when no plan exists', () => {
    expect(readWorkspacePlan(TEST_DIR)).toBeNull();
  });

  it('returns VBriefDocument when plan exists', () => {
    writePlanDoc(TEST_DIR, makePlanDoc([{ id: 'x' }]));
    const result = readWorkspacePlan(TEST_DIR);
    expect(result).not.toBeNull();
    expect(result!.plan.items[0].id).toBe('x');
  });
});

describe('updateItemStatus', () => {
  it('no-ops when no plan exists', () => {
    expect(() => updateItemStatus(TEST_DIR, 'item-1', 'completed')).not.toThrow();
  });

  it('updates the status of an existing item', () => {
    const doc = makePlanDoc([{ id: 'item-1', status: 'pending' }]);
    writePlanDoc(TEST_DIR, doc);

    updateItemStatus(TEST_DIR, 'item-1', 'completed');

    const updated = readWorkspacePlan(TEST_DIR)!;
    const item = updated.plan.items.find(i => i.id === 'item-1');
    expect(item?.status).toBe('completed');
  });

  it('no-ops when item ID does not exist in plan', () => {
    writePlanDoc(TEST_DIR, makePlanDoc([{ id: 'item-1' }]));
    expect(() => updateItemStatus(TEST_DIR, 'nonexistent', 'completed')).not.toThrow();

    const after = readWorkspacePlan(TEST_DIR)!;
    expect(after.plan.items[0].status).toBe('pending');
  });

  it('preserves other items when updating one', () => {
    const doc = makePlanDoc([
      { id: 'item-1', status: 'pending' },
      { id: 'item-2', status: 'in_progress' },
    ]);
    writePlanDoc(TEST_DIR, doc);

    updateItemStatus(TEST_DIR, 'item-1', 'completed');

    const updated = readWorkspacePlan(TEST_DIR)!;
    const item2 = updated.plan.items.find(i => i.id === 'item-2');
    expect(item2?.status).toBe('in_progress');
  });

  it('writes valid JSON (no .tmp file left over)', () => {
    writePlanDoc(TEST_DIR, makePlanDoc([{ id: 'item-1' }]));
    updateItemStatus(TEST_DIR, 'item-1', 'completed');

    const tmpPath = join(TEST_DIR, '.planning', 'plan.vbrief.json.tmp');
    expect(existsSync(tmpPath)).toBe(false);

    const planPath = join(TEST_DIR, '.planning', 'plan.vbrief.json');
    expect(() => JSON.parse(readFileSync(planPath, 'utf-8'))).not.toThrow();
  });
});

describe('updateSubItemStatus', () => {
  function makePlanWithSubItems(): VBriefDocument {
    return {
      vBRIEFInfo: { version: '0.5', created: '2026-01-01T00:00:00Z' },
      plan: {
        id: 'TEST',
        title: 'Test Plan',
        status: 'active',
        items: [{
          id: 'item-1',
          title: 'Task 1',
          status: 'pending' as const,
          subItems: [
            { id: 'item-1.ac1', title: 'First AC', status: 'pending' as const, metadata: { kind: 'acceptance_criterion' } },
            { id: 'item-1.ac2', title: 'Second AC', status: 'pending' as const, metadata: { kind: 'acceptance_criterion' } },
          ],
        }],
        edges: [],
      },
    };
  }

  it('no-ops when no plan exists', () => {
    expect(() => updateSubItemStatus(TEST_DIR, 'item-1', 'item-1.ac1', 'completed')).not.toThrow();
  });

  it('updates a specific subItem status', () => {
    const doc = makePlanWithSubItems();
    writePlanDoc(TEST_DIR, doc);

    updateSubItemStatus(TEST_DIR, 'item-1', 'item-1.ac1', 'completed');

    const updated = readWorkspacePlan(TEST_DIR)!;
    const sub = updated.plan.items[0].subItems!.find(s => s.id === 'item-1.ac1');
    expect(sub?.status).toBe('completed');
  });

  it('preserves other subItems when updating one', () => {
    const doc = makePlanWithSubItems();
    writePlanDoc(TEST_DIR, doc);

    updateSubItemStatus(TEST_DIR, 'item-1', 'item-1.ac1', 'completed');

    const updated = readWorkspacePlan(TEST_DIR)!;
    const other = updated.plan.items[0].subItems!.find(s => s.id === 'item-1.ac2');
    expect(other?.status).toBe('pending');
  });

  it('no-ops when item ID does not exist', () => {
    const doc = makePlanWithSubItems();
    writePlanDoc(TEST_DIR, doc);

    expect(() => updateSubItemStatus(TEST_DIR, 'nonexistent', 'item-1.ac1', 'completed')).not.toThrow();
    const updated = readWorkspacePlan(TEST_DIR)!;
    expect(updated.plan.items[0].subItems![0].status).toBe('pending');
  });

  it('no-ops when subItem ID does not exist', () => {
    const doc = makePlanWithSubItems();
    writePlanDoc(TEST_DIR, doc);

    expect(() => updateSubItemStatus(TEST_DIR, 'item-1', 'nonexistent', 'completed')).not.toThrow();
    const updated = readWorkspacePlan(TEST_DIR)!;
    expect(updated.plan.items[0].subItems![0].status).toBe('pending');
  });
});

function writeMarker(workspacePath: string): void {
  const dir = join(workspacePath, '.planning');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.planning-complete'), '');
}

function writePlanWithStatus(workspacePath: string, status: string): void {
  const doc = makePlanDoc();
  doc.plan.status = status;
  writePlanDoc(workspacePath, doc);
}

describe('isPlanningProposed', () => {
  it('returns true when plan.status is "proposed"', () => {
    writePlanWithStatus(TEST_DIR, 'proposed');
    expect(isPlanningProposed(TEST_DIR)).toBe(true);
  });

  it('returns false when plan.status is "draft"', () => {
    writePlanWithStatus(TEST_DIR, 'draft');
    expect(isPlanningProposed(TEST_DIR)).toBe(false);
  });

  it('returns false when plan.status is "approved"', () => {
    writePlanWithStatus(TEST_DIR, 'approved');
    expect(isPlanningProposed(TEST_DIR)).toBe(false);
  });

  it('returns false when plan.status is "running"', () => {
    writePlanWithStatus(TEST_DIR, 'running');
    expect(isPlanningProposed(TEST_DIR)).toBe(false);
  });

  it('returns false when plan.status is explicit but not "proposed", even with marker present (status wins)', () => {
    writePlanWithStatus(TEST_DIR, 'approved');
    writeMarker(TEST_DIR);
    expect(isPlanningProposed(TEST_DIR)).toBe(false);
  });

  it('returns true via legacy marker when plan has no status field', () => {
    const doc = makePlanDoc();
    delete (doc.plan as Partial<typeof doc.plan>).status;
    writePlanDoc(TEST_DIR, doc);
    writeMarker(TEST_DIR);
    expect(isPlanningProposed(TEST_DIR)).toBe(true);
  });

  it('returns true via legacy marker when there is no plan at all', () => {
    writeMarker(TEST_DIR);
    expect(isPlanningProposed(TEST_DIR)).toBe(true);
  });

  it('returns false when no plan and no marker', () => {
    expect(isPlanningProposed(TEST_DIR)).toBe(false);
  });

  it('returns true via legacy marker when plan is corrupt', () => {
    const dir = join(TEST_DIR, '.planning');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plan.vbrief.json'), 'not json');
    writeMarker(TEST_DIR);
    expect(isPlanningProposed(TEST_DIR)).toBe(true);
  });
});

describe('isPlanningComplete', () => {
  it.each(['proposed', 'approved', 'pending', 'running', 'completed', 'blocked'])(
    'returns true when plan.status is "%s"',
    (status) => {
      writePlanWithStatus(TEST_DIR, status);
      expect(isPlanningComplete(TEST_DIR)).toBe(true);
    },
  );

  it('returns false when plan.status is "draft"', () => {
    writePlanWithStatus(TEST_DIR, 'draft');
    expect(isPlanningComplete(TEST_DIR)).toBe(false);
  });

  it('returns false when plan.status is "cancelled"', () => {
    writePlanWithStatus(TEST_DIR, 'cancelled');
    expect(isPlanningComplete(TEST_DIR)).toBe(false);
  });

  it('returns true via legacy marker when plan has no status field', () => {
    const doc = makePlanDoc();
    delete (doc.plan as Partial<typeof doc.plan>).status;
    writePlanDoc(TEST_DIR, doc);
    writeMarker(TEST_DIR);
    expect(isPlanningComplete(TEST_DIR)).toBe(true);
  });

  it('returns false when no plan and no marker', () => {
    expect(isPlanningComplete(TEST_DIR)).toBe(false);
  });

  it('explicit non-finished status wins over marker', () => {
    writePlanWithStatus(TEST_DIR, 'draft');
    writeMarker(TEST_DIR);
    expect(isPlanningComplete(TEST_DIR)).toBe(false);
  });

  it('accepts a planningDir override pointing to a non-standard location', () => {
    const customPlanningDir = join(TEST_DIR, '.planning', 'foo-1');
    mkdirSync(customPlanningDir, { recursive: true });
    const doc = makePlanDoc();
    doc.plan.status = 'running';
    writeFileSync(join(customPlanningDir, 'plan.vbrief.json'), JSON.stringify(doc));
    expect(isPlanningComplete(TEST_DIR, customPlanningDir)).toBe(true);
    expect(isPlanningProposed(TEST_DIR, customPlanningDir)).toBe(false);
  });
});
