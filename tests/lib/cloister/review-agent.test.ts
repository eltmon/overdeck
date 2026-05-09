/**
 * Tests for parallel review-agent pure functions (PAN-540).
 *
 * Covers the functions extracted from convoy and inlined into review-agent.ts:
 *   - parseReviewerTemplate: YAML frontmatter parsing (async)
 *   - resolveReviewerModel: work-type routing with agent/template overrides
 *   - parseReviewSynthesis: REVIEW_RESULT marker extraction from synthesis output (async)
 *   - getReviewAgents: falls back to DEFAULT_REVIEW_AGENTS when config missing
 *   - reviewResultToReviewStatus: maps review outcome to reviewStatus (CHANGES_REQUESTED → 'blocked')
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  parseReviewerTemplate,
  resolveReviewerModel,
  parseReviewSynthesis,
  getReviewAgents,
  reviewResultToReviewStatus,
  dispatchParallelReview,
  getActiveParallelReviewIssues,
  buildReviewFeedbackBody,
  waitForReviewer,
  getFilesChangedFromPR,
  selectCompletedReviewers,
  resolveTemplatePath,
  runParallelReview,
  killAllReviewSessions,
  type ReviewResult,
} from '../../../src/lib/cloister/review-agent.js';

// ── dispatchParallelReview ────────────────────────────────────────────────────
// vi.mock is hoisted, so mock fns must be defined with vi.hoisted() before they
// are referenced in the factory.

const execMock = vi.hoisted(() => vi.fn());

const { mockSetReviewStatus, mockGetReviewStatus, mockLoadCloisterConfig } = vi.hoisted(() => ({
  mockSetReviewStatus: vi.fn(),
  mockGetReviewStatus: vi.fn().mockReturnValue(null),
  // Throws by default so getReviewAgents() falls back to DEFAULT_REVIEW_AGENTS (same as real missing config)
  mockLoadCloisterConfig: vi.fn().mockImplementation(() => { throw new Error('no config'); }),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: execMock };
});

vi.mock('../../../src/lib/review-status.js', () => ({
  setReviewStatus: mockSetReviewStatus,
  getReviewStatus: mockGetReviewStatus,
}));

vi.mock('../../../src/lib/cloister/config.js', () => ({
  loadCloisterConfig: mockLoadCloisterConfig,
}));

const { mockKillSessionAsync, mockResolveProjectFromIssue, mockListStashes, mockCreateNamedStash, mockDropStash, mockIsPaneDeadAsync, mockListPaneValuesAsync } = vi.hoisted(() => ({
  mockKillSessionAsync: vi.fn().mockResolvedValue(undefined),
  mockResolveProjectFromIssue: vi.fn().mockReturnValue({
    projectKey: 'panopticon-cli',
    projectName: 'Panopticon CLI',
    projectPath: '/tmp/panopticon-cli',
    linearTeam: 'PAN',
  }),
  mockListStashes: vi.fn().mockResolvedValue([]),
  mockCreateNamedStash: vi.fn().mockResolvedValue(null),
  mockDropStash: vi.fn().mockResolvedValue(undefined),
  mockIsPaneDeadAsync: vi.fn().mockResolvedValue(false),
  mockListPaneValuesAsync: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/lib/projects.js', () => ({
  resolveProjectFromIssue: mockResolveProjectFromIssue,
}));

vi.mock('../../../src/lib/tmux.js', async () => {
  const actual = await vi.importActual('../../../src/lib/tmux.js');
  return {
    ...actual as object,
    listSessionNamesAsync: vi.fn().mockResolvedValue([]),
    sessionExistsAsync: vi.fn().mockResolvedValue(false),
    killSessionAsync: mockKillSessionAsync,
    setOptionAsync: vi.fn().mockResolvedValue(undefined),
    isPaneDeadAsync: mockIsPaneDeadAsync,
    listPaneValuesAsync: mockListPaneValuesAsync,
  };
});

vi.mock('../../../src/lib/stashes.js', () => ({
  buildStashMessage: vi.fn((kind: string, issueId: string, arg: number | Date) => {
    if (typeof arg === 'number') return `${kind}:${issueId.toUpperCase()}:${arg}`;
    return `${kind}:${issueId.toUpperCase()}:2026-04-27T14:15:16Z`;
  }),
  createNamedStash: mockCreateNamedStash,
  dropStash: mockDropStash,
  getNextReviewTempSequence: vi.fn(() => 1),
  listStashes: mockListStashes,
}));

describe('dispatchParallelReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execMock.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
      const callback = (typeof _opts === 'function' ? _opts : cb)!;
      if (cmd === 'git status --porcelain') return callback(null, { stdout: '', stderr: '' });
      callback(new Error(`unexpected command: ${cmd}`));
    });
    mockListStashes.mockResolvedValue([]);
    mockCreateNamedStash.mockResolvedValue(null);
    mockDropStash.mockResolvedValue(undefined);
  });

  const baseOpts = {
    issueId: 'PAN-999',
    workspace: '/workspaces/feature-pan-999',
    branch: 'feature/pan-999',
    prUrl: 'https://github.com/org/repo/pull/1',
  };

  // Post-refactor behavior (see docs/REVIEW-AGENT-ARCHITECTURE.md):
  // dispatchParallelReview spawns a detached tmux coordinator session running
  // `pan review run <id>`. The coordinator session writes the terminal
  // reviewStatus when the CLI exits — NOT this function. Under test we
  // inject coordinatorSpawnFn to avoid touching real tmux.

  it('writes reviewing status upfront and invokes the coordinator spawn', async () => {
    const coordinatorSpawnFn = vi.fn().mockResolvedValue({ sessionName: 'review-coordinator-PAN-999-123' });

    const ret = await dispatchParallelReview(baseOpts, { coordinatorSpawnFn });

    expect(ret.success).toBe(true);
    expect(ret.message).toContain('Review coordinator spawned');
    expect(coordinatorSpawnFn).toHaveBeenCalledOnce();
    expect(coordinatorSpawnFn).toHaveBeenCalledWith({
      issueId: 'PAN-999',
      workspace: '/workspaces/feature-pan-999',
    });

    // Exactly one setReviewStatus call: the upfront 'reviewing' write.
    // Terminal status (passed/blocked/failed) is NOT written here — it lives
    // in the coordinator session's CLI exit path.
    expect(mockSetReviewStatus).toHaveBeenCalledOnce();
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-999', {
      reviewStatus: 'reviewing',
      reviewSpawnedAt: expect.any(String),
    });
  });

  it('records terminal failed status when coordinator spawn throws', async () => {
    // Coordinator spawn failure is a hard failure — no detached session was
    // created, so no CLI will ever write the terminal status. dispatchParallelReview
    // records 'failed' itself in this case to avoid the status stuck at 'reviewing'.
    const coordinatorSpawnFn = vi.fn().mockRejectedValue(new Error('tmux unavailable'));

    const ret = await dispatchParallelReview(baseOpts, { coordinatorSpawnFn });

    expect(ret.success).toBe(false);
    expect(ret.error).toBe('tmux unavailable');

    const calls = mockSetReviewStatus.mock.calls;
    // First call: upfront 'reviewing'. Second call: terminal 'failed' after spawn error.
    expect(calls.length).toBe(2);
    expect(calls[0][1].reviewStatus).toBe('reviewing');
    expect(calls[1][1].reviewStatus).toBe('failed');
    expect(calls[1][1].reviewNotes).toContain('tmux unavailable');
  });

  it('returns the coordinator session name in its message for observability', async () => {
    const coordinatorSpawnFn = vi.fn().mockResolvedValue({
      sessionName: 'review-coordinator-PAN-999-1713456789000',
    });

    const ret = await dispatchParallelReview(baseOpts, { coordinatorSpawnFn });

    expect(ret.message).toContain('review-coordinator-PAN-999-1713456789000');
  });

  it('does NOT write a terminal reviewStatus on happy path — coordinator owns it', async () => {
    // This is the core invariant: dispatchParallelReview transitions to
    // 'reviewing' and returns. It does NOT know or care about the eventual
    // passed/blocked/failed outcome — that's the coordinator session's job.
    // Dashboard-restart invariance depends on this: server can die after
    // spawning the coordinator and the CLI will still write the terminal
    // state into SQLite when it exits.
    const coordinatorSpawnFn = vi.fn().mockResolvedValue({ sessionName: 'review-coordinator-PAN-999-123' });

    await dispatchParallelReview(baseOpts, { coordinatorSpawnFn });
    await new Promise(resolve => setTimeout(resolve, 0));

    const terminalCalls = mockSetReviewStatus.mock.calls.filter(
      c => c[1].reviewStatus === 'passed' || c[1].reviewStatus === 'blocked' || c[1].reviewStatus === 'failed',
    );
    expect(terminalCalls.length).toBe(0);
  });
});

// ── killAllReviewSessions ─────────────────────────────────────────────────────
// PAN-931: pan down must kill review sessions so they don't survive dashboard
// restart and block new review dispatch.

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

// ── dispatchParallelReview idempotency guard (PAN-931) ────────────────────────

describe('dispatchParallelReview idempotency guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execMock.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
      const callback = (typeof _opts === 'function' ? _opts : cb)!;
      if (cmd === 'git status --porcelain') return callback(null, { stdout: '', stderr: '' });
      callback(new Error(`unexpected command: ${cmd}`));
    });
    mockListStashes.mockResolvedValue([]);
    mockCreateNamedStash.mockResolvedValue(null);
    mockDropStash.mockResolvedValue(undefined);
  });

  const baseOpts = {
    issueId: 'PAN-999',
    workspace: '/workspaces/feature-pan-999',
    branch: 'feature/pan-999',
    prUrl: 'https://github.com/org/repo/pull/1',
  };

  it('kills stale coordinator and proceeds when pane is dead (PAN-912)', async () => {
    const { listSessionNamesAsync } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNamesAsync).mockResolvedValue([
      'review-coordinator-PAN-999-1234567890000',
    ]);
    mockIsPaneDeadAsync.mockResolvedValue(true);
    const coordinatorSpawnFn = vi.fn().mockResolvedValue({ sessionName: 'review-coordinator-PAN-999-new' });

    const ret = await dispatchParallelReview(baseOpts, { coordinatorSpawnFn });

    expect(mockKillSessionAsync).toHaveBeenCalledWith('review-coordinator-PAN-999-1234567890000');
    expect(coordinatorSpawnFn).toHaveBeenCalledOnce();
    expect(ret.success).toBe(true);
  });

  it('kills zombie coordinator when pane_dead=0 but process PID is gone (PAN-931)', async () => {
    const { listSessionNamesAsync } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNamesAsync).mockResolvedValue([
      'review-coordinator-PAN-999-1234567890000',
    ]);
    mockIsPaneDeadAsync.mockResolvedValue(false);
    // Simulate a pane PID that no longer exists in the process table
    mockListPaneValuesAsync.mockResolvedValue(['999999']);
    const coordinatorSpawnFn = vi.fn().mockResolvedValue({ sessionName: 'review-coordinator-PAN-999-new' });

    const ret = await dispatchParallelReview(baseOpts, { coordinatorSpawnFn });

    expect(mockKillSessionAsync).toHaveBeenCalledWith('review-coordinator-PAN-999-1234567890000');
    expect(coordinatorSpawnFn).toHaveBeenCalledOnce();
    expect(ret.success).toBe(true);
  });

  it('skips dispatch when coordinator pane and process are both alive', async () => {
    const { listSessionNamesAsync } = await import('../../../src/lib/tmux.js');
    vi.mocked(listSessionNamesAsync).mockResolvedValue([
      'review-coordinator-PAN-999-1234567890000',
    ]);
    mockIsPaneDeadAsync.mockResolvedValue(false);
    // Simulate a real live PID
    mockListPaneValuesAsync.mockResolvedValue(['1']);
    // process.kill(1, 0) may throw EPERM in restricted test environments;
    // mock it to succeed so the alive-path is deterministic.
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(undefined as never);
    const coordinatorSpawnFn = vi.fn().mockResolvedValue({ sessionName: 'review-coordinator-PAN-999-new' });

    try {
      const ret = await dispatchParallelReview(baseOpts, { coordinatorSpawnFn });

      expect(mockKillSessionAsync).not.toHaveBeenCalled();
      expect(coordinatorSpawnFn).not.toHaveBeenCalled();
      expect(ret.success).toBe(true);
      expect(ret.message).toContain('Review already in progress');
    } finally {
      killSpy.mockRestore();
    }
  });
});

// ── getActiveParallelReviewIssues ─────────────────────────────────────────────
// Regression coverage for orphan-detection fix: deacon/service must not
// reset reviewing→pending while ad-hoc parallel review sessions are running.

describe('getActiveParallelReviewIssues', () => {
  it('extracts issue IDs from running parallel review session names', () => {
    const sessions = [
      'review-PAN-999-1713456789000-correctness',
      'review-PAN-999-1713456789000-security',
      'review-MIN-42-1713456789001-performance',
      'agent-pan-999',
      'panopticon-review-agent',
    ];
    const result = getActiveParallelReviewIssues(sessions);
    expect(result.has('PAN-999')).toBe(true);
    expect(result.has('MIN-42')).toBe(true);
    expect(result.size).toBe(2);
  });

  it('returns empty set when no parallel review sessions exist', () => {
    const result = getActiveParallelReviewIssues(['agent-pan-999', 'panopticon-review-agent']);
    expect(result.size).toBe(0);
  });

  it('prevents false orphan detection: reviewing issue with active session is not orphaned', () => {
    // Deacon marks an issue orphaned only if its id is NOT in activeReviewSessions.
    // This test verifies getActiveParallelReviewIssues correctly identifies the active issue
    // so that the orphan check sees it as active (not orphaned).
    const activeSessions = ['review-PAN-540-1713456789000-correctness'];
    const active = getActiveParallelReviewIssues(activeSessions);
    // PAN-540 should appear as active — deacon would see it and skip the orphan reset
    expect(active.has('PAN-540')).toBe(true);
  });
});

// ── buildReviewFeedbackBody ───────────────────────────────────────────────────
// Regression coverage: verifies the resubmit command emitted to work agents
// points at the real resubmit flow, not a non-existent route.

describe('buildReviewFeedbackBody', () => {
  const changesRequested: ReviewResult = {
    success: true,
    reviewResult: 'CHANGES_REQUESTED',
    notes: 'Fix the linting issues.',
  };

  it('CHANGES_REQUESTED body instructs agent to use pan done (not a curl URL)', () => {
    const body = buildReviewFeedbackBody('PAN-999', changesRequested);
    expect(body).toMatch(/pan done|rebase-and-submit/);
  });

  it('CHANGES_REQUESTED body does NOT reference the non-existent /api/workspaces request-review route', () => {
    const body = buildReviewFeedbackBody('PAN-999', changesRequested);
    expect(body).not.toContain('/api/workspaces/');
    expect(body).not.toContain('request-review');
  });

  it('CHANGES_REQUESTED body includes the issue ID', () => {
    const body = buildReviewFeedbackBody('PAN-999', changesRequested);
    expect(body).toContain('PAN-999');
  });

  it('APPROVED body includes completion notice and warns against resubmit', () => {
    const approved: ReviewResult = { success: true, reviewResult: 'APPROVED', notes: 'LGTM' };
    const body = buildReviewFeedbackBody('PAN-999', approved);
    expect(body).toContain('APPROVED');
    expect(body).toContain('CODE APPROVED');
    expect(body).toContain('Do NOT run `pan done` again');
    expect(body).toContain('Do NOT run `pan review request`');
  });

  it('uses full synthesis output when available, stripping tail markers', () => {
    const withOutput: ReviewResult = {
      success: true,
      reviewResult: 'CHANGES_REQUESTED',
      notes: 'Short summary.',
      output: '# Verdict: CHANGES_REQUESTED\n\n## Blockers\n\n### 1. Missing CSRF guard\nFix: add validateOrigin()\n\nREVIEW_RESULT: CHANGES_REQUESTED\nNOTES: Short summary.\nFILES_REVIEWED: foo.ts,bar.ts\nSECURITY_ISSUES: Missing CSRF guard',
    };
    const body = buildReviewFeedbackBody('PAN-999', withOutput);
    // Full synthesis body is present
    expect(body).toContain('## Blockers');
    expect(body).toContain('Missing CSRF guard');
    expect(body).toContain('add validateOrigin()');
    // Tail markers are stripped
    expect(body).not.toContain('REVIEW_RESULT:');
    expect(body).not.toContain('FILES_REVIEWED:');
    // Action block is appended
    expect(body).toMatch(/rebase-and-submit/);
  });

  it('falls back to tail-marker reconstruction when output is absent', () => {
    const body = buildReviewFeedbackBody('PAN-999', changesRequested);
    expect(body).toContain('# Review: CHANGES_REQUESTED');
    expect(body).toContain('Fix the linting issues.');
  });
});

// ── waitForReviewer ───────────────────────────────────────────────────────────

describe('waitForReviewer', () => {
  it('returns completed when output file appears while session still running', async () => {
    // This is the normal case: Claude writes the file but does not exit.
    // Session is kept alive so the dashboard can show reviewer tabs after completion.
    const sessionExists = vi.fn().mockResolvedValue(true); // session still running
    const fileExists = vi.fn().mockReturnValue(true);       // output file written
    const killSession = vi.fn().mockResolvedValue(undefined);

    const result = await waitForReviewer('review-PAN-999-ts-correctness', '/tmp/out.md', 5000, {
      sessionExists, fileExists, killSession,
    });

    expect(result).toEqual({ status: 'completed' });
    expect(fileExists).toHaveBeenCalledWith('/tmp/out.md');
    expect(killSession).not.toHaveBeenCalled();
  });

  it('returns completed when session exits with output file present', async () => {
    const sessionExists = vi.fn().mockResolvedValue(false); // session already gone
    const fileExists = vi.fn().mockReturnValue(true);       // output file written
    const killSession = vi.fn().mockResolvedValue(undefined);

    const result = await waitForReviewer('review-PAN-999-ts-correctness', '/tmp/out.md', 5000, {
      sessionExists, fileExists, killSession,
    });

    expect(result).toEqual({ status: 'completed' });
    expect(fileExists).toHaveBeenCalledWith('/tmp/out.md');
    // Session is kept alive post-completion for dashboard visibility; no killSession call
    expect(killSession).not.toHaveBeenCalled();
  });

  it('returns failed (session_exited) when session exits without output file', async () => {
    const sessionExists = vi.fn().mockResolvedValue(false);
    const fileExists = vi.fn().mockReturnValue(false);
    const killSession = vi.fn().mockResolvedValue(undefined);

    const result = await waitForReviewer('review-PAN-999-ts-correctness', '/tmp/out.md', 5000, {
      sessionExists, fileExists, killSession,
    });

    expect(result).toEqual({ status: 'failed', reason: 'session_exited' });
    expect(killSession).not.toHaveBeenCalled();
  });

  it('kills session and returns failed (timeout) on timeout', async () => {
    const sessionExists = vi.fn().mockResolvedValue(true); // session always running
    const fileExists = vi.fn().mockReturnValue(false);
    const killSession = vi.fn().mockResolvedValue(undefined);

    // timeoutMs = 0 → deadline already passed → loop never enters → timeout path
    const result = await waitForReviewer('review-PAN-999-ts-correctness', '/tmp/out.md', 0, {
      sessionExists, fileExists, killSession,
    });

    expect(result).toEqual({ status: 'failed', reason: 'timeout' });
    expect(sessionExists).not.toHaveBeenCalled(); // never entered loop
    expect(killSession).toHaveBeenCalledWith('review-PAN-999-ts-correctness');
  });

  it('returns failed (pane_dead) immediately when pane is dead', async () => {
    mockIsPaneDeadAsync.mockResolvedValueOnce(true);
    const sessionExists = vi.fn().mockResolvedValue(true); // session still alive due to remain-on-exit
    const fileExists = vi.fn().mockReturnValue(false);
    const killSession = vi.fn().mockResolvedValue(undefined);
    const capturePane = vi.fn().mockResolvedValue('dead pane output');

    const result = await waitForReviewer('review-PAN-999-ts-correctness', '/tmp/out.md', 5000, {
      sessionExists, fileExists, killSession, capturePane,
    });

    expect(result).toEqual({ status: 'failed', reason: 'pane_dead' });
    expect(sessionExists).toHaveBeenCalled();
    expect(capturePane).toHaveBeenCalledWith('review-PAN-999-ts-correctness');
    expect(killSession).not.toHaveBeenCalled();
  });

  it('fails fast with terminal_api_error + structured TerminalApiError when reviewer hits a 403 quota error', async () => {
    // Repro of the PAN-1015 silent-30-min-timeout: Kimi quota exhausted, the
    // pane stays alive at the prompt because Claude Code doesn't exit on API
    // errors — it just prints the message and waits for input. Without
    // detection this would hit the 30-minute timeout.
    const sessionExists = vi.fn().mockResolvedValue(true);
    const fileExists = vi.fn().mockReturnValue(false);
    const killSession = vi.fn().mockResolvedValue(undefined);
    const capturePane = vi.fn().mockResolvedValue([
      '  Please run /login · API Error: 403',
      '  {"error":{"type":"permission_error","message":"You\'ve reached your usage',
      '  limit for this billing cycle. Your quota will be refreshed in the next',
      '  cycle. Upgrade to get more: https://www.kimi.com/code/console"}}',
      '❯ ',
    ].join('\n'));

    const result = await waitForReviewer('review-PAN-999-ts-correctness', '/tmp/out.md', 5000, {
      sessionExists, fileExists, killSession, capturePane,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('terminal_api_error');
      expect(result.apiError).toBeDefined();
      expect(result.apiError!.kind).toBe('quota_exhausted');
      expect(result.apiError!.summary).toMatch(/quota|usage limit/i);
    }
    expect(killSession).toHaveBeenCalledWith('review-PAN-999-ts-correctness');
  });

  it('detects login_required terminal error from "Please run /login" pattern when no quota line is present', async () => {
    const sessionExists = vi.fn().mockResolvedValue(true);
    const fileExists = vi.fn().mockReturnValue(false);
    const killSession = vi.fn().mockResolvedValue(undefined);
    const capturePane = vi.fn().mockResolvedValue('  Please run /login\n❯ ');

    const result = await waitForReviewer('review-PAN-999-ts-correctness', '/tmp/out.md', 5000, {
      sessionExists, fileExists, killSession, capturePane,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('terminal_api_error');
      expect(result.apiError!.kind).toBe('login_required');
    }
  });
});

// ── getFilesChangedFromPR ─────────────────────────────────────────────────────

describe('getFilesChangedFromPR', () => {
  it('parses gh CLI output into file list', async () => {
    const execFn = vi.fn().mockResolvedValue({
      stdout: 'src/foo.ts\nsrc/bar.ts\n',
      stderr: '',
    });

    const files = await getFilesChangedFromPR('https://github.com/org/repo/pull/1', '/proj', { execFn });

    expect(files).toEqual(['src/foo.ts', 'src/bar.ts']);
    expect(execFn).toHaveBeenCalledWith(
      expect.stringContaining('gh pr view'),
      expect.objectContaining({ cwd: '/proj' }),
    );
  });

  it('returns empty array when gh CLI fails', async () => {
    const execFn = vi.fn().mockRejectedValue(new Error('gh: command not found'));

    const files = await getFilesChangedFromPR('https://github.com/org/repo/pull/1', '/proj', { execFn });

    expect(files).toEqual([]);
  });

  it('filters blank lines from gh output', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: '\nsrc/a.ts\n\nsrc/b.ts\n\n', stderr: '' });

    const files = await getFilesChangedFromPR('https://github.com/org/repo/pull/1', '/proj', { execFn });

    expect(files).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `review-agent-test-${Date.now()}-${Math.random().toString(36).slice(7)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── reviewResultToReviewStatus ────────────────────────────────────────────────
// This is the status mapping used by dispatchParallelReview.
// CHANGES_REQUESTED must map to 'blocked' (not 'pending') — with 'pending' the
// deacon patrol immediately re-dispatches the review in an infinite loop before
// the work agent has a chance to address the feedback.

describe('reviewResultToReviewStatus', () => {
  it('maps CHANGES_REQUESTED to blocked', () => {
    expect(reviewResultToReviewStatus({ reviewResult: 'CHANGES_REQUESTED', success: true })).toBe('blocked');
  });

  it('maps APPROVED to passed', () => {
    expect(reviewResultToReviewStatus({ reviewResult: 'APPROVED', success: true })).toBe('passed');
  });

  // PAN-869: COMMENTED with success=true means review completed with no blockers → 'passed'
  it('maps COMMENTED (success=true) to passed', () => {
    expect(reviewResultToReviewStatus({ reviewResult: 'COMMENTED', success: true })).toBe('passed');
  });

  // COMMENTED with success=false means synthesis/protocol failure — must not re-queue
  it('maps COMMENTED (success=false) to failed', () => {
    expect(reviewResultToReviewStatus({ reviewResult: 'COMMENTED', success: false })).toBe('failed');
  });
});

// ── parseReviewerTemplate ─────────────────────────────────────────────────────

describe('parseReviewerTemplate', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('parses model from YAML frontmatter and returns body content', async () => {
    const templatePath = join(tmpDir, 'code-review-correctness.md');
    writeFileSync(templatePath, [
      '---',
      'model: claude-opus-4-6',
      '---',
      'Review the code for correctness.',
    ].join('\n'));

    const result = await parseReviewerTemplate(templatePath);
    expect(result.model).toBe('claude-opus-4-6');
    expect(result.content).toBe('Review the code for correctness.');
  });

  it('falls back to "sonnet" when frontmatter has no model field', async () => {
    const templatePath = join(tmpDir, 'code-review-security.md');
    writeFileSync(templatePath, [
      '---',
      'focus: OWASP',
      '---',
      'Check for security issues.',
    ].join('\n'));

    const result = await parseReviewerTemplate(templatePath);
    expect(result.model).toBe('sonnet');
  });

  it('rejects when template file does not exist', async () => {
    await expect(
      parseReviewerTemplate(join(tmpDir, 'nonexistent.md'))
    ).rejects.toThrow('Reviewer template not found');
  });

  it('rejects when template has no YAML frontmatter', async () => {
    const templatePath = join(tmpDir, 'bad-template.md');
    writeFileSync(templatePath, 'Just content, no frontmatter.');

    await expect(parseReviewerTemplate(templatePath)).rejects.toThrow('Invalid template format');
  });
});

// ── resolveReviewerModel ──────────────────────────────────────────────────────

describe('resolveReviewerModel', () => {
  it('returns agent.model when set (highest precedence)', () => {
    const model = resolveReviewerModel(
      { name: 'correctness', focus: [], model: 'claude-opus-4-6' },
      'claude-sonnet-4-5',
    );
    expect(model).toBe('claude-opus-4-6');
  });

  it('falls back to specialist-review-agent for unknown roles when no role-specific override', () => {
    // New behavior (post-gpt-5.5 fix): unknown roles with no override use the
    // specialist-review-agent work type, not the defaultModel. This prevents
    // smart selection from picking unsupported models (e.g. gpt-5.5 without
    // CLIProxy mapping). See resolveReviewerModel for rationale.
    const model = resolveReviewerModel(
      { name: 'unknown-role', focus: [] },
      'claude-haiku-4-5',
    );
    // The returned model comes from the work-type router, not the defaultModel.
    // Exact ID depends on user config but it MUST be a non-empty string.
    expect(typeof model).toBe('string');
    expect(model.length).toBeGreaterThan(0);
  });

  it('returns a non-empty string for known roles (routing or fallback)', () => {
    const model = resolveReviewerModel(
      { name: 'synthesis', focus: [] },
      'claude-sonnet-4-5',
    );
    expect(typeof model).toBe('string');
    expect(model.length).toBeGreaterThan(0);
  });

  // Regression for alias → concrete model ID resolution:
  // Template frontmatter uses "haiku"/"sonnet"/"opus" as shorthand. Aliases must
  // be resolved through the work-type router (getModelId) — NOT hard-coded to
  // Anthropic model IDs — so the returned ID is provider-correct when using
  // OpenAI, Gemini, or other routed providers.
  it('resolves "haiku" alias via work-type router (not passed through verbatim)', () => {
    const model = resolveReviewerModel({ name: 'unknown-role', focus: [] }, 'haiku');
    expect(model).not.toBe('haiku');
    expect(model.length).toBeGreaterThan(0);
    // haiku must route through a reviewer work type, not subagent:bash.
    // subagent:bash defaults to gpt-5.4-nano; review:correctness defaults to claude-sonnet-4-6.
    // Both change under user config but they must be different categories.
    expect(model).not.toBe('gpt-5.4-nano');
  });

  it('resolves "sonnet" alias via work-type router (not passed through verbatim)', () => {
    const model = resolveReviewerModel({ name: 'unknown-role', focus: [] }, 'sonnet');
    expect(model).not.toBe('sonnet');
    expect(model.length).toBeGreaterThan(0);
  });

  it('resolves "opus" alias via work-type router (not passed through verbatim)', () => {
    const model = resolveReviewerModel({ name: 'unknown-role', focus: [] }, 'opus');
    expect(model).not.toBe('opus');
    expect(model.length).toBeGreaterThan(0);
  });

  it('passes through agent.model concrete IDs unchanged (highest precedence)', () => {
    // The only way to force a specific concrete model is via agent.model.
    // defaultModel is last-resort fallback used only when work-type routing fails.
    const model = resolveReviewerModel(
      { name: 'unknown-role', focus: [], model: 'claude-haiku-4-5' },
      'claude-sonnet-4-5',
    );
    expect(model).toBe('claude-haiku-4-5');
  });

  // All reviewer aliases (opus/sonnet/haiku) resolve to specialist-review-agent
  // so they consistently respect the user's configured reviewer model override.
  it('all reviewer aliases resolve to the same configured reviewer model', () => {
    const opus = resolveReviewerModel({ name: 'correctness', model: 'opus', focus: [] }, 'any-default');
    const sonnet = resolveReviewerModel({ name: 'correctness', model: 'sonnet', focus: [] }, 'any-default');
    const haiku = resolveReviewerModel({ name: 'correctness', model: 'haiku', focus: [] }, 'any-default');
    expect(opus).not.toBe('opus');
    expect(sonnet).not.toBe('sonnet');
    expect(haiku).not.toBe('haiku');
    expect(opus).toBe(sonnet);
    expect(sonnet).toBe(haiku);
  });

  it('opus alias is resolved (not passed through verbatim) for a real reviewer role', () => {
    const model = resolveReviewerModel({ name: 'correctness', model: 'opus', focus: [] }, 'any-default');
    expect(model).not.toBe('opus');
    expect(model.length).toBeGreaterThan(0);
  });
});

// ── parseReviewSynthesis ──────────────────────────────────────────────────────

describe('parseReviewSynthesis', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('extracts APPROVED result from synthesis.md', async () => {
    writeFileSync(join(tmpDir, 'synthesis.md'), [
      '## Review Summary',
      '',
      'All checks passed.',
      '',
      'REVIEW_RESULT: APPROVED',
      'NOTES: Looks good',
    ].join('\n'));

    const result = await parseReviewSynthesis(tmpDir);
    expect(result.success).toBe(true);
    expect(result.reviewResult).toBe('APPROVED');
    expect(result.notes).toBe('Looks good');
  });

  it('extracts CHANGES_REQUESTED result from synthesis.md', async () => {
    writeFileSync(join(tmpDir, 'synthesis.md'), [
      'Found critical issues.',
      '',
      'REVIEW_RESULT: CHANGES_REQUESTED',
      'SECURITY_ISSUES: SQL injection in query builder',
      'NOTES: Fix the SQL injection',
    ].join('\n'));

    const result = await parseReviewSynthesis(tmpDir);
    expect(result.success).toBe(true);
    expect(result.reviewResult).toBe('CHANGES_REQUESTED');
    expect(result.securityIssues).toContain('SQL injection in query builder');
  });

  it('returns COMMENTED/failure when synthesis.md is missing', async () => {
    const result = await parseReviewSynthesis(tmpDir);
    expect(result.success).toBe(false);
    expect(result.reviewResult).toBe('COMMENTED');
    expect(result.notes).toMatch(/synthesis/i);
  });

  it('returns COMMENTED/failure when synthesis.md has no result markers', async () => {
    writeFileSync(join(tmpDir, 'synthesis.md'), 'Agent ran but produced no structured output.');

    const result = await parseReviewSynthesis(tmpDir);
    expect(result.success).toBe(false);
    expect(result.reviewResult).toBe('COMMENTED');
  });

  it('collects file references from reviewer output files alongside synthesis', async () => {
    writeFileSync(join(tmpDir, 'synthesis.md'), 'REVIEW_RESULT: APPROVED\nNOTES: ok');
    writeFileSync(join(tmpDir, 'correctness.md'), 'Reviewed src/lib/foo.ts and src/lib/bar.ts');
    writeFileSync(join(tmpDir, 'security.md'), 'Checked src/lib/auth.ts');

    const result = await parseReviewSynthesis(tmpDir);
    expect(result.filesReviewed).toBeDefined();
    expect(result.filesReviewed!.some(f => f.includes('foo.ts'))).toBe(true);
    expect(result.filesReviewed!.some(f => f.includes('auth.ts'))).toBe(true);
  });
});

// ── selectCompletedReviewers ──────────────────────────────────────────────────
// Regression: any reviewer failure must abort synthesis (not produce partial results).
// selectCompletedReviewers is the hard gate between phase 2 and phase 3.

describe('selectCompletedReviewers', () => {
  it('returns null when any reviewer failed — synthesis must not run', () => {
    const results = [
      { role: 'correctness', status: 'completed' as const, outputFile: '/a/correctness.md' },
      { role: 'security', status: 'failed' as const, outputFile: '/a/security.md' },
      { role: 'performance', status: 'completed' as const, outputFile: '/a/performance.md' },
    ];
    expect(selectCompletedReviewers(results)).toBeNull();
  });

  it('returns null when all reviewers failed', () => {
    const results = [
      { role: 'correctness', status: 'failed' as const, outputFile: '/a/correctness.md' },
      { role: 'security', status: 'failed' as const, outputFile: '/a/security.md' },
    ];
    expect(selectCompletedReviewers(results)).toBeNull();
  });

  it('returns completed outputs when all reviewers succeeded', () => {
    const results = [
      { role: 'correctness', status: 'completed' as const, outputFile: '/a/correctness.md' },
      { role: 'security', status: 'completed' as const, outputFile: '/a/security.md' },
    ];
    const selected = selectCompletedReviewers(results);
    expect(selected).not.toBeNull();
    expect(selected!.map(r => r.role)).toEqual(['correctness', 'security']);
    expect(selected!.map(r => r.outputFile)).toEqual(['/a/correctness.md', '/a/security.md']);
  });

  it('returned list omits the status field (synthesis only needs role + outputFile)', () => {
    const results = [
      { role: 'correctness', status: 'completed' as const, outputFile: '/a/correctness.md' },
    ];
    const selected = selectCompletedReviewers(results)!;
    expect(Object.keys(selected[0])).not.toContain('status');
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

    // Find the request-review route (between the route definition and the reset route)
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

// ── passed-state rerun uses dispatchParallelReview ───────────────────────────
// Regression: the passed-state rerun path in /api/review/:issueId/request must
// use dispatchParallelReview (not wakeSpecialistOrQueue) so review:* model routing
// and the parallel pipeline are applied consistently.

describe('passed-state rerun regression', () => {
  it('workspaces.ts request-review route does not call wakeSpecialistOrQueue in the rerun path', async () => {
    // Read the route source and verify it has no wakeSpecialistOrQueue calls in the
    // passed-state IIFE (the block between shouldTreatAsRerun and the early return).
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

    expect(rerunBlock).not.toContain('wakeSpecialistOrQueue');
    expect(rerunBlock).toContain('dispatchParallelReview');
  });
});

// ── template/output contract ──────────────────────────────────────────────────
// Regression coverage for PAN-540: reviewer templates must write to the **Output file**
// injected by runParallelReview, NOT to hardcoded .claude/reviews/ paths.
// The synthesis template must instruct the agent to emit REVIEW_RESULT markers
// so parseAgentOutput can parse a real review result instead of falling back to COMMENTED.

import { readFileSync } from 'fs';
import { resolve } from 'path';

function readTemplate(name: string): string {
  // Review prompt templates live at src/lib/cloister/prompts/review/<name>.prompt-template.md
  // (workspace root, three directories up from tests/lib/cloister/).
  const templatePath = resolve(
    import.meta.dirname,
    '../../../src/lib/cloister/prompts/review',
    `${name}.prompt-template.md`,
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

  describe('reviewer templates write to injected Output file', () => {
    for (const { name, role } of reviewerTemplates) {
      it(`${role}: does NOT hardcode .claude/reviews/ path`, () => {
        const content = readTemplate(name);
        expect(content).not.toContain('.claude/reviews/');
      });

      it(`${role}: instructs agent to write to the **Output file** from Review Context`, () => {
        const content = readTemplate(name);
        expect(content).toMatch(/\*\*Output file\*\*/);
      });
    }
  });

  describe('synthesis template reads from Reviewer Output Files context', () => {
    it('does NOT reference .claude/reviews/ glob for input', () => {
      const content = readTemplate('code-review-synthesis');
      expect(content).not.toContain('.claude/reviews/');
    });

    it('instructs agent to read from ## Reviewer Output Files context section', () => {
      const content = readTemplate('code-review-synthesis');
      expect(content).toContain('Reviewer Output Files');
    });

    it('instructs agent to write to the **Output file** from Synthesis Context', () => {
      const content = readTemplate('code-review-synthesis');
      expect(content).toMatch(/\*\*Output file\*\*/);
    });
  });

  describe('synthesis template output markers (enables parseAgentOutput to return real result)', () => {
    it('instructs agent to emit REVIEW_RESULT marker', () => {
      const content = readTemplate('code-review-synthesis');
      expect(content).toContain('REVIEW_RESULT:');
    });

    it('instructs agent to emit NOTES marker', () => {
      const content = readTemplate('code-review-synthesis');
      expect(content).toContain('NOTES:');
    });

    it('instructs agent to emit FILES_REVIEWED marker', () => {
      const content = readTemplate('code-review-synthesis');
      expect(content).toContain('FILES_REVIEWED:');
    });

    it('REVIEW_RESULT options cover all three outcomes parseAgentOutput expects', () => {
      const content = readTemplate('code-review-synthesis');
      expect(content).toContain('APPROVED');
      expect(content).toContain('CHANGES_REQUESTED');
      expect(content).toContain('COMMENTED');
    });
  });
});

// ── getReviewAgents ───────────────────────────────────────────────────────────

describe('getReviewAgents', () => {
  it('returns a non-empty array', () => {
    const agents = getReviewAgents();
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThan(0);
  });

  it('each agent has a name and focus array', () => {
    const agents = getReviewAgents();
    for (const agent of agents) {
      expect(typeof agent.name).toBe('string');
      expect(Array.isArray(agent.focus)).toBe(true);
    }
  });

  it('includes correctness, security, and performance reviewers by default', () => {
    const agents = getReviewAgents();
    const names = agents.map(a => a.name);
    expect(names).toContain('correctness');
    expect(names).toContain('security');
    expect(names).toContain('performance');
  });

  it('falls back to defaults when all configured review_agents are disabled', () => {
    mockLoadCloisterConfig.mockReturnValueOnce({
      specialists: {
        review_agents: [
          { name: 'correctness', enabled: false },
          { name: 'security', enabled: false },
          { name: 'performance', enabled: false },
        ],
      },
    });
    const agents = getReviewAgents();
    // All configured agents are disabled → must fall back to the 4 built-in defaults
    const names = agents.map(a => a.name);
    expect(names).toContain('correctness');
    expect(names).toContain('security');
    expect(names).toContain('performance');
    expect(names).toContain('requirements');
    expect(agents.length).toBe(4);
  });

  it('returns only enabled agents when some are disabled', () => {
    mockLoadCloisterConfig.mockReturnValueOnce({
      specialists: {
        review_agents: [
          { name: 'correctness', enabled: true, focus: ['logic'] },
          { name: 'security', enabled: false, focus: ['injection'] },
        ],
      },
    });
    const agents = getReviewAgents();
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe('correctness');
  });
});

// ── runParallelReview configuration regressions ───────────────────────────────

describe('runParallelReview configuration regressions', () => {
  it('empty agents guard: source validates agents.length === 0 before spawning', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(import.meta.dirname, '../../../src/lib/cloister/review-agent.ts'),
      'utf-8',
    );
    expect(src).toContain('agents.length === 0');
  });

  it('template existence guard: source checks existsSync(templatePath) before spawning', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(import.meta.dirname, '../../../src/lib/cloister/review-agent.ts'),
      'utf-8',
    );
    expect(src).toContain('existsSync(promptTemplatePath)');
  });
});

// ── resolvePromptTemplatePath (legacy alias: resolveTemplatePath) ────────────

describe('resolvePromptTemplatePath', () => {
  it('returns a path under either review-prompts (new) or agent-definitions (legacy fallback)', () => {
    // In test env, the new CACHE_REVIEW_PROMPTS_DIR typically does not exist
    // (no `pan sync` run), so resolvePromptTemplatePath falls back to the
    // legacy CACHE_AGENTS_DIR path. Either layout is accepted.
    const result = resolveTemplatePath('code-review-correctness', '/any/workspace');
    const isNew = result.includes('review-prompts') && result.endsWith('.prompt-template.md');
    const isLegacy = result.includes('agent-definitions') && result.endsWith('code-review-correctness.md');
    expect(isNew || isLegacy).toBe(true);
  });
});

// ── runParallelReview orchestration ──────────────────────────────────────────

describe('runParallelReview', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pan-review-'));
    // Create workspace agents/ dir with minimal templates; tests inject
    // resolvePromptTemplateFn so these local templates are used instead of the global cache.
    mkdirSync(join(tmpDir, 'agents'), { recursive: true });
    const frontmatter = '---\nmodel: sonnet\n---\nReview the code.\n';
    writeFileSync(join(tmpDir, 'agents', 'code-review-correctness.md'), frontmatter);
    writeFileSync(join(tmpDir, 'agents', 'code-review-synthesis.md'), frontmatter);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const baseContext = () => ({
    projectPath: tmpDir,
    prUrl: 'https://github.com/org/repo/pull/1',
    issueId: 'PAN-999',
    branch: 'feature/pan-999',
  });

  it('happy path: all reviewers succeed → synthesis runs → result returned', async () => {
    const spawnFn = vi.fn().mockResolvedValue(undefined);
    const waitFn = vi.fn().mockResolvedValue({ status: 'completed' });
    const waitSynthesisFn = vi.fn().mockResolvedValue({ status: 'completed' });
    const approvedResult: ReviewResult = { success: true, reviewResult: 'APPROVED', notes: 'LGTM' };
    const parseSynthesisFn = vi.fn().mockResolvedValue(approvedResult);
    const postReviewFn = vi.fn().mockResolvedValue(undefined);
    const resolvePromptTemplateFn = (name: string) => join(tmpDir, 'agents', `${name}.md`);

    const { result } = await runParallelReview(
      baseContext(),
      ['src/foo.ts'],
      [{ name: 'correctness', focus: ['logic'] }],
      { spawnFn, waitFn, waitSynthesisFn, parseSynthesisFn, postReviewFn, resolvePromptTemplateFn },
    );

    expect(spawnFn).toHaveBeenCalledTimes(2); // 1 reviewer + 1 synthesis
    expect(waitFn).toHaveBeenCalledOnce(); // reviewer only
    expect(waitSynthesisFn).toHaveBeenCalledOnce(); // synthesis (separate fn, requires REVIEW_RESULT marker)
    expect(parseSynthesisFn).toHaveBeenCalledOnce();
    expect(postReviewFn).toHaveBeenCalledOnce();
    expect(result.reviewResult).toBe('APPROVED');
  });

  it('failure path: reviewer failure aborts synthesis → COMMENTED returned', async () => {
    const spawnFn = vi.fn().mockResolvedValue(undefined);
    const waitFn = vi.fn().mockResolvedValue({ status: 'failed', reason: 'timeout' }); // all reviewers fail
    const parseSynthesisFn = vi.fn();
    const postReviewFn = vi.fn();
    const resolvePromptTemplateFn = (name: string) => join(tmpDir, 'agents', `${name}.md`);

    const { result } = await runParallelReview(
      baseContext(),
      [],
      [{ name: 'correctness' }],
      { spawnFn, waitFn, parseSynthesisFn, postReviewFn, resolvePromptTemplateFn },
    );

    expect(parseSynthesisFn).not.toHaveBeenCalled();
    expect(postReviewFn).not.toHaveBeenCalled();
    expect(result.reviewResult).toBe('COMMENTED');
    expect(result.notes).toContain('correctness');
  });

  // PAN-915 supersedes PAN-846. Canonical reviewer sessions are now intended to
  // PERSIST across rounds so reviewers retain accumulated context (codebase
  // patterns, prior findings, decisions). Sessions are torn down by terminal
  // lifecycle events (merge complete, reset, cancel, deep-wipe, explicit
  // abort), not by the per-round finally block.

  it('PAN-915: does NOT kill canonical reviewer sessions on successful round (cross-round persistence)', async () => {
    mockKillSessionAsync.mockClear();

    const spawnFn = vi.fn().mockResolvedValue(undefined);
    const waitFn = vi.fn().mockResolvedValue({ status: 'completed' });
    const waitSynthesisFn = vi.fn().mockResolvedValue({ status: 'completed' });
    const approvedResult: ReviewResult = { success: true, reviewResult: 'APPROVED', notes: 'LGTM' };
    const parseSynthesisFn = vi.fn().mockResolvedValue(approvedResult);
    const postReviewFn = vi.fn().mockResolvedValue(undefined);
    const resolvePromptTemplateFn = (name: string) => join(tmpDir, 'agents', `${name}.md`);

    const { result } = await runParallelReview(
      baseContext(),
      ['src/foo.ts'],
      [{ name: 'correctness', focus: ['logic'] }],
      { spawnFn, waitFn, waitSynthesisFn, parseSynthesisFn, postReviewFn, resolvePromptTemplateFn },
    );

    expect(result.reviewResult).toBe('APPROVED');

    // killSessionAsync must NOT be called for the canonical reviewer / synthesis
    // sessions on a successful round — they live on for the next round to
    // resume into the same Claude process via sendKeysAsync.
    expect(mockKillSessionAsync).not.toHaveBeenCalledWith(
      'specialist-panopticon-cli-PAN-999-review-correctness',
    );
    expect(mockKillSessionAsync).not.toHaveBeenCalledWith(
      'specialist-panopticon-cli-PAN-999-review-synthesis',
    );
  });

  it('PAN-915: does NOT kill canonical reviewer sessions on aborted round (cross-round persistence)', async () => {
    mockKillSessionAsync.mockClear();

    const spawnFn = vi.fn().mockResolvedValue(undefined);
    const waitFn = vi.fn().mockResolvedValue({ status: 'failed', reason: 'timeout' });
    const parseSynthesisFn = vi.fn();
    const postReviewFn = vi.fn();
    const resolvePromptTemplateFn = (name: string) => join(tmpDir, 'agents', `${name}.md`);

    const { result } = await runParallelReview(
      baseContext(),
      [],
      [{ name: 'correctness' }],
      { spawnFn, waitFn, parseSynthesisFn, postReviewFn, resolvePromptTemplateFn },
    );

    expect(result.reviewResult).toBe('COMMENTED');

    // Even when the round aborts, canonical sessions persist — the next round
    // can resume into the same Claude process. Auto-respawn within the round
    // may still call killSessionAsync (when isPaneDeadAsync says the pane is
    // dead), but on a clean failure with a live pane, no kill happens.
    expect(mockKillSessionAsync).not.toHaveBeenCalledWith(
      'specialist-panopticon-cli-PAN-999-review-synthesis',
    );
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
    // (it may still be set to 'failed' for explicit semantic failures like blocked)
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

// ── spawnReviewer provider-routing regression (PAN-540) ───────────────────────
// Verifies that spawnReviewer uses getAgentRuntimeBaseCommand() so routed
// providers (OpenAI, Google, direct Anthropic-compatible providers) get the same
// command construction as work agents instead of using a hardcoded `claude --model`.
describe('spawnReviewer runtime command routing regression', () => {
  it('review-agent.ts imports resolveSpecialistBaseCommand from router.js (PAN-636: harness-aware routing)', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(import.meta.dirname, '../../../src/lib/cloister/review-agent.ts'),
      'utf-8',
    );
    expect(src).toMatch(/import\s*\{[^}]*resolveSpecialistBaseCommand[^}]*\}\s*from\s*['"]\.\/router\.js['"]/);
  });

  it('spawnReviewer body uses resolveSpecialistBaseCommand, not a hardcoded claude --model string', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(import.meta.dirname, '../../../src/lib/cloister/review-agent.ts'),
      'utf-8',
    );

    // Isolate the spawnReviewer function body
    const spawnReviewerMatch = src.match(/async function spawnSingleReviewer[\s\S]*?^}/m);
    expect(spawnReviewerMatch).not.toBeNull();
    const fn = spawnReviewerMatch![0];

    // Must use the harness-aware routing helper — not a bare `claude --model` string.
    // resolveSpecialistBaseCommand wraps getAgentRuntimeBaseCommand and adds harness/ToS routing.
    expect(fn).toContain('resolveSpecialistBaseCommand(');
    expect(fn).not.toMatch(/`claude\s+--(?:dangerously-skip-permissions|model)/);
  });

  it('review-agent.ts uses launcher exports for provider env isolation', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(import.meta.dirname, '../../../src/lib/cloister/review-agent.ts'),
      'utf-8',
    );
    expect(src).toMatch(/getProviderExportsForModel/);
    expect(src).toMatch(/generateLauncherScript/);
    expect(src).toMatch(/BLANKED_PROVIDER_ENV/);
  });

  it('spawnReviewer uses a bash launcher script, not tmux -e env flags', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(import.meta.dirname, '../../../src/lib/cloister/review-agent.ts'),
      'utf-8',
    );

    const spawnReviewerMatch = src.match(/async function spawnSingleReviewer[\s\S]*?^}/m);
    expect(spawnReviewerMatch).not.toBeNull();
    const fn = spawnReviewerMatch![0];

    // Must write a launcher script file and run it via bash
    expect(fn).toContain('getProviderExportsForModel(');
    expect(fn).toContain('generateLauncherScript(');
    expect(fn).toContain('writeFile(');
    expect(fn).toMatch(/bash\s+.*launcherPath/);

    // Provider env flows through launcher exports — must avoid old tmux `-e KEY=value` transport.
    expect(fn).not.toMatch(/createSessionAsync\([\s\S]*-e\s/);
    const envMatch = fn.match(/\{\s*env\s*:[\s\S]*?\}/);
    if (envMatch) {
      expect(envMatch[0]).not.toMatch(/ANTHROPIC_BASE_URL|OPENAI_API_KEY|providerEnv/);
    }
  });
});
