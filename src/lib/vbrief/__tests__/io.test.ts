import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { applyEffectiveDifficulty } from '../../agents/tier-escalation.js';
import { resolveTier } from '../../agents/resolve-tier.js';
import { findPlanSync, isPlanningCompleteSync, isPlanningProposed, readPlanSync, readTierOverrides, readWorkspacePlanSync, recordTierPromotion, updateItemStatus, updateSubItemStatus } from '../io.js';
import { subItemsOf, type VBriefDocument, type VBriefSubItem } from '../types.js';

let PROJECT_ROOT: string;
let WORKSPACE_PATH: string;
const ISSUE_ID = 'PAN-100';
const SPEC_FILENAME = '2026-01-01-PAN-100-test-plan.vbrief.json';

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

/**
 * Write the spec to main-side `.pan/specs/` (canonical location for findPlan resolution).
 * Also writes a top-level `status` field required by parsePanSpecDocument.
 */
function writeMainSpec(doc: VBriefDocument, specStatus: 'proposed' | 'active' | 'completed' | 'cancelled' = 'active'): string {
  const specsDir = join(PROJECT_ROOT, '.pan', 'specs');
  mkdirSync(specsDir, { recursive: true });
  const specPath = join(specsDir, SPEC_FILENAME);
  const specDoc = { ...doc, status: specStatus };
  writeFileSync(specPath, JSON.stringify(specDoc, null, 2));
  return specPath;
}

/**
 * Write spec to main-side AND return the path (convenience for readPlan tests).
 */
function writePlanDoc(doc: VBriefDocument): string {
  return writeMainSpec(doc);
}

function writeWorkspaceSpec(doc: VBriefDocument): string {
  const specsDir = join(WORKSPACE_PATH, '.pan', 'specs');
  mkdirSync(specsDir, { recursive: true });
  const specPath = join(specsDir, SPEC_FILENAME);
  writeFileSync(specPath, JSON.stringify({ ...doc, status: 'active' }, null, 2));
  return specPath;
}

function createWorktreeShape(): void {
  writeFileSync(join(WORKSPACE_PATH, '.git'), 'gitdir: ../../.git/worktrees/feature-pan-100');
  mkdirSync(join(WORKSPACE_PATH, '.pan', 'specs'), { recursive: true });
}

function writeWorkspaceDraft(doc: VBriefDocument): string {
  const panDir = join(WORKSPACE_PATH, '.pan');
  mkdirSync(panDir, { recursive: true });
  const planPath = join(panDir, 'spec.vbrief.json');
  writeFileSync(planPath, JSON.stringify(doc, null, 2));
  return planPath;
}

function writeRecord(statusOverrides: Record<string, string>): void {
  const recordsDir = join(WORKSPACE_PATH, '.pan', 'records');
  mkdirSync(recordsDir, { recursive: true });
  writeFileSync(join(recordsDir, `${ISSUE_ID.toLowerCase()}.json`), JSON.stringify({
    issueId: ISSUE_ID,
    schemaVersion: 2,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    pipeline: {
      issueId: ISSUE_ID,
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt: '2026-01-01T00:00:00Z',
    },
    closeOut: { usage: { byStage: {}, totals: {} }, merges: [], ranOn: 'host' },
    statusOverrides,
  }, null, 2));
}

beforeEach(() => {
  PROJECT_ROOT = join(tmpdir(), `vbrief-io-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  WORKSPACE_PATH = join(PROJECT_ROOT, 'workspaces', `feature-${ISSUE_ID.toLowerCase()}`);
  mkdirSync(WORKSPACE_PATH, { recursive: true });
});

afterEach(() => {
  rmSync(PROJECT_ROOT, { recursive: true, force: true });
});

describe('findPlan', () => {
  it('returns null when workspace has no matching spec in .pan/specs/', () => {
    expect(findPlanSync(WORKSPACE_PATH)).toBeNull();
  });

  it('returns null when .pan/specs exists but has no matching spec', () => {
    mkdirSync(join(PROJECT_ROOT, '.pan', 'specs'), { recursive: true });
    expect(findPlanSync(WORKSPACE_PATH)).toBeNull();
  });

  it('returns the plan path when spec exists in .pan/specs/', () => {
    writePlanDoc(makePlanDoc());
    const result = findPlanSync(WORKSPACE_PATH);
    expect(result).not.toBeNull();
    expect(result).toContain('.pan/specs/');
    expect(result).toContain(SPEC_FILENAME);
    expect(existsSync(result!)).toBe(true);
  });

  it('resolves the parent project spec (PAN-1124: single spec on main, workspace-first lookup removed)', () => {
    const projectSpec = writePlanDoc(makePlanDoc([{ id: 'parent-item' }]));
    // Workspace spec is no longer preferred — verify the canonical project spec wins.
    writeWorkspaceSpec(makePlanDoc([{ id: 'workspace-item' }]));

    expect(findPlanSync(WORKSPACE_PATH)).toBe(projectSpec);
    expect(readWorkspacePlanSync(WORKSPACE_PATH)?.plan.items[0].id).toBe('parent-item');
  });

  it('resolves the parent project spec when the workspace is itself a git worktree', () => {
    createWorktreeShape();
    const projectSpec = writePlanDoc(makePlanDoc([{ id: 'parent-item' }]));
    writeWorkspaceSpec(makePlanDoc([{ id: 'workspace-item' }]));

    expect(findPlanSync(WORKSPACE_PATH)).toBe(projectSpec);
    expect(readWorkspacePlanSync(WORKSPACE_PATH)?.plan.items[0].id).toBe('parent-item');
  });

  it('falls back to the matching workspace draft before the canonical spec exists', () => {
    const doc = makePlanDoc([{ id: 'draft-item' }]);
    doc.plan.id = ISSUE_ID.toLowerCase();
    const draftPath = writeWorkspaceDraft(doc);

    expect(findPlanSync(WORKSPACE_PATH)).toBe(draftPath);
  });

  it('keeps the workspace draft fallback for a git worktree before promotion', () => {
    createWorktreeShape();
    const doc = makePlanDoc([{ id: 'draft-worktree-item' }]);
    doc.plan.id = ISSUE_ID.toLowerCase();
    const draftPath = writeWorkspaceDraft(doc);

    expect(findPlanSync(WORKSPACE_PATH)).toBe(draftPath);
    expect(readWorkspacePlanSync(WORKSPACE_PATH)?.plan.items[0].id).toBe('draft-worktree-item');
  });

  it('resolves post-promotion specs from the main project specs directory, not the workspace specs directory', () => {
    createWorktreeShape();
    const projectSpec = writePlanDoc(makePlanDoc([{ id: 'canonical-item' }]));
    writeWorkspaceSpec(makePlanDoc([{ id: 'workspace-item' }]));

    const result = findPlanSync(WORKSPACE_PATH);

    expect(result).toBe(projectSpec);
    expect(result?.startsWith(join(PROJECT_ROOT, '.pan', 'specs'))).toBe(true);
    expect(result?.startsWith(join(WORKSPACE_PATH, '.pan', 'specs'))).toBe(false);
    expect(readWorkspacePlanSync(WORKSPACE_PATH)?.plan.items[0].id).toBe('canonical-item');
  });

  it('ignores workspace drafts for a different issue', () => {
    const doc = makePlanDoc([{ id: 'wrong-item' }]);
    doc.plan.id = 'PAN-999';
    writeWorkspaceDraft(doc);

    expect(findPlanSync(WORKSPACE_PATH)).toBeNull();
  });

  it('returns null when workspace path does not match feature-<issue-id> pattern', () => {
    const badPath = join(PROJECT_ROOT, 'workspaces', 'not-a-feature');
    mkdirSync(badPath, { recursive: true });
    writePlanDoc(makePlanDoc());
    expect(findPlanSync(badPath)).toBeNull();
  });
});

describe('readPlan', () => {
  it('parses and returns VBriefDocument', () => {
    const doc = makePlanDoc([{ id: 'item-1' }]);
    const planPath = writePlanDoc(doc);
    const result = readPlanSync(planPath);
    expect(result.plan.id).toBe('TEST');
    expect(result.plan.items).toHaveLength(1);
    expect(result.plan.items[0].id).toBe('item-1');
  });

  it('throws for nonexistent file', () => {
    expect(() => readPlanSync(join(PROJECT_ROOT, 'nonexistent.json'))).toThrow();
  });

  it('throws for invalid JSON', () => {
    const badPath = join(PROJECT_ROOT, 'bad.json');
    writeFileSync(badPath, 'not valid json!!!');
    expect(() => readPlanSync(badPath)).toThrow();
  });
});

describe('readWorkspacePlan', () => {
  it('returns null when no plan exists', () => {
    expect(readWorkspacePlanSync(WORKSPACE_PATH)).toBeNull();
  });

  it('returns VBriefDocument when plan exists', () => {
    writePlanDoc(makePlanDoc([{ id: 'x' }]));
    const result = readWorkspacePlanSync(WORKSPACE_PATH);
    expect(result).not.toBeNull();
    expect(result!.plan.items[0].id).toBe('x');
  });

  it('reads the workspace draft when no canonical spec exists yet', () => {
    const doc = makePlanDoc([{ id: 'draft-x' }]);
    doc.plan.id = ISSUE_ID.toLowerCase();
    writeWorkspaceDraft(doc);

    const result = readWorkspacePlanSync(WORKSPACE_PATH);
    expect(result).not.toBeNull();
    expect(result!.plan.items[0].id).toBe('draft-x');
  });

  it('returns equivalent child item views for v0.5 subItems and v0.6 items', () => {
    const childItems: VBriefSubItem[] = [
      { id: 'item-1.ac1', title: 'First AC', status: 'pending', metadata: { kind: 'acceptance_criterion' } },
      { id: 'item-1.ac2', title: 'Second AC', status: 'completed', metadata: { kind: 'acceptance_criterion' } },
    ];
    const legacyDoc = makePlanDoc([{ id: 'item-1' }]);
    legacyDoc.vBRIEFInfo.version = '0.5';
    legacyDoc.plan.items[0].subItems = childItems;
    writePlanDoc(legacyDoc);
    const legacyView = readWorkspacePlanSync(WORKSPACE_PATH)!;

    rmSync(PROJECT_ROOT, { recursive: true, force: true });
    mkdirSync(WORKSPACE_PATH, { recursive: true });

    const currentDoc = makePlanDoc([{ id: 'item-1' }]);
    currentDoc.vBRIEFInfo.version = '0.6';
    currentDoc.plan.items[0].items = childItems;
    writePlanDoc(currentDoc);
    const currentView = readWorkspacePlanSync(WORKSPACE_PATH)!;

    expect(subItemsOf(currentView.plan.items[0])).toEqual(subItemsOf(legacyView.plan.items[0]));
  });
});

describe('updateItemStatus', () => {
  it('no-ops when no plan exists', () => {
    expect(() => updateItemStatus(WORKSPACE_PATH, 'item-1', 'completed')).not.toThrow();
  });

  it('updates the status of an existing item', () => {
    writePlanDoc(makePlanDoc([{ id: 'item-1', status: 'pending' }]));

    updateItemStatus(WORKSPACE_PATH, 'item-1', 'completed');

    const updated = readWorkspacePlanSync(WORKSPACE_PATH)!;
    const item = updated.plan.items.find(i => i.id === 'item-1');
    expect(item?.status).toBe('completed');
  });

  it('no-ops when item ID does not exist in plan', () => {
    writePlanDoc(makePlanDoc([{ id: 'item-1' }]));
    expect(() => updateItemStatus(WORKSPACE_PATH, 'nonexistent', 'completed')).not.toThrow();

    const after = readWorkspacePlanSync(WORKSPACE_PATH)!;
    expect(after.plan.items[0].status).toBe('pending');
  });

  it('preserves other items when updating one', () => {
    const doc = makePlanDoc([
      { id: 'item-1', status: 'pending' },
      { id: 'item-2', status: 'in_progress' },
    ]);
    writePlanDoc(doc);

    updateItemStatus(WORKSPACE_PATH, 'item-1', 'completed');

    const updated = readWorkspacePlanSync(WORKSPACE_PATH)!;
    const item2 = updated.plan.items.find(i => i.id === 'item-2');
    expect(item2?.status).toBe('in_progress');
  });

  it('writes status to per-issue record statusOverrides (not the spec)', () => {
    writePlanDoc(makePlanDoc([{ id: 'item-1' }]));
    updateItemStatus(WORKSPACE_PATH, 'item-1', 'completed');

    // The spec on main should NOT be modified
    const specPath = join(PROJECT_ROOT, '.pan', 'specs', SPEC_FILENAME);
    const raw = JSON.parse(readFileSync(specPath, 'utf-8'));
    expect(raw.plan.items[0].status).toBe('pending');
  });
});

describe('tierOverrides', () => {
  function hashFile(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  }

  it('round-trips tier promotions through workspace continue.json', () => {
    writePlanDoc(makePlanDoc([{ id: 'item-1' }]));
    mkdirSync(join(WORKSPACE_PATH, '.pan'), { recursive: true });
    writeFileSync(
      join(WORKSPACE_PATH, '.pan', 'continue.json'),
      JSON.stringify({ statusOverrides: { 'item-2': 'running' } }, null, 2),
    );

    recordTierPromotion(WORKSPACE_PATH, 'item-1', 'simple', 'medium', 'verification failed');
    recordTierPromotion(WORKSPACE_PATH, 'item-1', 'medium', 'complex', 'blocked by supervisor');

    const continueState = JSON.parse(readFileSync(join(WORKSPACE_PATH, '.pan', 'continue.json'), 'utf-8'));
    expect(continueState.statusOverrides).toEqual({ 'item-2': 'running' });
    expect(continueState.tierOverrides['item-1'].effectiveDifficulty).toBe('complex');

    const overrides = readTierOverrides(WORKSPACE_PATH);
    expect(overrides['item-1']).toMatchObject({
      effectiveDifficulty: 'complex',
      promotions: 2,
      history: [
        { from: 'simple', to: 'medium', reason: 'verification failed' },
        { from: 'medium', to: 'complex', reason: 'blocked by supervisor' },
      ],
    });
    expect(overrides['item-1'].history[0].at).toEqual(expect.any(String));
    expect(overrides['item-1'].history[1].at).toEqual(expect.any(String));
  });

  it('preserves the canonical spec byte-for-byte when recording a promotion', () => {
    const specPath = writePlanDoc(makePlanDoc([{ id: 'item-1' }]));
    const beforeHash = hashFile(specPath);

    recordTierPromotion(WORKSPACE_PATH, 'item-1', 'simple', 'medium', 'verification failed');

    expect(hashFile(specPath)).toBe(beforeHash);
  });

  it('overlays promoted difficulty before tier resolution without changing unmatched items', () => {
    const config = {
      tiers: {
        cheap: { model: 'cheap-model', harness: 'codex' as const },
        senior: { model: 'senior-model', harness: 'codex' as const },
      },
      difficultyToTier: {
        simple: 'cheap',
        complex: 'senior',
      },
    };
    const item = {
      id: 'item-1',
      title: 'Needs promotion',
      status: 'pending' as const,
      metadata: { difficulty: 'simple' as const },
    };
    const promoted = applyEffectiveDifficulty(item, {
      'item-1': {
        effectiveDifficulty: 'complex',
        promotions: 1,
        history: [{ at: '2026-07-02T00:00:00.000Z', from: 'simple', to: 'complex', reason: 'test' }],
      },
    });

    expect(resolveTier(promoted, config).tierName).toBe('senior');
    expect(resolveTier(applyEffectiveDifficulty(item, {}), config).tierName).toBe('cheap');
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

  function makePlanWithItems(): VBriefDocument {
    const doc = makePlanWithSubItems();
    doc.vBRIEFInfo.version = '0.6';
    doc.plan.items[0].items = doc.plan.items[0].subItems;
    delete doc.plan.items[0].subItems;
    return doc;
  }

  it('no-ops when no plan exists', () => {
    expect(() => updateSubItemStatus(WORKSPACE_PATH, 'item-1', 'item-1.ac1', 'completed')).not.toThrow();
  });

  it('updates a specific subItem status', () => {
    const doc = makePlanWithSubItems();
    writePlanDoc(doc);

    updateSubItemStatus(WORKSPACE_PATH, 'item-1', 'item-1.ac1', 'completed');

    const updated = readWorkspacePlanSync(WORKSPACE_PATH)!;
    const sub = updated.plan.items[0].subItems!.find(s => s.id === 'item-1.ac1');
    expect(sub?.status).toBe('completed');
  });

  it('preserves other subItems when updating one', () => {
    const doc = makePlanWithSubItems();
    writePlanDoc(doc);

    updateSubItemStatus(WORKSPACE_PATH, 'item-1', 'item-1.ac1', 'completed');

    const updated = readWorkspacePlanSync(WORKSPACE_PATH)!;
    const other = updated.plan.items[0].subItems!.find(s => s.id === 'item-1.ac2');
    expect(other?.status).toBe('pending');
  });

  it('applies compact subItem status overrides whose keys equal dotted subItem IDs', () => {
    const doc = makePlanWithSubItems();
    writePlanDoc(doc);
    writeRecord({ 'item-1.ac1': 'completed' });

    const updated = readWorkspacePlanSync(WORKSPACE_PATH)!;
    const sub = updated.plan.items[0].subItems!.find(s => s.id === 'item-1.ac1');
    expect(sub?.status).toBe('completed');
  });

  it('applies compact status overrides to v0.6 items children', () => {
    const doc = makePlanWithItems();
    writePlanDoc(doc);
    writeRecord({ 'item-1.ac1': 'completed' });

    const updated = readWorkspacePlanSync(WORKSPACE_PATH)!;
    const sub = subItemsOf(updated.plan.items[0]).find(s => s.id === 'item-1.ac1');
    expect(sub?.status).toBe('completed');
  });

  it('no-ops when item ID does not exist', () => {
    const doc = makePlanWithSubItems();
    writePlanDoc(doc);

    expect(() => updateSubItemStatus(WORKSPACE_PATH, 'nonexistent', 'item-1.ac1', 'completed')).not.toThrow();
    const updated = readWorkspacePlanSync(WORKSPACE_PATH)!;
    expect(updated.plan.items[0].subItems![0].status).toBe('pending');
  });

  it('no-ops when subItem ID does not exist', () => {
    const doc = makePlanWithSubItems();
    writePlanDoc(doc);

    expect(() => updateSubItemStatus(WORKSPACE_PATH, 'item-1', 'nonexistent', 'completed')).not.toThrow();
    const updated = readWorkspacePlanSync(WORKSPACE_PATH)!;
    expect(updated.plan.items[0].subItems![0].status).toBe('pending');
  });
});

function writeSpecWithPlanStatus(planStatus: string): void {
  const doc = makePlanDoc();
  doc.plan.status = planStatus;
  // Use a valid PanSpecStatus for the spec's top-level status so parsePanSpecDocument passes.
  // The tests exercise plan.status via checkPlanStatus, which reads doc.plan.status.
  const specStatus = (['proposed', 'active', 'completed', 'cancelled'].includes(planStatus))
    ? planStatus as 'proposed' | 'active' | 'completed' | 'cancelled'
    : 'active';
  writeMainSpec(doc, specStatus);
}

describe('isPlanningProposed', () => {
  it('returns true when plan.status is "proposed"', () => {
    writeSpecWithPlanStatus('proposed');
    expect(isPlanningProposed(WORKSPACE_PATH)).toBe(true);
  });

  it('returns false when plan.status is "draft"', () => {
    // 'draft' is not a valid PanSpecStatus, so parsePanSpecDocument will fail
    // unless we use a valid spec-level status. But the auto-recovery in
    // parsePanSpecDocument tries plan.status, and 'draft' is not a valid
    // PanSpecStatus either. So the spec won't parse, and isPlanningProposed returns false.
    // We just need a valid spec on main for the test — use 'active' as spec status.
    writeSpecWithPlanStatus('active');
    // Overwrite with plan.status = 'draft' but keep spec status valid
    const doc = makePlanDoc();
    doc.plan.status = 'draft';
    const specsDir = join(PROJECT_ROOT, '.pan', 'specs');
    const specPath = join(specsDir, SPEC_FILENAME);
    writeFileSync(specPath, JSON.stringify({ ...doc, status: 'active' }, null, 2));
    expect(isPlanningProposed(WORKSPACE_PATH)).toBe(false);
  });

  it('returns false when plan.status is "approved"', () => {
    // 'approved' is not a PanSpecStatus; parsePanSpecDocument auto-recovers only when
    // plan.status IS a valid PanSpecStatus. So this spec won't parse unless we set
    // a valid top-level status.
    const doc = makePlanDoc();
    doc.plan.status = 'approved';
    const specsDir = join(PROJECT_ROOT, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, SPEC_FILENAME), JSON.stringify({ ...doc, status: 'active' }, null, 2));
    expect(isPlanningProposed(WORKSPACE_PATH)).toBe(false);
  });

  it('returns false when plan.status is "running"', () => {
    const doc = makePlanDoc();
    doc.plan.status = 'running';
    const specsDir = join(PROJECT_ROOT, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, SPEC_FILENAME), JSON.stringify({ ...doc, status: 'active' }, null, 2));
    expect(isPlanningProposed(WORKSPACE_PATH)).toBe(false);
  });

  it('returns false when plan.status is explicit but not "proposed"', () => {
    const doc = makePlanDoc();
    doc.plan.status = 'approved';
    const specsDir = join(PROJECT_ROOT, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, SPEC_FILENAME), JSON.stringify({ ...doc, status: 'active' }, null, 2));
    expect(isPlanningProposed(WORKSPACE_PATH)).toBe(false);
  });

  it('returns false when plan has no status field', () => {
    const doc = makePlanDoc();
    delete (doc.plan as Partial<typeof doc.plan>).status;
    // Without plan.status, parsePanSpecDocument needs top-level status
    const specsDir = join(PROJECT_ROOT, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, SPEC_FILENAME), JSON.stringify({ ...doc, status: 'active' }, null, 2));
    expect(isPlanningProposed(WORKSPACE_PATH)).toBe(false);
  });

  it('returns false when there is no plan at all', () => {
    expect(isPlanningProposed(WORKSPACE_PATH)).toBe(false);
  });

  it('returns false when no plan and no marker', () => {
    expect(isPlanningProposed(WORKSPACE_PATH)).toBe(false);
  });

  // Note: "corrupt plan" test removed — corrupt JSON in .pan/specs/ causes
  // parsePanSpecDocument to throw inside listSpecs/findSpecByIssue, which is
  // the correct behavior for the single-spec-on-main model. The old test
  // targeted workspace-local spec fallback which no longer exists.
});

describe('isPlanningComplete', () => {
  // isPlanningComplete checks plan.status against PLANNING_FINISHED_STATUSES:
  // 'proposed', 'approved', 'pending', 'running', 'completed', 'blocked'
  //
  // However, parsePanSpecDocument requires either doc.status or doc.plan.status
  // to be a valid PanSpecStatus ('proposed'|'active'|'completed'|'cancelled').
  // For plan.status values that are not valid PanSpecStatus ('approved','pending',
  // 'running','blocked'), we need a valid top-level status for the spec to parse.

  it.each([
    ['proposed', 'proposed'],
    ['completed', 'completed'],
  ] as const)(
    'returns true when plan.status is "%s" (valid PanSpecStatus)',
    (planStatus, specStatus) => {
      writeMainSpec({ ...makePlanDoc(), plan: { ...makePlanDoc().plan, status: planStatus } }, specStatus);
      expect(isPlanningCompleteSync(WORKSPACE_PATH)).toBe(true);
    },
  );

  it.each(['approved', 'pending', 'running', 'blocked'])(
    'returns true when plan.status is "%s" (non-PanSpecStatus, needs top-level status)',
    (planStatus) => {
      const doc = makePlanDoc();
      doc.plan.status = planStatus;
      const specsDir = join(PROJECT_ROOT, '.pan', 'specs');
      mkdirSync(specsDir, { recursive: true });
      writeFileSync(join(specsDir, SPEC_FILENAME), JSON.stringify({ ...doc, status: 'active' }, null, 2));
      expect(isPlanningCompleteSync(WORKSPACE_PATH)).toBe(true);
    },
  );

  it('returns false when plan.status is "draft"', () => {
    const doc = makePlanDoc();
    doc.plan.status = 'draft';
    const specsDir = join(PROJECT_ROOT, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, SPEC_FILENAME), JSON.stringify({ ...doc, status: 'active' }, null, 2));
    expect(isPlanningCompleteSync(WORKSPACE_PATH)).toBe(false);
  });

  it('returns false when plan.status is "cancelled"', () => {
    writeMainSpec({ ...makePlanDoc(), plan: { ...makePlanDoc().plan, status: 'cancelled' } }, 'cancelled');
    expect(isPlanningCompleteSync(WORKSPACE_PATH)).toBe(false);
  });

  it('returns false when plan has no status field', () => {
    const doc = makePlanDoc();
    delete (doc.plan as Partial<typeof doc.plan>).status;
    const specsDir = join(PROJECT_ROOT, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, SPEC_FILENAME), JSON.stringify({ ...doc, status: 'active' }, null, 2));
    expect(isPlanningCompleteSync(WORKSPACE_PATH)).toBe(false);
  });

  it('returns false when no plan exists', () => {
    expect(isPlanningCompleteSync(WORKSPACE_PATH)).toBe(false);
  });

  it('returns false when plan.status is an explicit non-finished value', () => {
    const doc = makePlanDoc();
    doc.plan.status = 'draft';
    const specsDir = join(PROJECT_ROOT, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, SPEC_FILENAME), JSON.stringify({ ...doc, status: 'active' }, null, 2));
    expect(isPlanningCompleteSync(WORKSPACE_PATH)).toBe(false);
  });
});
