import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import {
  classifyInFlightSlots,
  dispatchNextWave,
  mergeReadySlots,
  recordFailedMergeBlock,
  recoverFailedMergeSlot,
  resetSwarmLoopSafetyForTests,
  swarmJanitorPass,
  type CoordinateSwarmSlotsDeps,
} from '../../src/lib/cloister/deacon-swarm.js';
import { createMinimalIssueRecord } from '../../src/lib/cloister/deacon-swarm-record.js';
import { writeIssueRecordForWorkspaceSync } from '../../src/lib/pan-dir/record.js';
import { analyzeSwarmReadiness } from '../../src/lib/xbrief/swarm-readiness.js';
import type { XBriefDocument, XBriefItem } from '../../src/lib/xbrief/types.js';
import { cleanupGitRecordRoot, initGitRecordRoot, removeGitRecordRemote } from '../helpers/git-record-fixture.js';

const issueId = 'PAN-3680';
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Overdeck Test', GIT_AUTHOR_EMAIL: 'test@overdeck.local',
  GIT_COMMITTER_NAME: 'Overdeck Test', GIT_COMMITTER_EMAIL: 'test@overdeck.local',
};

describe('scripted swarm foreman over a sparse polyrepo', () => {
  let workspace: string;
  let slotWorkspace: string;
  let recordRemote: string;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T00:00:00Z'));
    resetSwarmLoopSafetyForTests();
    workspace = mkdtempSync(join(tmpdir(), 'pan-3680-polyrepo-'));
    slotWorkspace = `${workspace}-slot-1`;
    mkdirSync(slotWorkspace, { recursive: true });
    recordRemote = initGitRecordRoot(workspace);
    initMemberRepo(workspace, 'fe', 'src/app.ts');
    initMemberRepo(workspace, 'api', 'db/schema.sql');
    initMemberRepo(slotWorkspace, 'fe', 'src/app.ts');
    writeIssueRecordForWorkspaceSync(workspace, issueId, createMinimalIssueRecord(issueId));
  });

  afterEach(async () => {
    vi.useRealTimers();
    delete process.env.PAN_SWARM_STALL_THRESHOLD_MS;
    removeGitRecordRemote(recordRemote);
    await cleanupGitRecordRoot(workspace);
    rmSync(workspace, { recursive: true, force: true });
    rmSync(slotWorkspace, { recursive: true, force: true });
  });

  it('drives dispatch, wait, merge, stall notification, isolation failure, and reclaim', async () => {
    const doc = plan();
    const spawnedItems: string[] = [];
    const gateDeps = dispatchDeps(spawnedItems);

    const firstWave = await dispatchNextWave(issueId, workspace, doc, emptyReconciled(), analyzeSwarmReadiness(doc), gateDeps);

    expect(spawnedItems[0]).toBe('schema');
    expect(spawnedItems).not.toContain('entities');
    expect(firstWave.some(action => action.includes('(item schema)'))).toBe(true);

    const liveSchema = { itemId: 'schema', slotIndex: 1, status: 'in_flight' as const, branch: 'feature/pan-3680-slot-1', agentId: 'agent-pan-3680-slot-1' };
    const running = await classifyInFlightSlots([liveSchema], classificationDeps(false), { workspacePath: workspace, issueId });
    expect(running[0]?.lifecycle).toBe('running');
    expect(running[0]?.status).not.toBe('merged');

    const ready = await classifyInFlightSlots([liveSchema], classificationDeps(true), { workspacePath: workspace, issueId });
    expect(ready[0]?.lifecycle).toBe('ready-to-merge');
    const mergeDeps = {
      verifyAndMergeSlot: vi.fn(async () => ({ verified: true, merged: true, conflicts: false, evidence: { verifyCommands: [], expectedOutputs: [], commandOutputs: [] } })),
      applyTaskOperationToPlanFile: vi.fn(async () => undefined),
      stopSlotAgent: vi.fn(async () => undefined),
      fireTieredCommitHooks: vi.fn(async () => []),
    } as unknown as CoordinateSwarmSlotsDeps;
    const merged = await mergeReadySlots(issueId, workspace, doc, ready, mergeDeps);
    expect(merged).toContain('[swarm] merged slot 1 (item schema) for PAN-3680');

    const afterSchema = structuredClone(doc);
    afterSchema.plan.items.find(item => item.id === 'schema')!.status = 'completed';
    const secondWaveItems: string[] = [];
    await dispatchNextWave(issueId, workspace, afterSchema, {
      ...emptyReconciled(),
      merged: [{ ...liveSchema, status: 'merged' as const }],
      inFlight: [{ itemId: 'audit', slotIndex: 2, status: 'in_flight' as const, agentId: 'agent-pan-3680-slot-2' }],
    }, analyzeSwarmReadiness(afterSchema), dispatchDeps(secondWaveItems));
    expect(secondWaveItems).toContain('entities');

    writeFileSync(join(workspace, 'api', 'db/schema.sql'), 'unsafe shared-primary edit\n');
    const isolation = inspectScopedDiff(workspace, slotWorkspace, 'api/db/schema.sql');
    expect(isolation).toMatchObject({ outsideSlot: true, paths: ['api/db/schema.sql'] });

    process.env.PAN_SWARM_STALL_THRESHOLD_MS = String(30 * 60_000);
    const sendStallEvent = vi.fn(async () => undefined);
    const janitorDeps = stallJanitorDeps(workspace, doc, liveSchema, sendStallEvent);
    await swarmJanitorPass(janitorDeps);
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1);
    await swarmJanitorPass(janitorDeps);
    expect(sendStallEvent).toHaveBeenCalledWith('agent-pan-3680', '[swarm-event] slot 1 stalled (no progress 30m)');

    writeIssueRecordForWorkspaceSync(workspace, issueId, {
      ...createMinimalIssueRecord(issueId),
      swarm: { slotAssignments: [{ slotIndex: 3, itemId: 'entities', agentId: 'agent-pan-3680-slot-3' }] },
    });
    await recordFailedMergeBlock({ issueId, itemId: 'entities', slotIndex: 3, branch: 'feature/pan-3680-slot-3', note: 'isolation failure' }, workspace);
    const reclaimDeps = {
      applyTaskOperationToPlanFile: vi.fn(async () => undefined), clearSlotAssignment: vi.fn(async () => undefined),
      recordForemanTakeover: vi.fn(async () => undefined), runGitCommand: vi.fn(async () => ({ stdout: '' })),
    } as unknown as CoordinateSwarmSlotsDeps;
    const reclaimed = await recoverFailedMergeSlot(issueId, workspace, 3, afterSchema, 'reclaim', reclaimDeps);
    expect(reclaimed).toEqual(['[swarm] reclaimed slot 3 (item entities) for foreman implementation in PAN-3680']);
    expect(reclaimDeps.clearSlotAssignment).toHaveBeenCalledWith(workspace, issueId, 3, 'entities');
  });
});

function item(id: string, path: string): XBriefItem {
  return { id, title: id, status: 'pending', metadata: { readiness: 'ready', files_scope: [path], files_scope_confidence: 'high', verify_commands: ['npm test'], expected_outputs: ['passes'] } };
}

function plan(): XBriefDocument {
  return { xBRIEFInfo: { version: '0.8' }, plan: { id: issueId, title: 'polyrepo', status: 'active', items: [item('schema', 'api/db/schema.sql'), item('entities', 'api/src/entities.ts'), item('audit', 'fe/src/audit.ts')], edges: [{ from: 'schema', to: 'entities', type: 'blocks' }] } } as XBriefDocument;
}

function emptyReconciled() {
  return { issueId, merged: [], inFlight: [], pending: [], branches: [], agents: [] };
}

function dispatchDeps(spawnedItems: string[]): CoordinateSwarmSlotsDeps {
  return {
    registeredSlotCapacityAvailable: vi.fn(() => true), tryReserveSwarmSlot: vi.fn(() => true), releaseSwarmSlot: vi.fn(),
    applyTaskOperationToPlanFile: vi.fn(async () => undefined), recordSlotAssignment: vi.fn(async () => undefined), clearSlotAssignment: vi.fn(async () => undefined),
    spawnRun: vi.fn(async (_issue, _role, options) => { spawnedItems.push(options.slotItemId!); }), shouldDispatch: vi.fn(() => true),
    readSwarmHold: vi.fn(() => undefined), getMaxSlotIndex: vi.fn(() => 3), listSlotAssignments: vi.fn(() => []), listSessionNames: vi.fn(async () => []), slotWorktreeExists: vi.fn(() => false),
  } as unknown as CoordinateSwarmSlotsDeps;
}

function classificationDeps(completed: boolean): CoordinateSwarmSlotsDeps {
  return {
    listSessionNames: vi.fn(async () => ['agent-pan-3680-slot-1']), isPaneDead: vi.fn(async () => false), getPaneExitStatus: vi.fn(async () => null),
    getAgentRuntimeState: vi.fn(async () => null),
    readSlotCompletion: vi.fn(() => completed ? ({
      slotIndex: 1,
      itemId: 'schema',
      agentId: 'agent-pan-3680-slot-1',
      completedAt: '2026-08-14T00:00:00.000Z',
    }) : undefined),
    clearCompletionObservation: vi.fn(async () => undefined),
  } as unknown as CoordinateSwarmSlotsDeps;
}

function stallJanitorDeps(workspacePath: string, doc: XBriefDocument, slot: { itemId: string; slotIndex: number; status: 'in_flight'; branch: string; agentId: string }, sendStallEvent: ReturnType<typeof vi.fn>): CoordinateSwarmSlotsDeps {
  return {
    listFeatureWorkspaces: vi.fn(() => [{ issueId, workspacePath, projectPath: '/repo' }]),
    findSpecByIssue: vi.fn(() => Effect.succeed({ document: doc })), reconcileSlotState: vi.fn(async () => ({ ...emptyReconciled(), inFlight: [slot] })),
    listSessionNames: vi.fn(async () => ['agent-pan-3680', 'agent-pan-3680-slot-1']), isPaneDead: vi.fn(async () => false), getPaneExitStatus: vi.fn(async () => null),
    getAgentRuntimeState: vi.fn(async () => null), getPaneOutputDigest: vi.fn(async () => 'unchanged'), getBranchTipCommitTime: vi.fn(async () => 1),
    readSlotCompletion: vi.fn(() => undefined), clearCompletionObservation: vi.fn(async () => undefined), listSlotAssignments: vi.fn(() => [{ slotIndex: 1 }]),
    readSwarmHold: vi.fn(() => undefined), clearSlotAssignment: vi.fn(async () => undefined), runGitCommand: vi.fn(async () => ({ stdout: '' })), slotWorktreeExists: vi.fn(() => false), sendStallEvent,
    resolveAutomaticSwarmPolicy: vi.fn(() => ({ policy: { mode: 'auto', maxSlots: 3, autoAdvance: true, source: { mode: 'test', maxSlots: 'test', autoAdvance: 'test' } }, spawnForeman: false, requireSwarmReadiness: false, advanceWavesWithoutConfirmation: true, reason: 'not-ready' })),
  } as unknown as CoordinateSwarmSlotsDeps;
}

function initMemberRepo(root: string, repo: string, file: string): void {
  const dir = join(root, repo);
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, env: gitEnv });
  writeFileSync(join(dir, file), 'baseline\n');
  execFileSync('git', ['add', '.'], { cwd: dir, env: gitEnv });
  execFileSync('git', ['commit', '-m', 'baseline'], { cwd: dir, env: gitEnv });
}

function inspectScopedDiff(primary: string, slot: string, scopedPath: string): { outsideSlot: boolean; paths: string[] } {
  const [repo, ...parts] = scopedPath.split('/');
  const slotRepo = join(slot, repo!);
  const repoRoot = parts.length > 0 && !existsAt(slotRepo) ? join(primary, repo!) : slotRepo;
  const paths = execFileSync('git', ['diff', '--name-only'], { cwd: repoRoot, encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(path => `${repo}/${path}`);
  return { outsideSlot: relative(slot, repoRoot).startsWith('..'), paths };
}

function existsAt(path: string): boolean {
  try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: path, stdio: 'ignore' }); return true; } catch { return false; }
}
