/**
 * Tests for the surviving review-agent.ts surface area.
 *
 * PAN-1048 R7 retired every legacy convoy helper (parseReviewerTemplate,
 * resolveReviewerModel, parseReviewSynthesis, getReviewAgents,
 * reviewResultToReviewStatus, getFilesChangedFromPR, buildReviewFeedbackBody,
 * resolvePromptTemplatePath, spawnSingleReviewer, waitForReviewer,
 * selectCompletedReviewers, archiveReviewerRound, parseAgentOutput,
 * buildReviewBaseCommand, ReviewerOutcome / ReviewerWaitResult /
 * ReviewerFailureReason / ReviewContext / ReviewResult / ReviewerTemplate /
 * ReviewerRoundArtifact / ReviewHistoryEntry types, DEFAULT_REVIEW_AGENTS,
 * REVIEW_TIMEOUT_MS, REVIEW_HISTORY_DIR / FILE, SPECIALISTS_DIR). Their
 * tests went with them. The reviewer/dispatcher behavior they used to model
 * now lives inside the review role itself (roles/review.md plus the four
 * .claude/agents/code-review-*.md sub-agent definitions).
 *
 * What remains here:
 *   - killAllReviewSessions: pan-down review session reaper
 *   - pan-down integration: cli/index.ts wires the reaper at the right point
 *   - passed-state rerun: workspaces.ts rerun route uses spawnReviewRoleForIssue
 *   - dispatch failure / type-safety regressions on the rerun route
 *   - template/output contract for the four code-review-* sub-agent definitions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { killAllReviewSessions } from '../../../src/lib/cloister/review-agent.js';

const { mockKillSessionAsync } = vi.hoisted(() => ({
  mockKillSessionAsync: vi.fn().mockResolvedValue(undefined),
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

// ── killAllReviewSessions ─────────────────────────────────────────────────────
// PAN-931: pan down must kill review sessions so they don't survive dashboard
// restart and block new review dispatch. The legacy coordinator naming pattern
// (review-coordinator-*) and reviewer naming patterns (canonical PAN-830 +
// legacy timestamp form) all need to be reaped.

describe('killAllReviewSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

describe('passed-state rerun regression', () => {
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
// The four code-review-* sub-agent definitions are read-only (no Write tool
// in their frontmatter) and must NOT instruct the agent to write to any output
// file. They surface findings as their agent response, which the review role
// synthesizes programmatically. PAN-1048 R5 C1 superseded the older PAN-540
// "write to **Output file**" contract.

import { readFileSync } from 'fs';
import { resolve } from 'path';

function readTemplate(name: string): string {
  const templatePath = resolve(
    import.meta.dirname,
    '../../../.claude/agents',
    `${name}.md`,
  );
  return readFileSync(templatePath, 'utf-8');
}

describe('template/output contract', () => {
  const reviewerTemplates = [
    { name: 'code-review-correctness', role: 'correctness' },
    { name: 'code-review-security', role: 'security' },
    { name: 'code-review-performance', role: 'performance' },
    { name: 'code-review-requirements', role: 'requirements' },
  ];

  describe('reviewer templates return findings as agent response (PAN-1048 R5 C1)', () => {
    for (const { name, role } of reviewerTemplates) {
      it(`${role}: does NOT hardcode .claude/reviews/ path`, () => {
        const content = readTemplate(name);
        expect(content).not.toContain('.claude/reviews/');
      });

      it(`${role}: does NOT instruct the agent to write to a file`, () => {
        const content = readTemplate(name);
        expect(content).not.toMatch(/\*\*Output file\*\*/);
      });

      it(`${role}: instructs the agent to return findings as its response`, () => {
        const content = readTemplate(name);
        // The new tail "Returning your review" tells the reviewer to surface
        // findings in the agent response, not to a file.
        expect(content).toMatch(/Returning your review/i);
      });
    }
  });
});

// ── dispatch failure sets 'pending' not 'failed' ─────────────────────────────
// Regression: dispatch failures must set reviewStatus='pending' so the deacon
// can retry. The deacon at deacon.ts only re-dispatches when reviewStatus===
// 'pending'; setting 'failed' leaves reviews permanently stuck after a transient
// dispatch error (e.g., tmux not ready, file-system issue).

describe('dispatch failure reviewStatus regression', () => {
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
