import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import type { VBriefDocument } from '../../../../src/lib/vbrief/types.js';
import type { CoordinateSwarmSlotsDeps } from '../../../../src/lib/cloister/deacon-swarm.js';
import { applyStatusOverrides } from '../../../../src/lib/vbrief/io.js';
import { getDispatchableItems } from '../../../../src/lib/vbrief/dag.js';

const mocks = vi.hoisted(() => ({
  listProjectsSync: vi.fn(),
  getReviewStatusSync: vi.fn(),
  setReviewStatusSync: vi.fn(),
  spawnReviewRoleForIssue: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  listProjectsSync: mocks.listProjectsSync,
  findProjectByPathSync: () => null,
  getProjectSwarmHotspots: () => [],
  // PAN-2372 WI-2: getIssueRecordPathForWorkspace now routes through project
  // resolution. These coordination tests keep records at the workspace
  // .pan/records/ fixture path, so treat every issue as unregistered and let
  // the workspace-door fallback resolve it.
  resolveProjectFromIssueSync: () => null,
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mocks.getReviewStatusSync,
  setReviewStatusSync: mocks.setReviewStatusSync,
}));

vi.mock('../../../../src/lib/cloister/review-agent.js', () => ({
  spawnReviewRoleForIssue: mocks.spawnReviewRoleForIssue,
}));

vi.mock('../../../../src/lib/swarm-policy.js', () => ({
  resolveSwarmPolicy: () => ({ mode: 'auto', maxSlots: 3, autoAdvance: true, source: { mode: 'global' } }),
  resolveAutomaticSwarmPolicy: () => ({ policy: { mode: 'auto', source: { mode: 'global' } }, enabled: true }),
  resolveSwarmMaxSlots: (_issueId: string, configured: number) => configured,
}));

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'overdeck-swarm-doneness-'));
  mocks.listProjectsSync.mockReset();
  // PAN-2372: resolveStateReadHomeSync (WI-0) and getIssueRecordPathForWorkspace
  // (WI-2) both consult listProjectsSync(). Production always returns an array;
  // seed a valid default so an unseeded mock never yields undefined and throws.
  // Tests that need a registered project override this with mockReturnValue.
  mocks.listProjectsSync.mockReturnValue([]);
  mocks.getReviewStatusSync.mockReset();
  mocks.setReviewStatusSync.mockReset();
  mocks.spawnReviewRoleForIssue.mockReset();
  mocks.getReviewStatusSync.mockReturnValue(null);
  mocks.spawnReviewRoleForIssue.mockReturnValue(Effect.succeed({ success: true, message: 'dispatched' }));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function makeDoc(issueId: string, itemCount: number): VBriefDocument {
  const now = '2026-07-02T00:00:00.000Z';
  return {
    vBRIEFInfo: {
      version: '0.6',
      created: now,
      author: 'test',
      description: `Plan for ${issueId}`,
    },
    plan: {
      id: issueId.toLowerCase(),
      title: `Plan for ${issueId}`,
      status: 'active',
      created: now,
      updated: now,
      items: Array.from({ length: itemCount }, (_, index) => ({
        id: `wi-${index + 1}`,
        title: `Work item ${index + 1}`,
        status: 'pending',
        metadata: {
          readiness: 'ready',
          files_scope: [`src/example-${index + 1}.ts`],
          files_scope_confidence: 'high',
          verify_commands: ['npm run typecheck'],
          expected_outputs: ['typecheck completes without errors'],
        },
      })),
      edges: [],
    },
  };
}

function writeSpec(projectPath: string, issueId: string, doc: VBriefDocument): void {
  const specsDir = join(projectPath, '.pan', 'specs');
  mkdirSync(specsDir, { recursive: true });
  writeFileSync(join(specsDir, `2026-07-02-${issueId}-test.vbrief.json`), JSON.stringify({
    ...doc,
    status: 'active',
  }, null, 2));
}

function makeAllCompletedDoc(issueId: string, planStatus: string): VBriefDocument {
  const doc = makeDoc(issueId, 2);
  doc.plan.status = planStatus;
  doc.plan.items = doc.plan.items.map(item => ({ ...item, status: 'completed' }));
  return doc;
}

function makeCoordinateDeps(
  issueId: string,
  projectPath: string,
  workspacePath: string,
): CoordinateSwarmSlotsDeps {
  return {
    listFeatureWorkspaces: () => [{ issueId, projectPath, workspacePath }],
    reconcileSlotState: vi.fn(async (reconcileIssueId: string) => ({
      issueId: reconcileIssueId,
      merged: [],
      inFlight: [],
      pending: [],
      branches: [],
      agents: [],
    })),
    listSessionNames: vi.fn(async () => []),
    isPaneDead: vi.fn(async () => false),
    getPaneExitStatus: vi.fn(async () => null),
    getAgentRuntimeState: vi.fn(async () => null),
    getPaneOutputDigest: vi.fn(async () => ''),
    getBranchTipCommitTime: vi.fn(async () => null),
    getSlotBranchAheadCount: vi.fn(async () => 0),
    isSlotWorktreeClean: vi.fn(async () => true),
    sendCompletionNudge: vi.fn(async () => {}),
    slotWorktreeExists: vi.fn(() => false),
    verifyAndMergeSlot: vi.fn(async () => ({
      verified: false,
      merged: false,
      conflicts: false,
      evidence: {
        verifyCommands: [],
        expectedOutputs: [],
        commandOutputs: [],
      },
    })),
    applyTaskOperationToPlanFile: vi.fn(async () => null),
    recordSlotAssignment: vi.fn(),
    clearSlotAssignment: vi.fn(),
    runGitCommand: vi.fn(async () => null),
    registeredSlotCapacityAvailable: vi.fn(() => false),
    tryReserveSwarmSlot: vi.fn(() => false),
    releaseSwarmSlot: vi.fn(),
    spawnRun: vi.fn(async () => null),
    getIssueHold: vi.fn(() => null),
    readStatusOverrides: vi.fn(() => undefined),
    getFinalizedAt: vi.fn(() => undefined),
    setFinalizedAt: vi.fn(),
    shouldDispatch: vi.fn(() => true),
    getMaxSlotIndex: vi.fn(() => 4),
    listSlotAssignments: vi.fn(() => []),
    requestIssueReview: vi.fn(async () => ({ success: true, message: 'dispatched' })),
  };
}

describe('swarm item done-ness survives slot gc (statusOverrides overlay)', () => {
  it('pure mechanism: a completed override removes the item from dispatchable set', () => {
    const doc = makeDoc('PAN-900', 3);
    const merged = applyStatusOverrides(doc, { 'wi-1': 'completed' });

    const dispatchable = getDispatchableItems(merged, new Set()).map(item => item.id);
    expect(dispatchable).toEqual(['wi-2', 'wi-3']);
    // The overlay must not mutate the source document.
    expect(doc.plan.items[0].status).toBe('pending');
  });

  function writeRecordOverrides(projectPath: string, issueLower: string, overrides: Record<string, string>): void {
    const recordsDir = join(projectPath, 'workspaces', `feature-${issueLower}`, '.pan', 'records');
    mkdirSync(recordsDir, { recursive: true });
    writeFileSync(join(recordsDir, `${issueLower}.json`), JSON.stringify({
      issueId: issueLower.toUpperCase(),
      schemaVersion: 1,
      statusOverrides: overrides,
    }, null, 2));
  }

  it('coordinator finalizes an issue whose only remaining items are override-completed', async () => {
    const { execFileSync } = await import('node:child_process');
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-900');
    mkdirSync(workspacePath, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: workspacePath, stdio: 'ignore' });
    git('init', '-b', 'feature/pan-900');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    git('commit', '--allow-empty', '-m', 'base');
    writeSpec(projectPath, 'PAN-900', makeDoc('PAN-900', 2));
    writeRecordOverrides(projectPath, 'pan-900', { 'wi-1': 'completed', 'wi-2': 'completed' });
    mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] finalized PAN-900: issue-level review requested');
    expect(actions).not.toContain('[swarm] considered PAN-900: swarm eligible');
    expect(mocks.setReviewStatusSync).toHaveBeenCalledWith('PAN-900', expect.objectContaining({
      reviewStatus: 'pending',
      testStatus: 'pending',
      reviewRequestedAt: expect.any(String),
    }));
    expect(mocks.spawnReviewRoleForIssue).toHaveBeenCalledWith({
      issueId: 'PAN-900',
      workspace: workspacePath,
      branch: 'feature/pan-900',
    });
  });

  it('coordinator still considers an issue with remaining dispatchable items', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-901'), { recursive: true });
    writeSpec(projectPath, 'PAN-901', makeDoc('PAN-901', 3));
    writeRecordOverrides(projectPath, 'pan-901', { 'wi-1': 'completed' });
    mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] considered PAN-901: swarm eligible');
  });
});

describe('swarm terminal spec guard', () => {
  it('skips a completed all-done spec before requesting issue review', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-906');
    mkdirSync(workspacePath, { recursive: true });
    writeSpec(projectPath, 'PAN-906', makeAllCompletedDoc('PAN-906', 'completed'));
    const deps = makeCoordinateDeps('PAN-906', projectPath, workspacePath);

    const actions = await coordinateSwarmSlots({}, deps);

    expect(actions).toEqual([]);
    expect(deps.reconcileSlotState).not.toHaveBeenCalled();
    expect(deps.requestIssueReview).not.toHaveBeenCalled();
  });

  it('skips a cancelled spec before reconciling slots', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-907');
    mkdirSync(workspacePath, { recursive: true });
    writeSpec(projectPath, 'PAN-907', makeAllCompletedDoc('PAN-907', 'cancelled'));
    const deps = makeCoordinateDeps('PAN-907', projectPath, workspacePath);

    const actions = await coordinateSwarmSlots({}, deps);

    expect(actions).toEqual([]);
    expect(deps.reconcileSlotState).not.toHaveBeenCalled();
  });

  it('continues coordinating a non-terminal approved spec', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-908');
    mkdirSync(workspacePath, { recursive: true });
    const doc = makeDoc('PAN-908', 1);
    doc.plan.status = 'approved';
    writeSpec(projectPath, 'PAN-908', doc);
    const deps = makeCoordinateDeps('PAN-908', projectPath, workspacePath);

    await coordinateSwarmSlots({}, deps);

    expect(deps.reconcileSlotState).toHaveBeenCalledWith('PAN-908', workspacePath, expect.objectContaining({
      plan: expect.objectContaining({ status: 'approved' }),
    }));
  });
});

describe('swarm endgame: merge/cleanup still runs when dispatch is no longer eligible', () => {
  it('gcs a merged slot for an all-completed plan instead of skipping the pass', async () => {
    const { execFileSync } = await import('node:child_process');
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-902');
    mkdirSync(workspacePath, { recursive: true });
    writeSpec(projectPath, 'PAN-902', makeDoc('PAN-902', 2));
    mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);

    // Real git repo so reconcile sees a merged slot branch (tip == HEAD).
    const git = (...args: string[]) => execFileSync('git', args, { cwd: workspacePath, stdio: 'ignore' });
    git('init', '-b', 'feature/pan-902');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    git('commit', '--allow-empty', '-m', 'base');
    git('branch', 'feature/pan-902-slot-1');

    const recordsDir = join(workspacePath, '.pan', 'records');
    mkdirSync(recordsDir, { recursive: true });
    writeFileSync(join(recordsDir, 'pan-902.json'), JSON.stringify({
      issueId: 'PAN-902',
      schemaVersion: 1,
      statusOverrides: { 'wi-1': 'completed', 'wi-2': 'completed' },
      swarm: {
        slotAssignments: [
          { slotIndex: 1, itemId: 'wi-1', agentId: 'agent-pan-902-slot-1', branch: 'feature/pan-902-slot-1', assignedAt: '2026-07-02T00:00:00.000Z' },
        ],
      },
    }, null, 2));

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] considered PAN-902: endgame (merge/cleanup only)');
    expect(actions).toContain('[swarm] gc slot 1 (item wi-1) for PAN-902');
    expect(actions).toContain('[swarm] finalized PAN-902: issue-level review requested');
    expect(actions).not.toContain('[swarm] considered PAN-902: swarm eligible');
  });
});

describe('swarm tail dispatch: an in-progress swarm may finish its last item', () => {
  it('keeps dispatch eligible with one remaining item when completed overrides exist', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-904'), { recursive: true });
    writeSpec(projectPath, 'PAN-904', makeDoc('PAN-904', 2));
    // wi-1 done via a prior swarm wave; only wi-2 remains -> slotEligibleCount 1.
    const recordsDir = join(projectPath, 'workspaces', 'feature-pan-904', '.pan', 'records');
    mkdirSync(recordsDir, { recursive: true });
    writeFileSync(join(recordsDir, 'pan-904.json'), JSON.stringify({
      issueId: 'PAN-904',
      schemaVersion: 1,
      statusOverrides: { 'wi-1': 'completed' },
    }, null, 2));
    mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);

    const actions = await coordinateSwarmSlots();

    expect(actions).toContain('[swarm] considered PAN-904: swarm eligible');
  });

  it('still refuses to START a swarm for a plan with a single eligible item', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-905'), { recursive: true });
    writeSpec(projectPath, 'PAN-905', makeDoc('PAN-905', 1));
    mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);

    const actions = await coordinateSwarmSlots();

    expect(actions).not.toContain('[swarm] considered PAN-905: swarm eligible');
  });
});

describe('PAN-2372 WI-4 unreadable record surfacing (FR-7, AC5)', () => {
  it('warns naming the issue and treats a corrupt record as no overrides instead of silently absent', async () => {
    const { coordinateSwarmSlots } = await import('../../../../src/lib/cloister/deacon-swarm.js');
    const projectPath = join(tempRoot, 'project');
    const workspacePath = join(projectPath, 'workspaces', 'feature-pan-910');
    mkdirSync(workspacePath, { recursive: true });
    writeSpec(projectPath, 'PAN-910', makeDoc('PAN-910', 2));
    // Corrupt record: the file EXISTS but is not parseable JSON.
    // readIssueRecordForWorkspaceSync returns null for the parse failure, and the
    // existsSync check in defaultReadStatusOverrides distinguishes that from a
    // genuinely absent record — surfacing it as a warning instead of silent undefined.
    const recordsDir = join(workspacePath, '.pan', 'records');
    mkdirSync(recordsDir, { recursive: true });
    writeFileSync(join(recordsDir, 'pan-910.json'), '{ this is not valid json');
    mocks.listProjectsSync.mockReturnValue([{ config: { path: projectPath } }]);

    // coordinateSwarmSlots() with no deps uses defaultDeps, whose readStatusOverrides
    // IS the real defaultReadStatusOverrides under test.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const actions = await coordinateSwarmSlots();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[swarm] record unreadable for PAN-910'));
    // Did not throw, and without readable overrides the plan's two pending items are
    // still dispatch-eligible — the corrupt record did not falsely mark anything done.
    expect(actions).toContain('[swarm] considered PAN-910: swarm eligible');
    expect(actions).not.toContain(expect.stringContaining('finalized PAN-910'));
    warnSpy.mockRestore();
  });
});

describe('PAN-2372 WI-6 state-plane-aware worktree clean predicate (FR-9)', () => {
  // defaultIsSlotWorktreeClean now classifies `git status --porcelain` output through the
  // shared isStatePlaneOnlyStatus classifier: state-plane-only dirt (.pan/continue.json,
  // .pan/records/...) reads clean, any source file reads dirty, empty porcelain reads clean.
  // These are real-git tests so the porcelain flows through the actual `git status` the
  // predicate runs — proving the wiring, not just the classifier in isolation.

  async function setupRepo(name: string): Promise<{ repo: string; git: (...args: string[]) => void }> {
    const { execFileSync } = await import('node:child_process');
    const repo = join(tempRoot, name);
    mkdirSync(repo, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '-b', 'main');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    git('commit', '--allow-empty', '-m', 'base');
    return { repo, git };
  }

  it('AC1: porcelain listing only a state-plane path (.pan/continue.json) reads clean', async () => {
    const { defaultIsSlotWorktreeClean } = await import('../../../../src/lib/cloister/deacon-swarm-completion.js');
    const { repo, git } = await setupRepo('clean-state-plane');
    // Track a sibling under .pan/ so git lists the untracked continue.json as an individual
    // state-plane path (a fully-untracked .pan/ would collapse to '?? .pan/'). This models the
    // realistic workspace where .pan/ holds tracked state-plane infrastructure.
    mkdirSync(join(repo, '.pan', 'records'), { recursive: true });
    writeFileSync(join(repo, '.pan', 'records', 'pan-2372.json'), '{"v":1}');
    git('add', '--force', '.pan/records/pan-2372.json');
    git('commit', '-m', 'track state-plane');
    writeFileSync(join(repo, '.pan', 'continue.json'), '{}');

    await expect(defaultIsSlotWorktreeClean(repo)).resolves.toBe(true);
  });

  it('AC2: a modified source file reads dirty', async () => {
    const { defaultIsSlotWorktreeClean } = await import('../../../../src/lib/cloister/deacon-swarm-completion.js');
    const { repo, git } = await setupRepo('dirty-src');
    mkdirSync(join(repo, 'src', 'lib'), { recursive: true });
    writeFileSync(join(repo, 'src', 'lib', 'foo.ts'), 'export const x = 1;\n');
    git('add', 'src/lib/foo.ts');
    git('commit', '-m', 'track src');
    writeFileSync(join(repo, 'src', 'lib', 'foo.ts'), 'export const x = 2;\n');

    await expect(defaultIsSlotWorktreeClean(repo)).resolves.toBe(false);
  });

  it('AC3: an empty worktree reads clean via the shared state-plane classifier', async () => {
    const { defaultIsSlotWorktreeClean } = await import('../../../../src/lib/cloister/deacon-swarm-completion.js');
    const { repo } = await setupRepo('empty-clean');

    // Empty porcelain ⇒ isStatePlaneOnlyStatus is vacuously true ⇒ clean. AC1 (state-plane
    // path ⇒ clean) + AC2 (source path ⇒ dirty) + this empty case together prove the shared
    // classifier is wired, with no local path list introduced.
    await expect(defaultIsSlotWorktreeClean(repo)).resolves.toBe(true);
  });
});
