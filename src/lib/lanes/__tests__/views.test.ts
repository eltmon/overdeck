/**
 * PAN-4223 WI-5: derived lane views. Real conversations DB in a temp
 * OVERDECK_HOME; the enriched list, reports' git facts and the clock are injected.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `lane-views-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;
mkdirSync(TEST_HOME, { recursive: true });

vi.mock('../../overdeck/conversation-list.js', () => ({ getEnrichedConversationList: vi.fn(async () => []) }));

const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
const {
  archiveConversation,
  createConversation,
  markConversationEnded,
  updateSpawnError,
} = await import('../../overdeck/conversations.js');
const { writeWorkerReport } = await import('../../agents/worker/report.js');
const { invalidateLaneViews, listLaneViews } = await import('../views.js');

type Role = 'builder' | 'critic' | 'verifier' | 'play' | 'orchestrator';
const GIT = { branch: 'hotel/663', head: 'abc1234', ahead: 0, dirty: false };

function root(name: string): void {
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: TEST_HOME, workspaceId: null });
}

function lane(name: string, parent: string, run: string, key: string, role: Role = 'builder', cwd = join(TEST_HOME, 'lanes', name)): void {
  createConversation({ name, tmuxSession: `conv-${name}`, cwd, workspaceId: null, parentName: parent, lane: { run, key, role } });
}

function deps(enriched: unknown[] = [], now = Date.now()) {
  return {
    enrichedList: vi.fn(async () => enriched),
    gitFacts: vi.fn(async () => GIT),
    now: () => now,
  };
}

beforeEach(() => {
  invalidateLaneViews();
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('listLaneViews (PAN-4223 WI-5)', () => {
  it('derives activity by the D10 table, first match wins', async () => {
    root('d10-root');
    for (const name of ['d10-failed', 'd10-needs', 'd10-working', 'd10-idle', 'd10-starting', 'd10-stopped']) lane(name, 'd10-root', 'd10', name.slice(4));
    updateSpawnError('d10-failed', 'spawn failed');
    markConversationEnded('d10-stopped');
    const enriched = [
      { name: 'd10-failed', sessionAlive: true, isWorking: true },
      { name: 'd10-needs', sessionAlive: true, isWorking: true, pendingInputCount: 1 },
      { name: 'd10-working', sessionAlive: true, isWorking: true },
      { name: 'd10-idle', sessionAlive: true, isWorking: false, pendingInputCount: 0 },
    ];

    const views = await listLaneViews({ run: 'd10' }, deps(enriched));
    expect(Object.fromEntries(views.map((view) => [view.name, view.activity]))).toEqual({
      'd10-failed': 'failed-to-start',
      'd10-needs': 'needs-you',
      'd10-working': 'working',
      'd10-idle': 'idle',
      'd10-starting': 'starting',
      'd10-stopped': 'stopped',
    });
  });

  it('ages an unstarted row out of starting after 3 minutes', async () => {
    root('age-root');
    lane('age-lane', 'age-root', 'age', 'k');
    const [view] = await listLaneViews({ run: 'age' }, deps([], Date.now() + 3 * 60_000 + 1));
    expect(view?.activity).toBe('stopped');
  });

  it('lists an archived lane as stopped with no git facts, and counts it toward later iterations', async () => {
    root('arch-root');
    lane('arch-i1', 'arch-root', 'arch', 'k', 'builder', join(TEST_HOME, 'lanes', 'arch-k'));
    archiveConversation('arch-i1');
    lane('arch-i2', 'arch-root', 'arch', 'k', 'builder', join(TEST_HOME, 'lanes', 'arch-k-i2'));
    lane('arch-i2-reuse', 'arch-root', 'arch', 'k', 'builder', join(TEST_HOME, 'lanes', 'arch-k-i2'));

    const views = await listLaneViews({ run: 'arch' }, deps([{ name: 'arch-i1', sessionAlive: true }]));
    const byName = Object.fromEntries(views.map((view) => [view.name, view]));
    expect(byName['arch-i1']).toMatchObject({ archived: true, activity: 'stopped', git: null, iteration: 1 });
    expect(byName['arch-i2']).toMatchObject({ archived: false, iteration: 2, git: GIT });
    expect(byName['arch-i2-reuse']?.iteration).toBe(2);
  });

  it('counts iterations over the whole (run, key, role) group even when the filter narrows the rows', async () => {
    root('iter-root-a');
    root('iter-root-b');
    lane('iter-a', 'iter-root-a', 'iter', 'k', 'builder', join(TEST_HOME, 'lanes', 'iter-k'));
    lane('iter-b', 'iter-root-b', 'iter', 'k', 'builder', join(TEST_HOME, 'lanes', 'iter-k-i2'));
    const [view] = await listLaneViews({ parentName: 'iter-root-b' }, deps());
    expect(view).toMatchObject({ name: 'iter-b', iteration: 2, parentName: 'iter-root-b' });
  });

  it('omits successors, gives play lanes no git facts, and reports the highest-seq report', async () => {
    root('mix-root');
    createConversation({ name: 'mix-successor', tmuxSession: 'conv-mix-successor', cwd: TEST_HOME, workspaceId: null, parentName: 'mix-root' });
    lane('mix-play', 'mix-root', 'mix', 'cold', 'play');
    lane('mix-builder', 'mix-root', 'mix', 'b');
    await writeWorkerReport('conv-mix-builder', { body: 'first', status: 'blocked' });
    await writeWorkerReport('conv-mix-builder', { body: 'second', git: { head: 'def5678', branch: 'mix/b' } });
    const injected = deps();

    const views = await listLaneViews({ parentName: 'mix-root' }, injected);
    expect(views.map((view) => view.name)).toEqual(['mix-play', 'mix-builder']);
    expect(views[0]).toMatchObject({ role: 'play', git: null, report: null });
    expect(views[1]?.report).toMatchObject({ seq: 2, status: 'done', head: 'def5678', branch: 'mix/b' });
    expect(injected.gitFacts).toHaveBeenCalledTimes(1);
  });

  it('memoizes per filter for 3 s of the injected clock', async () => {
    root('memo-root');
    lane('memo-lane', 'memo-root', 'memo', 'k');
    const now = Date.now();
    const first = await listLaneViews({ run: 'memo' }, deps([], now));
    expect(await listLaneViews({ run: 'memo' }, deps([], now + 2_999))).toBe(first);
    expect(await listLaneViews({ run: 'memo' }, deps([], now + 3_000))).not.toBe(first);
  });

  it('flags a superseded, ended, reported builder i1 as reapable, pointing at i2; i2 is never reapable (view-reapable.ac1)', async () => {
    root('reap-root');
    lane('reap-i1', 'reap-root', 'reap', 'k', 'builder', join(TEST_HOME, 'lanes', 'reap-k'));
    lane('reap-i2', 'reap-root', 'reap', 'k', 'builder', join(TEST_HOME, 'lanes', 'reap-k-i2'));
    await writeWorkerReport('conv-reap-i1', { body: 'done', git: { head: 'abc1234', branch: 'reap/k' } });
    markConversationEnded('reap-i1');

    const views = await listLaneViews({ run: 'reap' }, deps());
    const byName = Object.fromEntries(views.map((view) => [view.name, view]));
    expect(byName['reap-i1']).toMatchObject({ reapable: true, supersededBy: 'reap-i2' });
    expect(byName['reap-i2']).toMatchObject({ reapable: false, supersededBy: null });
  });

  it('still flags i1 reapable under a parent-narrowed filter, since the rule runs over every row of the (run, key) (view-reapable.ac2)', async () => {
    root('reap2-root-a');
    root('reap2-root-b');
    lane('reap2-i1', 'reap2-root-a', 'reap2', 'k', 'builder', join(TEST_HOME, 'lanes', 'reap2-k'));
    lane('reap2-i2', 'reap2-root-b', 'reap2', 'k', 'builder', join(TEST_HOME, 'lanes', 'reap2-k-i2'));
    await writeWorkerReport('conv-reap2-i1', { body: 'done', git: { head: 'def5678', branch: 'reap2/k' } });
    markConversationEnded('reap2-i1');

    const views = await listLaneViews({ parentName: 'reap2-root-a' }, deps());
    expect(views.map((view) => view.name)).toEqual(['reap2-i1']);
    expect(views[0]).toMatchObject({ reapable: true, supersededBy: 'reap2-i2' });
  });

  it('never flags an archived lane as reapable (view-reapable.ac3)', async () => {
    root('reap3-root');
    lane('reap3-i1', 'reap3-root', 'reap3', 'k', 'builder', join(TEST_HOME, 'lanes', 'reap3-k'));
    lane('reap3-i2', 'reap3-root', 'reap3', 'k', 'builder', join(TEST_HOME, 'lanes', 'reap3-k-i2'));
    await writeWorkerReport('conv-reap3-i1', { body: 'done', git: { head: 'fed9876', branch: 'reap3/k' } });
    archiveConversation('reap3-i1');

    const views = await listLaneViews({ run: 'reap3' }, deps([{ name: 'reap3-i1', sessionAlive: true }]));
    const byName = Object.fromEntries(views.map((view) => [view.name, view]));
    expect(byName['reap3-i1']).toMatchObject({ archived: true, reapable: false, supersededBy: null });
  });
});
