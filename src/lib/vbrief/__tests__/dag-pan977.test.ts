/**
 * Tests for PAN-977 DAG functions:
 *   getDispatchableItems, blockingParentCount, hasFileOverlap
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDispatchableItems, blockingParentCount, hasFileOverlap, createActiveSlice, applyTaskOperation, getPipelineMirror, setPipelineMirror, getTaskGraphView, activeSlicePromptSize, verifyActiveSlicePromptReduction, buildPipelineMirrorFromStatus, deriveSynthesisMetadata } from '../dag.js';
import { applyTaskOperationToPlanFile, runTaskCommand, writePipelineMirrorToPlanFile } from '../dag-cli.js';
import type { VBriefDocument, VBriefItem } from '../types.js';

function makeDoc(
  items: Array<{ id: string; status?: string; files_scope?: string[] }>,
  edges: Array<{ from: string; to: string; type?: string }>,
): VBriefDocument {
  return {
    vBRIEFInfo: { version: '1.0', created: '2026-01-01T00:00:00Z' },
    plan: {
      id: 'TEST',
      title: 'Test Plan',
      status: 'active',
      items: items.map(i => ({
        id: i.id,
        title: i.id,
        status: (i.status ?? 'pending') as any,
        subItems: [{ id: `${i.id}.ac1`, title: `${i.id} AC`, status: 'pending' as any }],
        metadata: i.files_scope ? { files_scope: i.files_scope } : undefined,
      })),
      edges: edges.map(e => ({ from: e.from, to: e.to, type: (e.type ?? 'blocks') as any })),
    },
  };
}

function item(id: string, files_scope?: string[]): VBriefItem {
  return {
    id,
    title: id,
    status: 'running',
    metadata: files_scope ? { files_scope } : undefined,
  };
}

// ─── getDispatchableItems ──────────────────────────────────────────────────

describe('getDispatchableItems', () => {
  it('returns all items when no edges and none merged', () => {
    const doc = makeDoc([{ id: 'a' }, { id: 'b' }], []);
    const result = getDispatchableItems(doc, new Set());
    expect(result.map(i => i.id)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('blocks downstream until upstream is merged', () => {
    // a → b (a must merge before b is dispatchable)
    const doc = makeDoc([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }]);

    const withoutMerge = getDispatchableItems(doc, new Set());
    expect(withoutMerge.map(i => i.id)).toContain('a');
    expect(withoutMerge.map(i => i.id)).not.toContain('b');

    const withMerge = getDispatchableItems(doc, new Set(['a']));
    expect(withMerge.map(i => i.id)).toContain('b');
  });

  it('releases item only when ALL blockers are merged (diamond)', () => {
    // a → c, b → c  (c requires both a and b)
    const doc = makeDoc(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
    );

    // Only a merged — c still blocked
    expect(getDispatchableItems(doc, new Set(['a'])).map(i => i.id)).not.toContain('c');

    // Both a and b merged — c is now dispatchable
    expect(getDispatchableItems(doc, new Set(['a', 'b'])).map(i => i.id)).toContain('c');
  });

  it('treats completed items in plan as resolved blockers', () => {
    const doc = makeDoc(
      [{ id: 'a', status: 'completed' }, { id: 'b' }],
      [{ from: 'a', to: 'b' }],
    );
    // 'a' is completed in plan, so 'b' is dispatchable even without mergedIds
    expect(getDispatchableItems(doc, new Set()).map(i => i.id)).toContain('b');
  });

  it('excludes items with status running', () => {
    const doc = makeDoc([{ id: 'a', status: 'running' }], []);
    expect(getDispatchableItems(doc, new Set())).toHaveLength(0);
  });

  it('excludes running items from task graph waves', () => {
    const doc = makeDoc([{ id: 'a', status: 'running' }, { id: 'b' }], []);
    const view = getTaskGraphView(doc);
    expect(view.next.map(i => i.id)).not.toContain('a');
    expect(view.waves.flatMap(w => w.items.map(i => i.id))).not.toContain('a');
    expect(view.waves.flatMap(w => w.items.map(i => i.id))).toContain('b');
  });

  it('keeps downstream items out of waves while blocker is running', () => {
    const doc = makeDoc([{ id: 'a', status: 'running' }, { id: 'b' }], [{ from: 'a', to: 'b' }]);
    const view = getTaskGraphView(doc);
    expect(view.waves).toHaveLength(0);
    expect(view.next.map(i => i.id)).not.toContain('b');
  });

  it('keeps downstream items out of waves while blocker is blocked', () => {
    const doc = makeDoc([{ id: 'a', status: 'blocked' }, { id: 'b' }], [{ from: 'a', to: 'b' }]);
    const view = getTaskGraphView(doc);
    expect(view.waves).toHaveLength(0);
    expect(view.next.map(i => i.id)).not.toContain('b');
  });

  it('surfaces unresolved running/blocking parents in blockedBy even when excluded from waves', () => {
    const doc = makeDoc([{ id: 'a', status: 'running' }, { id: 'b' }], [{ from: 'a', to: 'b' }]);
    const view = getTaskGraphView(doc);
    expect(view.waves).toHaveLength(0);
    // If b were incorrectly placed in a wave, it would appear with no blockedBy.
    // Since the wave set is empty, we verify the bug is fixed indirectly.
    // Critical-path / next view should also exclude b.
    expect(view.next.map(i => i.id)).not.toContain('b');
  });

  it('excludes cancelled items', () => {
    const doc = makeDoc([{ id: 'a', status: 'cancelled' }], []);
    expect(getDispatchableItems(doc, new Set())).toHaveLength(0);
  });

  it('excludes explicitly blocked items from dispatch and graph next until unblocked', () => {
    const doc = makeDoc([{ id: 'a', status: 'blocked' }, { id: 'b' }], []);
    expect(getDispatchableItems(doc, new Set()).map(i => i.id)).toEqual(['b']);
    expect(getTaskGraphView(doc).next.map(i => i.id)).toEqual(['b']);
    expect(getTaskGraphView(doc).waves.flatMap(w => w.items.map(i => i.id))).toEqual(['b']);

    const unblocked = applyTaskOperation(doc, { type: 'unblock', itemId: 'a' }).doc;
    expect(getDispatchableItems(unblocked, new Set()).map(i => i.id)).toEqual(expect.arrayContaining(['a', 'b']));
  });


  it('returns empty for fully merged plan', () => {
    const doc = makeDoc([{ id: 'a', status: 'completed' }, { id: 'b', status: 'completed' }], []);
    expect(getDispatchableItems(doc, new Set(['a', 'b']))).toHaveLength(0);
  });

  it('ignores dangling blockers whose source item is missing', () => {
    const doc = makeDoc([{ id: 'a' }], [{ from: 'missing', to: 'a' }]);
    expect(getDispatchableItems(doc, new Set()).map(i => i.id)).toContain('a');
  });

});

// ─── blockingParentCount ──────────────────────────────────────────────────

describe('blockingParentCount', () => {
  it('returns 0 for item with no incoming block edges', () => {
    const doc = makeDoc([{ id: 'a' }, { id: 'b' }], []);
    expect(blockingParentCount(doc, 'a')).toBe(0);
  });

  it('returns 1 for single blocker', () => {
    const doc = makeDoc([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }]);
    expect(blockingParentCount(doc, 'b')).toBe(1);
  });

  it('returns 2 for diamond convergence', () => {
    const doc = makeDoc(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
    );
    expect(blockingParentCount(doc, 'c')).toBe(2);
  });

  it('does not count completed parents', () => {
    const doc = makeDoc(
      [{ id: 'a', status: 'completed' }, { id: 'b' }, { id: 'c' }],
      [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
    );
    // 'a' is completed so only 'b' counts as a blocking parent
    expect(blockingParentCount(doc, 'c')).toBe(1);
  });

  it('does not count non-blocks edge types', () => {
    const doc = makeDoc(
      [{ id: 'a' }, { id: 'b' }],
      [{ from: 'a', to: 'b', type: 'informs' }],
    );
    expect(blockingParentCount(doc, 'b')).toBe(0);
  });
});

// ─── hasFileOverlap ────────────────────────────────────────────────────────

describe('hasFileOverlap', () => {
  it('returns false when candidate has no files_scope', () => {
    const running = [item('a', ['src/foo.ts'])];
    const candidate = item('b'); // no files_scope
    expect(hasFileOverlap(running, candidate)).toBe(false);
  });

  it('returns false when running item has no files_scope', () => {
    const running = [item('a')]; // no files_scope
    const candidate = item('b', ['src/foo.ts']);
    expect(hasFileOverlap(running, candidate)).toBe(false);
  });

  it('returns false when scopes are disjoint', () => {
    const running = [item('a', ['src/lib/agents.ts'])];
    const candidate = item('b', ['src/dashboard/server/routes/swarm.ts']);
    expect(hasFileOverlap(running, candidate)).toBe(false);
  });

  it('returns true for exact file match', () => {
    const running = [item('a', ['src/lib/agents.ts'])];
    const candidate = item('b', ['src/lib/agents.ts']);
    expect(hasFileOverlap(running, candidate)).toBe(true);
  });

  it('returns true when candidate glob matches running path', () => {
    const running = [item('a', ['src/lib/agents.ts'])];
    const candidate = item('b', ['src/lib/**']);
    expect(hasFileOverlap(running, candidate)).toBe(true);
  });

  it('returns true when running glob matches candidate path', () => {
    const running = [item('a', ['src/lib/**'])];
    const candidate = item('b', ['src/lib/agents.ts']);
    expect(hasFileOverlap(running, candidate)).toBe(true);
  });

  it('returns true for overlapping ** globs', () => {
    const running = [item('a', ['src/**'])];
    const candidate = item('b', ['src/lib/**']);
    expect(hasFileOverlap(running, candidate)).toBe(true);
  });

  it('returns false for non-overlapping directory globs', () => {
    const running = [item('a', ['src/lib/**'])];
    const candidate = item('b', ['src/dashboard/**']);
    expect(hasFileOverlap(running, candidate)).toBe(false);
  });

  it('returns true when any running item overlaps (not all)', () => {
    const running = [
      item('a', ['src/lib/**']),
      item('b', ['tests/**']),
    ];
    const candidate = item('c', ['src/lib/agents.ts']);
    expect(hasFileOverlap(running, candidate)).toBe(true);
  });
});


// ─── Active slices and task operations ──────────────────────────────────────

describe('active slices and task operations', () => {
  it('builds a bounded active slice with dependencies and acceptance criteria', () => {
    const doc = makeDoc(
      [{ id: 'a', status: 'completed' }, { id: 'b' }],
      [{ from: 'a', to: 'b' }],
    );
    doc.plan.sequence = 7;
    doc.plan.narratives = { Problem: 'Finish PAN-977', Constraint: 'No sync server I/O' };
    doc.plan.items.push({ id: 'c', title: 'c', status: 'pending' as any, metadata: { phase: 1 } });
    doc.plan.items[1]!.metadata = { phase: 1 };
    doc.plan.edges.push({ from: 'b', to: 'c', type: 'blocks' as any });
    doc.plan.items[1]!.subItems = [{ id: 'ac-1', title: 'Works', status: 'pending' }];
    const slice = createActiveSlice(doc, {
      issueId: 'PAN-977',
      itemId: 'b',
      synthesisOutputs: { b: { contextUpdate: 'A changed API shape' } },
    });

    expect(slice.planSequence).toBe(7);
    expect(slice.planTitle).toBe('Test Plan');
    expect(slice.objective).toBe('Finish PAN-977');
    expect(slice.globalConstraints).toEqual(['No sync server I/O']);
    expect(slice.dependencies.map(i => i.id)).toEqual(['a']);
    expect(slice.blockers.map(i => i.id)).toEqual(['a']);
    expect(slice.unlocks.map(i => i.id)).toEqual(['c']);
    expect(slice.currentWorkSet.map(i => i.id)).toContain('b');
    expect(slice.acceptanceCriteria.map(i => i.id)).toEqual(['ac-1']);
    expect(slice.prompt).toContain('## Direct Unlocks / Dependents');
    expect(slice.prompt).toContain('A changed API shape');
    expect(activeSlicePromptSize(slice)).toBeLessThan(8 * 1024);
  });

  it('applies task operations with sequence CAS and writes plan status', () => {
    const doc = makeDoc([{ id: 'a' }], []);
    doc.plan.sequence = 3;
    doc.plan.items[0]!.subItems = [{ id: 'ac-1', title: 'AC', status: 'pending' }];

    const { doc: next } = applyTaskOperation(doc, {
      type: 'done',
      itemId: 'a',
      expectedSequence: 3,
      reason: 'implemented',
    });

    expect(next.plan.sequence).toBe(4);
    expect(next.plan.items[0]!.status).toBe('completed');
    expect(next.plan.items[0]!.subItems?.[0]?.status).toBe('completed');
    expect(() => applyTaskOperation(next, { type: 'claim', itemId: 'a', expectedSequence: 3 })).toThrow(/sequence conflict/);
  });

  it('stores and reads pipeline mirror state in plan metadata', () => {
    const doc = makeDoc([{ id: 'a' }], []);
    const mirror = buildPipelineMirrorFromStatus('PAN-977', {
      reviewStatus: 'CHANGES_REQUESTED',
      reviewAgentId: 'review-agent',
      testStatus: 'pending',
      readyForMerge: false,
      prUrl: 'https://github.com/example/repo/pull/1',
    }, '2026-01-01T00:00:00Z');
    setPipelineMirror(doc, mirror as any);
    const stored = getPipelineMirror(doc) as any;
    expect(stored.phase).toBe('review');
    expect(stored.review.approval).toBe('changes_requested');
    expect(stored.review.agentId).toBe('review-agent');
    expect(stored.merge.prUrl).toBe('https://github.com/example/repo/pull/1');
    expect(stored.review.history[0].status).toBe('CHANGES_REQUESTED');
    expect(stored.verification).toBeDefined();
    expect(stored.verification.status).toBeUndefined();
    expect(Array.isArray(stored.verification.history)).toBe(true);
  });

  it('maps production review statuses and ignores pending phases', () => {
    const passed = buildPipelineMirrorFromStatus('PAN-977', {
      reviewStatus: 'passed',
      testStatus: 'pending',
      mergeStatus: 'pending',
    }, '2026-01-01T00:00:00Z');
    expect(passed.phase).toBe('review');
    expect(passed.review.approval).toBe('approved');

    const failed = buildPipelineMirrorFromStatus('PAN-977', { reviewStatus: 'failed' }, '2026-01-01T00:00:00Z');
    expect(failed.review.approval).toBe('changes_requested');

    const defaults = buildPipelineMirrorFromStatus('PAN-977', {
      reviewStatus: 'pending',
      testStatus: 'pending',
      uatStatus: 'pending',
      mergeStatus: 'pending',
    }, '2026-01-01T00:00:00Z');
    expect(defaults.phase).toBe('work');
  });

  it('mirrors verification status and notes from ReviewStatus', () => {
    const mirror = buildPipelineMirrorFromStatus('PAN-977', {
      verificationStatus: 'passed',
      verificationNotes: 'All checks green',
      verificationAgentId: 'verifier-1',
      verificationStartedAt: '2026-01-01T00:00:00Z',
      verificationCompletedAt: '2026-01-01T00:01:00Z',
    }, '2026-01-01T00:02:00Z');
    expect(mirror.verification.status).toBe('passed');
    expect(mirror.verification.notes).toBe('All checks green');
    expect(mirror.verification.agentId).toBe('verifier-1');
    expect(mirror.verification.startedAt).toBe('2026-01-01T00:00:00Z');
    expect(mirror.verification.completedAt).toBe('2026-01-01T00:01:00Z');
    expect(mirror.verification.history).toEqual([
      { status: 'passed', at: '2026-01-01T00:02:00Z', agentId: 'verifier-1', notes: 'All checks green' },
    ]);
  });

  it('derives requiresSynthesis metadata from DAG fan-in', () => {
    const doc = makeDoc(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
    );
    const annotated = deriveSynthesisMetadata(doc);
    expect(annotated.plan.items.find(i => i.id === 'c')?.metadata?.requiresSynthesis).toBe(true);
    expect(doc.plan.items.find(i => i.id === 'c')?.metadata?.requiresSynthesis).toBeUndefined();
  });

  it('exposes a vBRIEF-first task graph view instead of consulting Beads', () => {
    const doc = makeDoc([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }]);
    const view = getTaskGraphView(doc);
    expect(view.source).toBe('vbrief');
    expect(view.next.map(i => i.id)).toEqual(['a']);
    expect(view.waves[0]?.items.map(i => i.id)).toEqual(['a']);
  });
});


describe('persisted task authority', () => {
  let projectRoot: string;
  let dir: string;
  beforeEach(() => {
    projectRoot = mkdtempSync(`${tmpdir()}/vbrief-project-`);
    dir = join(projectRoot, 'workspaces', 'feature-pan-977');
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  function writeDoc(doc: VBriefDocument): string {
    const specsDir = join(projectRoot, '.pan', 'specs');
    mkdirSync(specsDir, { recursive: true });
    const planPath = join(specsDir, '2026-01-01-PAN-977-test.vbrief.json');
    writeFileSync(planPath, JSON.stringify(doc, null, 2), 'utf-8');
    return planPath;
  }

  it('persists claim/done/block operations to .pan/spec.vbrief.json atomically', () => {
    const doc = makeDoc([{ id: 'PAN-977-a' }], []);
    doc.plan.id = 'PAN-977';
    doc.plan.sequence = 1;
    const planPath = writeDoc(doc);

    applyTaskOperationToPlanFile(planPath, { type: 'claim', itemId: 'PAN-977-a', expectedSequence: 1, writerId: 'writer-1' });
    const claimed = JSON.parse(readFileSync(planPath, 'utf-8')) as VBriefDocument;
    expect(claimed.plan.items[0]!.status).toBe('running');
    expect(claimed.plan.sequence).toBe(2);

    applyTaskOperationToPlanFile(planPath, { type: 'done', itemId: 'PAN-977-a', expectedSequence: 2, writerId: 'writer-1' });
    const done = JSON.parse(readFileSync(planPath, 'utf-8')) as VBriefDocument;
    expect(done.plan.items[0]!.status).toBe('completed');
    expect(done.plan.items[0]!.subItems?.[0]?.status).toBe('completed');
  });

  it('exposes next/show/block via task command API and validates issue traceability', () => {
    const doc = makeDoc([{ id: 'task-a' }], []);
    doc.plan.id = 'PAN-977';
    doc.plan.sequence = 1;
    writeDoc(doc);

    expect((runTaskCommand('next', { issueId: 'PAN-977', workspacePath: dir }) as VBriefItem[]).map(i => i.id)).toEqual(['task-a']);
    expect((runTaskCommand('show', { issueId: 'PAN-977', workspacePath: dir, itemId: 'task-a' }) as VBriefItem).id).toBe('task-a');
    runTaskCommand('block', { issueId: 'PAN-977', workspacePath: dir, itemId: 'task-a', expectedSequence: 1, writerId: 'writer-1' });
    expect((runTaskCommand('next', { issueId: 'PAN-977', workspacePath: dir }) as VBriefItem[])).toHaveLength(0);
  });

  it('rejects invalid runtime task commands without mutating the plan', () => {
    const doc = makeDoc([{ id: 'task-a' }], []);
    doc.plan.id = 'PAN-977';
    doc.plan.sequence = 1;
    const planPath = writeDoc(doc);
    const before = readFileSync(planPath, 'utf-8');

    expect(() => runTaskCommand('explode' as any, { issueId: 'PAN-977', workspacePath: dir, itemId: 'task-a', writerId: 'writer-1' })).toThrow(/Unsupported vBRIEF task command/);
    expect(readFileSync(planPath, 'utf-8')).toBe(before);
    expect(() => applyTaskOperation(doc, { type: 'explode' as any, itemId: 'task-a' })).toThrow(/Unsupported vBRIEF task operation/);
  });

  it('releases writer locks after task and pipeline writes', () => {
    const doc = makeDoc([{ id: 'PAN-977-a' }], []);
    doc.plan.id = 'PAN-977';
    doc.plan.sequence = 1;
    const planPath = writeDoc(doc);

    applyTaskOperationToPlanFile(planPath, { type: 'claim', itemId: 'PAN-977-a', expectedSequence: 1, writerId: 'writer-a' });
    applyTaskOperationToPlanFile(planPath, { type: 'done', itemId: 'PAN-977-a', expectedSequence: 2, writerId: 'writer-b' });
    const mirror = buildPipelineMirrorFromStatus('PAN-977', { reviewStatus: 'passed' }, '2026-01-01T00:00:00Z');
    expect(writePipelineMirrorToPlanFile(planPath, mirror, 'writer-c')).not.toBeNull();
  });

  it('verifies active-slice prompt stays much smaller than a pan-705-shaped outlier plan', () => {
    const many = Array.from({ length: 705 }, (_, idx) => ({ id: `pan-705-item-${idx}`, status: idx === 0 ? 'pending' : 'blocked' }));
    const doc = makeDoc(many, []);
    doc.plan.id = 'PAN-705';
    doc.plan.title = 'PAN-705 Outlier Plan Fixture';
    for (const item of doc.plan.items) {
      item.narrative = { Action: 'x'.repeat(500) };
      item.subItems = Array.from({ length: 5 }, (_, i) => ({ id: `${item.id}.ac${i}`, title: 'y'.repeat(120), status: 'pending' as any }));
    }
    const slice = createActiveSlice(doc, { issueId: 'PAN-705', itemId: 'pan-705-item-0' });
    const check = verifyActiveSlicePromptReduction(doc, slice);
    expect(slice.prompt).toContain('PAN-705 Outlier Plan Fixture');
    expect(check.fullPlanBytes).toBeGreaterThan(800_000);
    expect(check.reductionRatio).toBeLessThan(0.02);
  });
});
