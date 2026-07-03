/**
 * Tests for the surviving review-agent.ts surface area.
 *
 * PAN-1048 R7 retired every legacy convoy helper. The reviewer/dispatcher
 * behavior they used to model now lives inside the review role itself
 * (roles/review.md for synthesis, plus the four harness-agnostic sub-role
 * templates roles/review-<flavor>.md that the orchestrator inlines into
 * each convoy spawn message).
 *
 * What remains here:
 *   - killAllReviewSessions: pan-down review session reaper
 *   - pan-down integration: cli/index.ts wires the reaper at the right point
 *   - passed-state rerun: workspaces.ts rerun route uses spawnReviewRoleForIssue
 *   - dispatch failure / type-safety regressions on the rerun route
 *   - template/output contract for the four review sub-role prompt templates
 */

import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname } from 'path';

import {
  buildConvoyPrompt,
  isReviewSessionForIssue,
  killAllReviewerSessions,
  killAllReviewSessions,
  resolveReviewMode,
  isExtendedReviewEnabled,
  spawnReviewRoleForIssue,
  spawnReviewSubRoleForIssue,
} from '../../../src/lib/cloister/review-agent.js';

const {
  mockKillSessionAsync,
  mockSaveAgentStateAsync,
  mockSpawnRun,
  mockMessageAgent,
  mockNotifyPipeline,
  mockGetAgentState,
  mockResolveConflictGate,
  mockBuildRealConflictGateDeps,
  mockGetCachedConflictGateMergeability,
  mockSetReviewStatus,
  mockGetReviewStatus,
  mockArchiveFeedbackFiles,
  mockLoadConfigSync,
  mockReadIssueRecordSync,
  mockResolveProjectForIssue,
  mockGetLatestSessionIdSync,
  mockResumeAgent,
  mockWipeAgentStateDirs,
} = vi.hoisted(() => ({
  mockKillSessionAsync: vi.fn().mockResolvedValue(undefined),
  mockSaveAgentStateAsync: vi.fn().mockResolvedValue(undefined),
  mockSpawnRun: vi.fn().mockResolvedValue({ id: 'agent-pan-1059-review-security' }),
  mockMessageAgent: vi.fn().mockResolvedValue(undefined),
  mockNotifyPipeline: vi.fn(),
  mockGetAgentState: vi.fn(() => null),
  mockResolveConflictGate: vi.fn().mockResolvedValue({ gated: false }),
  mockBuildRealConflictGateDeps: vi.fn(() => ({ real: true })),
  mockGetCachedConflictGateMergeability: vi.fn(() => undefined),
  mockSetReviewStatus: vi.fn(),
  mockGetReviewStatus: vi.fn(() => null),
  mockArchiveFeedbackFiles: vi.fn(() => Effect.void),
  mockLoadConfigSync: vi.fn(() => ({ config: {} })),
  mockReadIssueRecordSync: vi.fn(() => null),
  mockResolveProjectForIssue: vi.fn(() => ({ name: 'test', path: '/tmp/project' })),
  mockGetLatestSessionIdSync: vi.fn(() => null),
  mockResumeAgent: vi.fn().mockResolvedValue({ success: false, error: 'no session' }),
  mockWipeAgentStateDirs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/lib/tmux.js', async () => {
  const actual = await vi.importActual('../../../src/lib/tmux.js');
  return {
    ...actual as object,
    listSessionNames: vi.fn(() => Effect.succeed([])),
    sessionExists: vi.fn(() => Effect.succeed(false)),
    sessionExistsSync: vi.fn(() => Effect.succeed(false)),
    killSession: (...args: Parameters<typeof mockKillSessionAsync>) => Effect.promise(() => mockKillSessionAsync(...args)),
    killSessionSync: (...args: Parameters<typeof mockKillSessionAsync>) => Effect.promise(() => mockKillSessionAsync(...args)),
    setOption: vi.fn(() => Effect.void),
    isPaneDead: vi.fn(() => Effect.succeed(false)),
    listPaneValues: vi.fn(() => Effect.succeed([])),
  };
});

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentState: (...args: Parameters<typeof mockGetAgentState>) => Effect.sync(() => mockGetAgentState(...args)),
  getAgentStateSync: (...args: Parameters<typeof mockGetAgentState>) => mockGetAgentState(...args),
  messageAgent: mockMessageAgent,
  saveAgentState: (...args: Parameters<typeof mockSaveAgentStateAsync>) => Effect.promise(() => mockSaveAgentStateAsync(...args)),
  saveAgentStateSync: (...args: Parameters<typeof mockSaveAgentStateAsync>) => Effect.promise(() => mockSaveAgentStateAsync(...args)),
  saveAgentStateProgram: (...args: Parameters<typeof mockSaveAgentStateAsync>) => Effect.promise(() => mockSaveAgentStateAsync(...args)),
  spawnRun: mockSpawnRun,
  getLatestSessionIdSync: mockGetLatestSessionIdSync,
  resumeAgent: mockResumeAgent,
  wipeAgentStateDirs: mockWipeAgentStateDirs,
  getProviderAuthMode: vi.fn(async () => 'apikey'),
}));

vi.mock('../../../src/lib/config-yaml.js', () => ({
  loadConfig: vi.fn(() => ({ config: {} })),
  loadConfigSync: mockLoadConfigSync,
  resolveModel: vi.fn(() => 'configured-reviewer-model'),
}));

vi.mock('../../../src/lib/pan-dir/record.js', () => ({
  readIssueRecordSync: mockReadIssueRecordSync,
  resolveProjectForIssue: mockResolveProjectForIssue,
  writeAgentHarnessModelSync: vi.fn(),
}));

vi.mock('../../../src/lib/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/paths.js')>();
  return {
    ...actual,
    AGENTS_DIR: '/tmp/pan-review-agent-test-agents',
  };
});

vi.mock('../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: mockNotifyPipeline,
  notifyPipelineSync: mockNotifyPipeline,
}));

vi.mock('../../../src/lib/review-status.js', () => ({
  getReviewStatusSync: mockGetReviewStatus,
  setReviewStatusSync: mockSetReviewStatus,
}));

vi.mock('../../../src/lib/cloister/conflict-gate.js', () => ({
  buildRealConflictGateDeps: mockBuildRealConflictGateDeps,
  resolveConflictGate: mockResolveConflictGate,
  getCachedConflictGateMergeability: mockGetCachedConflictGateMergeability,
}));

vi.mock('../../../src/lib/cloister/feedback-writer.js', () => ({
  archiveFeedbackFiles: mockArchiveFeedbackFiles,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSpawnRun.mockResolvedValue({ id: 'agent-pan-1059-review-security' });
  mockKillSessionAsync.mockResolvedValue(undefined);
  mockSaveAgentStateAsync.mockResolvedValue(undefined);
  mockMessageAgent.mockResolvedValue(undefined);
  mockGetAgentState.mockReturnValue(null);
  mockGetReviewStatus.mockReturnValue(null);
  mockLoadConfigSync.mockReturnValue({ config: {} });
  mockReadIssueRecordSync.mockReturnValue(null);
  mockResolveProjectForIssue.mockReturnValue({ name: 'test', path: '/tmp/project' });
  mockGetLatestSessionIdSync.mockReturnValue(null);
  mockResumeAgent.mockResolvedValue({ success: false, error: 'no session' });
  mockWipeAgentStateDirs.mockResolvedValue(undefined);
  mockBuildRealConflictGateDeps.mockReturnValue({ real: true });
  mockResolveConflictGate.mockResolvedValue({ gated: false });
  mockGetCachedConflictGateMergeability.mockReturnValue(undefined);
  mockArchiveFeedbackFiles.mockReturnValue(Effect.void);
});

const REVIEW_MODE_WORKSPACE = '/tmp/pan-review-mode';
const REVIEW_AGENT_DEFAULT_WORKSPACE = '/tmp/pan-review-agent-default';
const REVIEW_AGENT_SUBROLE_WORKSPACE = '/tmp/pan-review-agent-subrole';
const REVIEW_AGENT_RUN_ID = 'agent-pan-1059-review-abcdef12';

function minimalReviewContextManifest(manifestPath: string) {
  return {
    runId: REVIEW_AGENT_RUN_ID,
    issueId: 'PAN-1059',
    generatedAt: '2026-01-01T00:00:00.000Z',
    branch: 'feature/pan-1059',
    headSha: 'abcdef12',
    diff: { stat: 'src/example.ts | 1 +', truncated: true },
    changedFiles: [
      {
        path: 'src/example.ts',
        status: 'M',
        additions: 1,
        deletions: 0,
        riskScore: 3,
      },
    ],
    largeChangeset: { fileCount: 1, changedLines: 1, isLarge: false },
    acceptanceCriteria: ['Preserve review prompt wiring'],
    nonGoals: [],
    traces: [],
    policyNotes: [],
    stubUiFindings: [],
    manifestPath,
  };
}

function prepareWorkspace(path: string): void {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function writeReviewManifest(workspace: string): string {
  const manifestPath = `${workspace}/.pan/review/${REVIEW_AGENT_RUN_ID}/context.json`;
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(
    manifestPath,
    JSON.stringify(minimalReviewContextManifest(manifestPath), null, 2),
    'utf-8',
  );
  return manifestPath;
}

describe('review mode resolution', () => {
  it('defaults to quick when neither the issue record nor config sets review mode', () => {
    expect(resolveReviewMode('PAN-1982')).toBe('quick');
    expect(isExtendedReviewEnabled('PAN-1982')).toBe(false);

    expect(mockResolveProjectForIssue).toHaveBeenCalledWith('PAN-1982');
    expect(mockReadIssueRecordSync).toHaveBeenCalledWith({ name: 'test', path: '/tmp/project' }, 'PAN-1982');
    expect(mockLoadConfigSync).toHaveBeenCalled();
  });

  it('uses full mode from merged config when no per-issue override exists', () => {
    mockLoadConfigSync.mockReturnValue({
      config: { roles: { review: { model: 'workhorse:expensive', mode: 'full' } } },
    });

    expect(resolveReviewMode('PAN-1982')).toBe('full');
    expect(isExtendedReviewEnabled('PAN-1982')).toBe(true);
  });

  it('uses per-issue reviewMode over merged project and global config', () => {
    mockLoadConfigSync.mockReturnValue({
      config: { roles: { review: { model: 'workhorse:expensive', mode: 'quick' } } },
    });
    mockReadIssueRecordSync.mockReturnValue({ reviewMode: 'full' });

    expect(resolveReviewMode('PAN-1982')).toBe('full');
    expect(isExtendedReviewEnabled('PAN-1982')).toBe(true);
    expect(mockLoadConfigSync).not.toHaveBeenCalled();
  });
});

// ── killAllReviewSessions ─────────────────────────────────────────────────────
// PAN-931: pan down must kill review sessions so they don't survive dashboard
// restart and block new review dispatch. The legacy coordinator naming pattern
// (review-coordinator-*) and reviewer naming patterns (canonical PAN-830 +
// legacy timestamp form) all need to be reaped.

describe('killAllReviewSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawnRun.mockResolvedValue({ id: 'agent-pan-1059-review-security' });
    mockKillSessionAsync.mockResolvedValue(undefined);
  });

  it('kills current role-primitive review sessions', async () => {
    const { listSessionNames } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNames).mockReturnValue(Effect.succeed([
      'agent-pan-999-review',
      'agent-pan-999-review-security',
      'agent-pan-999-review-correctness',
      'agent-pan-999',
      'agent-pan-999-work',
    ]));

    const result = await Effect.runPromise(killAllReviewSessions());

    expect(result.killed).toEqual(expect.arrayContaining([
      'agent-pan-999-review',
      'agent-pan-999-review-security',
      'agent-pan-999-review-correctness',
    ]));
    expect(result.killed).toHaveLength(3);
    expect(mockKillSessionAsync).toHaveBeenCalledTimes(3);
  });

  it('kills coordinator sessions', async () => {
    const { listSessionNames } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNames).mockReturnValue(Effect.succeed([
      'review-coordinator-PAN-999-1234567890000',
      'review-coordinator-PAN-888-1234567890001',
      'agent-pan-999',
    ]));

    const result = await Effect.runPromise(killAllReviewSessions());

    expect(result.killed).toContain('review-coordinator-PAN-999-1234567890000');
    expect(result.killed).toContain('review-coordinator-PAN-888-1234567890001');
    expect(result.killed).toHaveLength(2);
    expect(mockKillSessionAsync).toHaveBeenCalledTimes(2);
  });

  it('kills canonical reviewer sessions (PAN-830 naming)', async () => {
    const { listSessionNames } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNames).mockReturnValue(Effect.succeed([
      'specialist-overdeck-PAN-999-review-correctness',
      'specialist-overdeck-PAN-999-review-security',
      'agent-pan-999',
    ]));

    const result = await Effect.runPromise(killAllReviewSessions());

    expect(result.killed).toContain('specialist-overdeck-PAN-999-review-correctness');
    expect(result.killed).toContain('specialist-overdeck-PAN-999-review-security');
    expect(result.killed).toHaveLength(2);
  });

  it('kills legacy timestamp-based reviewer sessions', async () => {
    const { listSessionNames } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNames).mockReturnValue(Effect.succeed([
      'review-PAN-999-1713456789000-correctness',
      'review-PAN-999-1713456789000-security',
    ]));

    const result = await Effect.runPromise(killAllReviewSessions());

    expect(result.killed).toContain('review-PAN-999-1713456789000-correctness');
    expect(result.killed).toContain('review-PAN-999-1713456789000-security');
    expect(result.killed).toHaveLength(2);
  });

  it('returns empty when no review sessions exist', async () => {
    const { listSessionNames } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNames).mockReturnValue(Effect.succeed([
      'agent-pan-999',
      'overdeck-dashboard',
    ]));

    const result = await Effect.runPromise(killAllReviewSessions());

    expect(result.killed).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(mockKillSessionAsync).not.toHaveBeenCalled();
  });

  it('reports failed kills without throwing', async () => {
    const { listSessionNames } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNames).mockReturnValue(Effect.succeed([
      'review-coordinator-PAN-999-1234567890000',
    ]));
    mockKillSessionAsync.mockRejectedValueOnce(new Error('session not found'));

    const result = await Effect.runPromise(killAllReviewSessions());

    expect(result.killed).toHaveLength(0);
    expect(result.failed).toContain('review-coordinator-PAN-999-1234567890000');
  });
});

// ── issue-scoped review abort/restart cleanup ─────────────────────────────────

describe('killAllReviewerSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockKillSessionAsync.mockResolvedValue(undefined);
  });

  it('kills the parent review orchestrator before convoy sessions exist', async () => {
    const { listSessionNames } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNames).mockReturnValue(Effect.succeed([
      'agent-pan-1080-review',
      'agent-pan-1080',
      'agent-pan-999-review',
    ]));

    const result = await Effect.runPromise(killAllReviewerSessions('overdeck', 'PAN-1080'));

    expect(result.killed).toEqual(['agent-pan-1080-review']);
    expect(mockKillSessionAsync).toHaveBeenCalledWith('agent-pan-1080-review');
  });

  it('kills the parent review orchestrator and full convoy sessions', async () => {
    const { listSessionNames } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNames).mockReturnValue(Effect.succeed([
      'agent-pan-1080-review',
      'agent-pan-1080-review-security',
      'agent-pan-1080-review-correctness',
      'specialist-overdeck-pan-1080-review-performance',
      'specialist-overdeck-pan-1080-review-requirements',
      'review-coordinator-pan-1080-1234567890',
      'agent-pan-1080',
    ]));

    const result = await Effect.runPromise(killAllReviewerSessions('overdeck', 'PAN-1080'));

    expect(result.killed).toEqual(expect.arrayContaining([
      'agent-pan-1080-review',
      'agent-pan-1080-review-security',
      'agent-pan-1080-review-correctness',
      'specialist-overdeck-pan-1080-review-performance',
      'specialist-overdeck-pan-1080-review-requirements',
      'review-coordinator-pan-1080-1234567890',
    ]));
    expect(result.killed).toHaveLength(6);
    expect(mockKillSessionAsync).toHaveBeenCalledTimes(6);
  });

  it('matches only review sessions for the requested issue', () => {
    expect(isReviewSessionForIssue('agent-pan-1080-review', 'overdeck', 'PAN-1080')).toBe(true);
    expect(isReviewSessionForIssue('agent-pan-1080-review-security', 'overdeck', 'PAN-1080')).toBe(true);
    expect(isReviewSessionForIssue('agent-pan-1080', 'overdeck', 'PAN-1080')).toBe(false);
    expect(isReviewSessionForIssue('agent-pan-1081-review', 'overdeck', 'PAN-1080')).toBe(false);
  });
});

// ── conflict gate dispatch deferral (PAN-1765) ────────────────────────────────

describe('spawnReviewRoleForIssue conflict gate', () => {
  it('defers review without spawning or archiving feedback when conflict-gated', async () => {
    mockResolveConflictGate.mockResolvedValue({
      gated: true,
      reason: 'merge conflict with main must be resolved before review dispatch; conflict resolver dispatched',
    });

    const result = await Effect.runPromise(spawnReviewRoleForIssue({
      issueId: 'PAN-1765',
      workspace: '/tmp/pan-review-gated',
      branch: 'feature/pan-1765',
      force: true,
    }));

    expect(result).toEqual({
      success: false,
      gated: true,
      message: 'Review dispatch deferred: merge conflict with main must be resolved before review dispatch; conflict resolver dispatched',
    });
    expect(mockResolveConflictGate).toHaveBeenCalledWith(
      'PAN-1765',
      '/tmp/pan-review-gated',
      'main',
      { real: true },
    );
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-1765', {
      reviewStatus: 'pending',
      reviewNotes: 'Review dispatch deferred: merge conflict with main must be resolved before review dispatch; conflict resolver dispatched',
    });
    expect(mockSpawnRun).not.toHaveBeenCalled();
    expect(mockArchiveFeedbackFiles).not.toHaveBeenCalled();
  });

  it('places the gate before feedback archiving and review-spawn status writes', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const agentSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/lib/cloister/review-agent.ts'),
      'utf-8',
    );

    const dispatchBlock = agentSrc.match(
      /const gate = await resolveConflictGate[\s\S]*?setReviewStatusSync\(opts\.issueId, \{\s*reviewStatus: 'reviewing'/,
    );
    expect(dispatchBlock).not.toBeNull();
    const block = dispatchBlock![0];
    expect(block.indexOf('resolveConflictGate')).toBeLessThan(block.indexOf('archiveFeedbackFiles'));
    expect(block).toContain('if (gate.gated)');
    expect(block).toContain('return { success: false, gated: true, message }');
  });
});

// ── review mode fan-out dispatch ─────────────────────────────────────────────

describe('spawnReviewRoleForIssue review mode fan-out', () => {
  const reviewOpts = {
    issueId: 'PAN-1982',
    workspace: REVIEW_MODE_WORKSPACE,
    branch: 'feature/pan-1982',
    force: true,
  };

  beforeEach(() => {
    prepareWorkspace(REVIEW_MODE_WORKSPACE);
    mockSpawnRun.mockImplementation(async (issueId: string, _role: string, options: { subRole?: string }) => ({
      id: options.subRole
        ? `agent-${issueId.toLowerCase()}-review-${options.subRole}`
        : `agent-${issueId.toLowerCase()}-review`,
    }));
  });

  it('quick mode spawns only the parent self-review session', async () => {
    mockReadIssueRecordSync.mockReturnValue({ reviewMode: 'quick' });

    const result = await Effect.runPromise(spawnReviewRoleForIssue(reviewOpts));

    expect(result).toEqual({
      success: true,
      message: 'Self-review spawned: agent-pan-1982-review',
    });
    expect(mockSpawnRun).toHaveBeenCalledTimes(1);
    const [_issueId, _role, parentOptions] = mockSpawnRun.mock.calls[0];
    expect(parentOptions).not.toHaveProperty('subRole');
    expect(parentOptions.prompt).toContain('you are the sole reviewer');
    expect(parentOptions.prompt).not.toContain('STANDBY');
  });

  it('full mode branches to synthesis prompt and fans out every sub-reviewer lane', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const agentSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/lib/cloister/review-agent.ts'),
      'utf-8',
    );

    const dispatchBlock = agentSrc.match(
      /const fullReview = isExtendedReviewEnabled\(opts\.issueId\);[\s\S]*?Review role \(self-review\) spawned/,
    );
    expect(dispatchBlock).not.toBeNull();
    const block = dispatchBlock![0];

    expect(block).toContain('buildReviewRolePrompt');
    expect(block).toContain('buildSelfReviewPrompt');
    expect(block).toContain('REVIEW_SUB_ROLES.map');
    expect(block).toContain('spawnReviewSubRoleForIssue');
    expect(block).toContain('...(opts.model ? { model: opts.model } : {})');
    expect(block).toContain('...(opts.harness ? { harness: opts.harness } : {})');
    expect(block).toContain('message: `Convoy review spawned: ${run.id}`');
  });

  it('full mode re-review resumes the parent before reusing the convoy fan-out path', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const agentSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/lib/cloister/review-agent.ts'),
      'utf-8',
    );

    const resumeBlock = agentSrc.match(
      /if \(canResumeReview\) \{[\s\S]*?falling back to a fresh session/,
    );
    expect(resumeBlock).not.toBeNull();
    const block = resumeBlock![0];

    expect(block).toContain('resumeAgent(reviewAgentId, prompt)');
    expect(block).toContain('if (fullReview)');
    expect(block).toContain('await spawnConvoyReviewers(reviewAgentId)');
    expect(block).toContain('Convoy review resumed (session preserved)');
  });
});

// ── pan down integration (PAN-931) ────────────────────────────────────────────
// Regression: verifies that `pan down` imports and calls killAllReviewSessions
// so review sessions are cleaned up during dashboard shutdown.

describe('pan down integration (PAN-931)', () => {
  it('src/cli/index.ts imports killAllReviewSessions from review-agent.js', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(import.meta.dirname, '../../../src/cli/index.ts'),
      'utf-8',
    );
    expect(src).toContain('killAllReviewSessions');
    expect(src).toContain("import('../lib/cloister/review-agent.js')");
  });

  it('src/cli/index.ts calls killAllReviewSessions inside the down command handler', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(import.meta.dirname, '../../../src/cli/index.ts'),
      'utf-8',
    );
    // Isolate the down command block: from `.command('down')` to the next `.command(`
    const downBlockMatch = src.match(/\.command\(['"]down['"]\)[\s\S]*?\.command\(/);
    expect(downBlockMatch).not.toBeNull();
    const downBlock = downBlockMatch![0];
    expect(downBlock).toContain('killAllReviewSessions');
    expect(downBlock).toContain('killed');
    expect(downBlock).toContain('failed');
  });

  it('pan down calls killAllReviewSessions after dashboard stop and before Traefik stop', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(import.meta.dirname, '../../../src/cli/index.ts'),
      'utf-8',
    );
    const downBlockMatch = src.match(/\.command\(['"]down['"]\)[\s\S]*?\.command\(/);
    expect(downBlockMatch).not.toBeNull();
    const downBlock = downBlockMatch![0];

    // Dashboard stop comes before review session cleanup
    const dashboardStopIdx = downBlock.indexOf('stopDashboard');
    const reviewCleanupIdx = downBlock.indexOf('killAllReviewSessions');
    const traefikStopIdx = downBlock.indexOf('docker compose down');

    expect(dashboardStopIdx).toBeGreaterThanOrEqual(0);
    expect(reviewCleanupIdx).toBeGreaterThanOrEqual(0);
    expect(traefikStopIdx).toBeGreaterThanOrEqual(0);
    expect(reviewCleanupIdx).toBeGreaterThan(dashboardStopIdx);
    expect(reviewCleanupIdx).toBeLessThan(traefikStopIdx);
  });
});

// ── reviewStatus type-safety: 'dispatch_failed' must not appear ──────────────
// Regression: the request-review route previously wrote reviewStatus='dispatch_failed',
// which is not in the ReviewStatus.reviewStatus union (only testStatus permits it).
// The route must use 'failed' for reviewStatus so the type contract is maintained.

describe('reviewStatus type-safety regression', () => {
  it('review-pipeline.ts request-review route does not write reviewStatus=dispatch_failed', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces/review-pipeline.ts'),
      'utf-8',
    );
    const requestReviewMatch = routeSrc.match(
      /const postWorkspaceRequestReviewRoute[\s\S]*?export const reviewPipelineRouteLayer/,
    );
    expect(requestReviewMatch).not.toBeNull();
    const requestReviewBlock = requestReviewMatch![0];

    // 'dispatch_failed' may appear in testStatus assignments (allowed by the type),
    // but reviewStatus must never be set to 'dispatch_failed'.
    const reviewStatusDispatchFailed = requestReviewBlock.match(
      /reviewStatus\s*:\s*['"]dispatch_failed['"]/g,
    );
    expect(reviewStatusDispatchFailed).toBeNull();
  });
});

// ── passed-state rerun uses spawnReviewRoleForIssue ──────────────────────────
// Regression: the passed-state rerun path in /api/review/:issueId/request must
// use the role-primitive review spawner (PAN-1048 R3) so role-routed model
// resolution and the unified spawnRun pipeline are applied consistently.
// Replaces the dispatchParallelReview pin from the legacy `pan review run`
// coordinator era.

describe('request-review fresh convoy regression', () => {
  it('forces review respawn so stale synthesis sessions cannot short-circuit re-review', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces/review-pipeline.ts'),
      'utf-8',
    );
    const requestReviewMatch = routeSrc.match(
      /const postWorkspaceRequestReviewRoute[\s\S]*?export const reviewPipelineRouteLayer/,
    );
    expect(requestReviewMatch).not.toBeNull();
    const requestReviewBlock = requestReviewMatch![0];

    expect(requestReviewBlock).toContain('spawnReviewRoleForIssue');
    expect(requestReviewBlock).toMatch(/force:\s*true/);
  });
});

// ── stale synthesis session detection (PAN-1131) ─────────────────────────────
// The synthesis agent never self-terminates (it runs `Bash(exit)`, a subshell
// exit — the Claude process stays idle-alive with a live pane). The
// spawnReviewRoleForIssue idempotency guard must therefore NOT treat
// "pane alive" alone as "actively reviewing": it must compare the existing
// synthesis session's persisted reviewRunId against the current HEAD and kill
// the convoy when they differ. Otherwise non-force re-dispatch (the
// onIssueStateChange path after a work agent's `pan done`) jams forever.

describe('stale synthesis session detection (PAN-1131)', () => {
  it('idempotency guard compares persisted reviewRunId to current HEAD before skipping', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const agentSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/lib/cloister/review-agent.ts'),
      'utf-8',
    );

    const guardMatch = agentSrc.match(
      /async function spawnReviewRoleForIssuePromise[\s\S]*?archiveFeedbackFiles/,
    );
    expect(guardMatch).not.toBeNull();
    const guardBlock = guardMatch![0];

    // The guard must consult the existing session's reviewRunId …
    expect(guardBlock).toContain('reviewRunId');
    // … derived from a HEAD probe, and use it to decide staleness.
    expect(guardBlock).toMatch(/staleRunId/);
    expect(guardBlock).toContain('git rev-parse --short=8 HEAD');
    // … and the "skip" path must require NOT-stale, not just pane-alive.
    expect(guardBlock).toMatch(/!paneDead && !opts\.force && !staleRunId/);
  });

  it('persists reviewRunId onto the synthesis agent state after spawn', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const agentSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/lib/cloister/review-agent.ts'),
      'utf-8',
    );

    const spawnMatch = agentSrc.match(
      /const run = await spawnRun\(opts\.issueId, 'review'[\s\S]*?Review role \(self-review\) spawned/,
    );
    expect(spawnMatch).not.toBeNull();
    const spawnBlock = spawnMatch![0];

    expect(spawnBlock).toMatch(/run\.reviewRunId = runId/);
    expect(spawnBlock).toContain('saveAgentState(run)');
  });
});

describe('passed-state rerun regression', () => {
  it('review-pipeline.ts request-review route rejects dirty workspaces before rerun dispatch', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces/review-pipeline.ts'),
      'utf-8',
    );

    const rerunBlockMatch = routeSrc.match(
      /shouldTreatAsRerun\(existingStatus\)[\s\S]*?rerun:\s*true/,
    );
    expect(rerunBlockMatch).not.toBeNull();
    const rerunBlock = rerunBlockMatch![0];

    expect(rerunBlock).toContain('getDirtyWorkspaceErrorForReviewRequest');
    expect(rerunBlock).toContain('dirty workspace on rerun path');
  });

  it('review-pipeline.ts request-review route uses spawnReviewRoleForIssue in the rerun path', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces/review-pipeline.ts'),
      'utf-8',
    );

    // Find the passed-state IIFE block: between the shouldTreatAsRerun(existingStatus) call
    // and the early return that sends rerun:true.
    const rerunBlockMatch = routeSrc.match(
      /shouldTreatAsRerun\(existingStatus\)[\s\S]*?rerun:\s*true/,
    );
    expect(rerunBlockMatch).not.toBeNull();
    const rerunBlock = rerunBlockMatch![0];

    expect(rerunBlock).toContain('spawnReviewRoleForIssue');
    // Negative assertion guards against accidental fallback to the legacy paths.
    expect(rerunBlock).not.toContain('dispatchParallelReview');
    expect(rerunBlock).not.toContain('runParallelReview');
    expect(rerunBlock).not.toContain('pan review run');
  });
});

// ── template/output contract ──────────────────────────────────────────────────
// Convoy sub-role prompts are harness-agnostic templates owned by Overdeck.
// They live in roles/review-<sub-role>.md and are inlined into each convoy
// spawn message by the orchestrator. Each template tells one reviewer to read
// the shared context manifest and write one report to its assigned output
// file, which synthesis polls and consumes.

import { readFileSync } from 'fs';
import { resolve } from 'path';

function readTemplate(subRole: string): string {
  const templatePath = resolve(
    import.meta.dirname,
    '../../../roles',
    `review-${subRole}.md`,
  );
  return readFileSync(templatePath, 'utf-8');
}

describe('template/output contract', () => {
  const reviewerSubRoles = ['correctness', 'security', 'performance', 'requirements'];

  describe('sub-role templates are harness-agnostic prompts (no Claude frontmatter)', () => {
    for (const role of reviewerSubRoles) {
      it(`${role}: has no YAML frontmatter (orchestrator inlines the body, no --agent load)`, () => {
        const content = readTemplate(role);
        expect(content.startsWith('---')).toBe(false);
      });
    }
  });

  describe('sub-role templates write one manifest-scoped report', () => {
    for (const role of reviewerSubRoles) {
      it(`${role}: does NOT hardcode .claude/reviews/ path`, () => {
        const content = readTemplate(role);
        expect(content).not.toContain('.claude/reviews/');
      });

      it(`${role}: instructs writing to an assigned output file`, () => {
        const content = readTemplate(role);
        expect(content).toMatch(/output file/i);
      });

      it(`${role}: reads the context manifest before review`, () => {
        const content = readTemplate(role);
        expect(content).toMatch(/Context manifest/i);
        expect(content).toMatch(/read on demand/i);
        expect(content).not.toMatch(/complete 3 review passes/i);
        expect(content).not.toMatch(/changed file for context/i);
      });

      it(`${role}: instructs exactly one final output-file report, launcher owns the signal (PAN-977)`, () => {
        const content = readTemplate(role);
        expect(content).toMatch(/Write exactly one final report to the output file/i);
        // PAN-977: the launcher signals synthesis on process exit — the
        // template must NOT tell the agent to run `pan tell` or exit itself.
        expect(content).not.toMatch(/pan tell/i);
        expect(content).not.toMatch(/exit Claude Code cleanly/i);
        expect(content).toMatch(/launcher .* signals the synthesis agent/i);
      });
    }
  });
});

// ── convoy orchestration ──────────────────────────────────────────────────────

describe('convoy orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentState.mockReturnValue(null);
    mockSpawnRun.mockResolvedValue({ id: 'agent-pan-1059-review-security' });
    mockGetAgentState.mockReturnValue(null);
    prepareWorkspace(REVIEW_AGENT_DEFAULT_WORKSPACE);
    prepareWorkspace(REVIEW_AGENT_SUBROLE_WORKSPACE);
    writeReviewManifest(REVIEW_AGENT_DEFAULT_WORKSPACE);
    writeReviewManifest(REVIEW_AGENT_SUBROLE_WORKSPACE);
  });

  it('builds a manifest-scoped convoy prompt for one sub-role', async () => {
    const prompt = await Effect.runPromise(buildConvoyPrompt({
      issueId: 'PAN-1059',
      subRole: 'security',
      outputPath: '/home/test/.overdeck/agents/agent-pan-1059-review-security/review-security.md',
      synthesisAgentId: 'agent-pan-1059-review',
      contextManifestPath: '/workspace/.pan/review/run-1/context.json',
    }));

    expect(prompt).toContain('REVIEW TASK for PAN-1059 — SECURITY REVIEW');
    expect(prompt).toContain('/home/test/.overdeck/agents/agent-pan-1059-review-security/review-security.md');
    expect(prompt).toContain('/workspace/.pan/review/run-1/context.json');
    // PAN-977: the reviewer no longer signals synthesis itself — the launcher
    // owns REVIEWER_READY/FAILED/TIMEOUT on process exit. The prompt must not
    // tell the agent to run `pan tell`.
    expect(prompt).not.toContain('pan tell');
    expect(prompt).toContain('launcher that started you detects your completion');
    expect(prompt).toContain('Write exactly one final report to the output file');
    expect(prompt).not.toContain('.claude/reviews/');
  });

  it('uses run-scoped output paths by default', async () => {
    const manifestPath = writeReviewManifest(REVIEW_AGENT_DEFAULT_WORKSPACE);

    const result = await Effect.runPromise(spawnReviewSubRoleForIssue({
      issueId: 'PAN-1059',
      workspace: REVIEW_AGENT_DEFAULT_WORKSPACE,
      subRole: 'security',
      runId: REVIEW_AGENT_RUN_ID,
      contextManifestPath: manifestPath,
    }));

    expect(result.success).toBe(true);
    const expectedOutput = `${REVIEW_AGENT_DEFAULT_WORKSPACE}/.pan/review/${REVIEW_AGENT_RUN_ID}/security.md`;
    expect(mockSpawnRun).toHaveBeenCalledWith('PAN-1059', 'review', expect.objectContaining({
      allowHost: false,
      reviewOutputPath: expectedOutput,
    }));
    expect(mockSaveAgentStateAsync).toHaveBeenCalledWith(expect.objectContaining({
      reviewOutputPath: expectedOutput,
    }));
  });

  it('spawns a reviewer as a review sub-role session with the resolved model', async () => {
    const manifestPath = writeReviewManifest(REVIEW_AGENT_SUBROLE_WORKSPACE);

    const result = await Effect.runPromise(spawnReviewSubRoleForIssue({
      issueId: 'PAN-1059',
      workspace: REVIEW_AGENT_SUBROLE_WORKSPACE,
      subRole: 'security',
      runId: REVIEW_AGENT_RUN_ID,
      outputPath: '/tmp/pan-review-agent-test-security.md',
      contextManifestPath: manifestPath,
    }));

    expect(result).toMatchObject({
      success: true,
      sessionId: 'agent-pan-1059-review-security',
    });
    expect(mockSpawnRun).toHaveBeenCalledWith('PAN-1059', 'review', expect.objectContaining({
      workspace: REVIEW_AGENT_SUBROLE_WORKSPACE,
      subRole: 'security',
      model: 'configured-reviewer-model',
      allowHost: false,
      prompt: expect.stringContaining('REVIEW TASK for PAN-1059 — SECURITY REVIEW'),
    }));
    expect(mockSaveAgentStateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: 'agent-pan-1059-review-security',
      reviewSubRole: 'security',
      reviewRunId: REVIEW_AGENT_RUN_ID,
      reviewOutputPath: '/tmp/pan-review-agent-test-security.md',
      reviewSynthesisAgentId: 'agent-pan-1059-review',
      reviewDeadlineAt: expect.any(String),
    }));
    expect(mockNotifyPipeline).toHaveBeenCalledWith({
      type: 'reviewer_started',
      issueId: 'PAN-1059',
      role: 'security',
      sessionName: 'agent-pan-1059-review-security',
    });
  });
});

// ── deacon gated review deferral (PAN-1765) ───────────────────────────────────

describe('deacon gated review deferral', () => {
  it('deacon treats gated review dispatch as deferred, not failed, and releases the advancing slot', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const deaconSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/lib/cloister/deacon.ts'),
      'utf-8',
    );

    expect(deaconSrc).toContain('releaseAdvancingSlot');
    expect(deaconSrc).toContain('if (dispatchResult.gated)');
    expect(deaconSrc).toContain('Deferred review re-dispatch for');
    expect(deaconSrc).toContain('Deferred post-review re-dispatch for');

    const gatedBlocks = deaconSrc.match(/if \(dispatchResult\.gated\) \{[\s\S]*?\n\s*\}/g) ?? [];
    expect(gatedBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of gatedBlocks) {
      expect(block).toContain('releaseAdvancingSlot()');
      expect(block).not.toContain('reviewRetryCount');
      expect(block).not.toContain('Failed to re-dispatch');
    }
  });

  it('startup recovery logs gated dispatch as a deferral', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const serviceSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/lib/cloister/service.ts'),
      'utf-8',
    );

    const recoveryBlock = serviceSrc.match(/const dispatchResult = await Effect\.runPromise\(spawnReviewRoleForIssue[\s\S]*?Re-dispatched recovery review/);
    expect(recoveryBlock).not.toBeNull();
    expect(recoveryBlock![0]).toContain('if (dispatchResult.gated)');
    expect(recoveryBlock![0]).toContain('Deferred recovery review');
  });
});

// ── dispatch failure sets 'pending' not 'failed' ─────────────────────────────
// Regression: dispatch failures must set reviewStatus='pending' so the deacon
// can retry. The deacon at deacon.ts only re-dispatches when reviewStatus===
// 'pending'; setting 'failed' leaves reviews permanently stuck after a transient
// dispatch error (e.g., tmux not ready, file-system issue).

describe('dispatch failure reviewStatus regression', () => {
  it('review-pipeline.ts request-review route blocks dirty worktrees before verification', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces/review-pipeline.ts'),
      'utf-8',
    );
    const requestReviewMatch = routeSrc.match(
      /const postWorkspaceRequestReviewRoute[\s\S]*?export const reviewPipelineRouteLayer/,
    );
    expect(requestReviewMatch).not.toBeNull();
    const requestReviewBlock = requestReviewMatch![0];

    const dirtyIdx = requestReviewBlock.indexOf('getDirtyWorkspaceErrorForReviewRequest(workspacePath, workspaceInfo)');
    const verifyIdx = requestReviewBlock.indexOf('runVerificationForIssue(');
    expect(dirtyIdx).toBeGreaterThanOrEqual(0);
    expect(verifyIdx).toBeGreaterThanOrEqual(0);
    expect(dirtyIdx).toBeLessThan(verifyIdx);
    expect(requestReviewBlock).toContain('dirtyWorkspaceError');
    expect(requestReviewBlock).not.toContain('Effect.promise(() => runVerificationForIssue(');
    expect(requestReviewBlock).not.toContain('Effect.promise(() => getWorkspaceGitInfo(');
  });

  it('review-pipeline.ts request-review route yields the verification Effect directly', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces/review-pipeline.ts'),
      'utf-8',
    );
    const requestReviewMatch = routeSrc.match(
      /const postWorkspaceRequestReviewRoute[\s\S]*?export const reviewPipelineRouteLayer/,
    );
    expect(requestReviewMatch).not.toBeNull();
    const requestReviewBlock = requestReviewMatch![0];

    expect(requestReviewBlock).toContain('yield* runVerificationForIssue(');
    expect(requestReviewBlock).not.toContain('Effect.promise(() => runVerificationForIssue(');
    expect(requestReviewBlock).not.toContain('Effect.promise(() => getWorkspaceGitInfo(');
  });

  it('specialists review restart route returns 409 for gated dispatches', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/specialists/project-routes.ts'),
      'utf-8',
    );

    const restartMatch = routeSrc.match(
      /postProjectReviewRestartRoute[\s\S]*?postProjectReviewerRoleRestartRoute/,
    );
    expect(restartMatch).not.toBeNull();
    const restartBlock = restartMatch![0];

    expect(restartBlock).toContain('if (result.gated)');
    expect(restartBlock).toContain('gated: true');
    expect(restartBlock).toContain('message: result.message');
    expect(restartBlock).toContain('{ status: 409 }');
  });

  it('review-pipeline.ts review request routes treat gated dispatches as deferrals', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces/review-pipeline.ts'),
      'utf-8',
    );
    const requestReviewMatch = routeSrc.match(
      /const postWorkspaceRequestReviewRoute[\s\S]*?export const reviewPipelineRouteLayer/,
    );
    expect(requestReviewMatch).not.toBeNull();
    const requestReviewBlock = requestReviewMatch![0];

    expect(routeSrc).toContain('reviewResult.gated');
    expect(requestReviewBlock).toContain('Review deferred for');
    expect(requestReviewBlock).toContain('gated: true');
    expect(requestReviewBlock).toContain('{ status: 409 }');
    expect(requestReviewBlock).toContain('reviewNotes: result.message');
  });

  it('merge-ops.ts approve route treats gated dispatches as deferrals', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces/merge-ops.ts'),
      'utf-8',
    );

    const approveMatch = routeSrc.match(
      /POST \/api\/issues\/:issueId\/approve[\s\S]*?Fallback \(PAN-1531\): direct server-side rebase/,
    );
    expect(approveMatch).not.toBeNull();
    const approveBlock = approveMatch![0];

    expect(approveBlock).toContain('gated?: boolean');
    expect(approveBlock).toContain('if (reviewResult.gated)');
    expect(approveBlock).toContain('review dispatch deferred for');
    expect(approveBlock).toContain('gated: true');
    expect(approveBlock).toContain("pipeline: 'deferred'");
    expect(approveBlock).toContain('{ status: 409 }');
    expect(approveBlock).toContain('return jsonResponse');
    expect(approveBlock).toContain('setReviewStatusBase(issueId, {');
  });

  it('review-pipeline.ts dispatch failure paths set reviewStatus=pending not failed', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces/review-pipeline.ts'),
      'utf-8',
    );
    const requestReviewMatch = routeSrc.match(
      /const postWorkspaceRequestReviewRoute[\s\S]*?export const reviewPipelineRouteLayer/,
    );
    expect(requestReviewMatch).not.toBeNull();
    const requestReviewBlock = requestReviewMatch![0];

    // reviewStatus must never be set to 'failed' in a dispatch error/catch path
    const dispatchFailedMatches = requestReviewBlock.match(
      /(?:Dispatch failed|Dispatch error|Failed to start review)[\s\S]{0,200}reviewStatus\s*:\s*['"]failed['"]/g,
    );
    expect(dispatchFailedMatches).toBeNull();

    // Verify the dispatch error paths explicitly set 'pending'
    const pendingMatches = requestReviewBlock.match(
      /reviewStatus\s*:\s*['"]pending['"]/g,
    );
    expect(pendingMatches).not.toBeNull();
    expect(pendingMatches!.length).toBeGreaterThanOrEqual(4);
  });
});
