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

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  buildConvoyPrompt,
  isReviewSessionForIssue,
  killAllReviewerSessions,
  killAllReviewSessions,
  spawnReviewRoleForIssue,
  spawnReviewSubRoleForIssue,
} from '../../../src/lib/cloister/review-agent.js';

const { mockKillSessionAsync, mockSaveAgentStateAsync, mockSpawnRun, mockMessageAgent, mockNotifyPipeline, mockGetAgentState } = vi.hoisted(() => ({
  mockKillSessionAsync: vi.fn().mockResolvedValue(undefined),
  mockSaveAgentStateAsync: vi.fn().mockResolvedValue(undefined),
  mockSpawnRun: vi.fn().mockResolvedValue({ id: 'agent-pan-1059-review-security' }),
  mockMessageAgent: vi.fn().mockResolvedValue(undefined),
  mockNotifyPipeline: vi.fn(),
<<<<<<< HEAD
  mockGetAgentState: vi.fn(() => null),
=======
  mockGetAgentState: vi.fn().mockReturnValue(null),
>>>>>>> 7e4a88e3e (test(review): align verification mocks with rebase logic)
}));

vi.mock('../../../src/lib/tmux.js', async () => {
  const actual = await vi.importActual('../../../src/lib/tmux.js');
  return {
    ...actual as object,
    listSessionNamesAsync: vi.fn().mockResolvedValue([]),
    sessionExistsAsync: vi.fn().mockResolvedValue(false),
    killSessionAsync: mockKillSessionAsync,
    setOptionAsync: vi.fn().mockResolvedValue(undefined),
    isPaneDeadAsync: vi.fn().mockResolvedValue(false),
    listPaneValuesAsync: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../../src/lib/agents.js', () => ({
  getAgentState: mockGetAgentState,
  messageAgent: mockMessageAgent,
  saveAgentStateAsync: mockSaveAgentStateAsync,
  spawnRun: mockSpawnRun,
}));

vi.mock('../../../src/lib/config-yaml.js', () => ({
  loadConfig: vi.fn(() => ({ config: {} })),
  resolveModel: vi.fn(() => 'configured-reviewer-model'),
}));

vi.mock('../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: mockNotifyPipeline,
}));

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
    const { listSessionNamesAsync } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNamesAsync).mockResolvedValue([
      'agent-pan-999-review',
      'agent-pan-999-review-security',
      'agent-pan-999-review-correctness',
      'agent-pan-999',
      'agent-pan-999-work',
    ]);

    const result = await killAllReviewSessions();

    expect(result.killed).toEqual(expect.arrayContaining([
      'agent-pan-999-review',
      'agent-pan-999-review-security',
      'agent-pan-999-review-correctness',
    ]));
    expect(result.killed).toHaveLength(3);
    expect(mockKillSessionAsync).toHaveBeenCalledTimes(3);
  });

  it('kills coordinator sessions', async () => {
    const { listSessionNamesAsync } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNamesAsync).mockResolvedValue([
      'review-coordinator-PAN-999-1234567890000',
      'review-coordinator-PAN-888-1234567890001',
      'agent-pan-999',
    ]);

    const result = await killAllReviewSessions();

    expect(result.killed).toContain('review-coordinator-PAN-999-1234567890000');
    expect(result.killed).toContain('review-coordinator-PAN-888-1234567890001');
    expect(result.killed).toHaveLength(2);
    expect(mockKillSessionAsync).toHaveBeenCalledTimes(2);
  });

  it('kills canonical reviewer sessions (PAN-830 naming)', async () => {
    const { listSessionNamesAsync } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNamesAsync).mockResolvedValue([
      'specialist-panopticon-cli-PAN-999-review-correctness',
      'specialist-panopticon-cli-PAN-999-review-security',
      'agent-pan-999',
    ]);

    const result = await killAllReviewSessions();

    expect(result.killed).toContain('specialist-panopticon-cli-PAN-999-review-correctness');
    expect(result.killed).toContain('specialist-panopticon-cli-PAN-999-review-security');
    expect(result.killed).toHaveLength(2);
  });

  it('kills legacy timestamp-based reviewer sessions', async () => {
    const { listSessionNamesAsync } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNamesAsync).mockResolvedValue([
      'review-PAN-999-1713456789000-correctness',
      'review-PAN-999-1713456789000-security',
    ]);

    const result = await killAllReviewSessions();

    expect(result.killed).toContain('review-PAN-999-1713456789000-correctness');
    expect(result.killed).toContain('review-PAN-999-1713456789000-security');
    expect(result.killed).toHaveLength(2);
  });

  it('returns empty when no review sessions exist', async () => {
    const { listSessionNamesAsync } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNamesAsync).mockResolvedValue([
      'agent-pan-999',
      'panopticon-dashboard',
    ]);

    const result = await killAllReviewSessions();

    expect(result.killed).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
    expect(mockKillSessionAsync).not.toHaveBeenCalled();
  });

  it('reports failed kills without throwing', async () => {
    const { listSessionNamesAsync } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNamesAsync).mockResolvedValue([
      'review-coordinator-PAN-999-1234567890000',
    ]);
    mockKillSessionAsync.mockRejectedValueOnce(new Error('session not found'));

    const result = await killAllReviewSessions();

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
    const { listSessionNamesAsync } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNamesAsync).mockResolvedValue([
      'agent-pan-1080-review',
      'agent-pan-1080',
      'agent-pan-999-review',
    ]);

    const result = await killAllReviewerSessions('panopticon-cli', 'PAN-1080');

    expect(result.killed).toEqual(['agent-pan-1080-review']);
    expect(mockKillSessionAsync).toHaveBeenCalledWith('agent-pan-1080-review');
  });

  it('kills the parent review orchestrator and full convoy sessions', async () => {
    const { listSessionNamesAsync } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNamesAsync).mockResolvedValue([
      'agent-pan-1080-review',
      'agent-pan-1080-review-security',
      'agent-pan-1080-review-correctness',
      'specialist-panopticon-cli-pan-1080-review-performance',
      'specialist-panopticon-cli-pan-1080-review-requirements',
      'review-coordinator-pan-1080-1234567890',
      'agent-pan-1080',
    ]);

    const result = await killAllReviewerSessions('panopticon-cli', 'PAN-1080');

    expect(result.killed).toEqual(expect.arrayContaining([
      'agent-pan-1080-review',
      'agent-pan-1080-review-security',
      'agent-pan-1080-review-correctness',
      'specialist-panopticon-cli-pan-1080-review-performance',
      'specialist-panopticon-cli-pan-1080-review-requirements',
      'review-coordinator-pan-1080-1234567890',
    ]));
    expect(result.killed).toHaveLength(6);
    expect(mockKillSessionAsync).toHaveBeenCalledTimes(6);
  });

  it('matches only review sessions for the requested issue', () => {
    expect(isReviewSessionForIssue('agent-pan-1080-review', 'panopticon-cli', 'PAN-1080')).toBe(true);
    expect(isReviewSessionForIssue('agent-pan-1080-review-security', 'panopticon-cli', 'PAN-1080')).toBe(true);
    expect(isReviewSessionForIssue('agent-pan-1080', 'panopticon-cli', 'PAN-1080')).toBe(false);
    expect(isReviewSessionForIssue('agent-pan-1081-review', 'panopticon-cli', 'PAN-1080')).toBe(false);
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
  it('workspaces.ts request-review route does not write reviewStatus=dispatch_failed', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces.ts'),
      'utf-8',
    );

    const requestReviewMatch = routeSrc.match(
      /postWorkspaceRequestReviewRoute[\s\S]*?postWorkspaceResetReviewRoute/,
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
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces.ts'),
      'utf-8',
    );

    const requestReviewMatch = routeSrc.match(
      /postWorkspaceRequestReviewRoute[\s\S]*?postWorkspaceResetReviewRoute/,
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
      /export async function spawnReviewRoleForIssue[\s\S]*?archiveFeedbackFiles/,
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
      /const run = await spawnRun\(opts\.issueId, 'review'[\s\S]*?Review role \(synthesis\) spawned/,
    );
    expect(spawnMatch).not.toBeNull();
    const spawnBlock = spawnMatch![0];

    expect(spawnBlock).toMatch(/run\.reviewRunId = runId/);
    expect(spawnBlock).toContain('saveAgentStateAsync(run)');
  });
});

describe('passed-state rerun regression', () => {
  it('workspaces.ts request-review route rejects dirty workspaces before rerun dispatch', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces.ts'),
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

  it('workspaces.ts request-review route uses spawnReviewRoleForIssue in the rerun path', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces.ts'),
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
// Convoy sub-role prompts are harness-agnostic templates owned by Panopticon.
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
  });

  it('builds a manifest-scoped convoy prompt for one sub-role', async () => {
    const prompt = await buildConvoyPrompt({
      issueId: 'PAN-1059',
      subRole: 'security',
      outputPath: '/home/test/.panopticon/agents/agent-pan-1059-review-security/review-security.md',
      synthesisAgentId: 'agent-pan-1059-review',
      contextManifestPath: '/workspace/.pan/review/run-1/context.json',
    });

    expect(prompt).toContain('REVIEW TASK for PAN-1059 — SECURITY REVIEW');
    expect(prompt).toContain('/home/test/.panopticon/agents/agent-pan-1059-review-security/review-security.md');
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
    const result = await spawnReviewSubRoleForIssue({
      issueId: 'PAN-1059',
      workspace: '/tmp/pan-review-agent-default',
      subRole: 'security',
      runId: 'agent-pan-1059-review-abcdef12',
      contextManifestPath: '/tmp/pan-review-agent-default/.pan/review/agent-pan-1059-review-abcdef12/context.json',
    });

    expect(result.success).toBe(true);
    const expectedOutput = '/tmp/pan-review-agent-default/.pan/review/agent-pan-1059-review-abcdef12/security.md';
    expect(mockSpawnRun).toHaveBeenCalledWith('PAN-1059', 'review', expect.objectContaining({
      allowHost: false,
      reviewOutputPath: expectedOutput,
    }));
    expect(mockSaveAgentStateAsync).toHaveBeenCalledWith(expect.objectContaining({
      reviewOutputPath: expectedOutput,
    }));
  });

  it('spawns a reviewer as a review sub-role session with the resolved model', async () => {
    const result = await spawnReviewSubRoleForIssue({
      issueId: 'PAN-1059',
      workspace: '/workspace',
      subRole: 'security',
      runId: 'agent-pan-1059-review-abcdef12',
      outputPath: '/tmp/pan-review-agent-test-security.md',
      contextManifestPath: '/workspace/.pan/review/agent-pan-1059-review-abcdef12/context.json',
    });

    expect(result).toMatchObject({
      success: true,
      sessionId: 'agent-pan-1059-review-security',
    });
    expect(mockSpawnRun).toHaveBeenCalledWith('PAN-1059', 'review', expect.objectContaining({
      workspace: '/workspace',
      subRole: 'security',
      model: 'configured-reviewer-model',
      allowHost: false,
      prompt: expect.stringContaining('REVIEW TASK for PAN-1059 — SECURITY REVIEW'),
    }));
    expect(mockSaveAgentStateAsync).toHaveBeenCalledWith(expect.objectContaining({
      id: 'agent-pan-1059-review-security',
      reviewSubRole: 'security',
      reviewRunId: 'agent-pan-1059-review-abcdef12',
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

// ── dispatch failure sets 'pending' not 'failed' ─────────────────────────────
// Regression: dispatch failures must set reviewStatus='pending' so the deacon
// can retry. The deacon at deacon.ts only re-dispatches when reviewStatus===
// 'pending'; setting 'failed' leaves reviews permanently stuck after a transient
// dispatch error (e.g., tmux not ready, file-system issue).

describe('dispatch failure reviewStatus regression', () => {
  it('workspaces.ts request-review route blocks dirty worktrees before verification', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces.ts'),
      'utf-8',
    );

    const requestReviewMatch = routeSrc.match(
      /postWorkspaceRequestReviewRoute[\s\S]*?postWorkspaceResetReviewRoute/,
    );
    expect(requestReviewMatch).not.toBeNull();
    const requestReviewBlock = requestReviewMatch![0];

    const dirtyIdx = requestReviewBlock.indexOf('getDirtyWorkspaceErrorForReviewRequest(workspacePath, workspaceInfo)');
    const verifyIdx = requestReviewBlock.indexOf('runVerificationForIssue(');
    expect(dirtyIdx).toBeGreaterThanOrEqual(0);
    expect(verifyIdx).toBeGreaterThanOrEqual(0);
    expect(dirtyIdx).toBeLessThan(verifyIdx);
    expect(requestReviewBlock).toContain('dirtyWorkspaceError');
  });

  it('workspaces.ts dispatch failure paths set reviewStatus=pending not failed', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, '../../../src/dashboard/server/routes/workspaces.ts'),
      'utf-8',
    );

    // Extract the request-review route block
    const requestReviewMatch = routeSrc.match(
      /postWorkspaceRequestReviewRoute[\s\S]*?postWorkspaceResetReviewRoute/,
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
