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
  type ReviewResult,
} from '../../../src/lib/cloister/review-agent.js';

// ── dispatchParallelReview ────────────────────────────────────────────────────
// vi.mock is hoisted, so mock fns must be defined with vi.hoisted() before they
// are referenced in the factory.

const { mockSetReviewStatus, mockGetReviewStatus, mockLoadCloisterConfig } = vi.hoisted(() => ({
  mockSetReviewStatus: vi.fn(),
  mockGetReviewStatus: vi.fn().mockReturnValue(null),
  // Throws by default so getReviewAgents() falls back to DEFAULT_REVIEW_AGENTS (same as real missing config)
  mockLoadCloisterConfig: vi.fn().mockImplementation(() => { throw new Error('no config'); }),
}));

vi.mock('../../../src/lib/review-status.js', () => ({
  setReviewStatus: mockSetReviewStatus,
  getReviewStatus: mockGetReviewStatus,
}));

vi.mock('../../../src/lib/cloister/config.js', () => ({
  loadCloisterConfig: mockLoadCloisterConfig,
}));

describe('dispatchParallelReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseOpts = {
    issueId: 'PAN-999',
    workspace: '/workspaces/feature-pan-999',
    branch: 'feature/pan-999',
    prUrl: 'https://github.com/org/repo/pull/1',
  };

  it('calls setReviewStatus with mapped status when spawnFn resolves', async () => {
    const approvedResult: ReviewResult = { success: true, reviewResult: 'APPROVED', notes: 'LGTM' };
    const spawnFn = vi.fn().mockResolvedValue(approvedResult);

    const ret = await dispatchParallelReview(baseOpts, { spawnFn });

    expect(ret.success).toBe(true);
    // Fire-and-forget: flush the microtask queue so .then() runs
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(spawnFn).toHaveBeenCalledOnce();
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-999', {
      reviewStatus: 'passed',
      reviewNotes: 'LGTM',
    });
  });

  it('calls setReviewStatus with pending when spawnFn rejects', async () => {
    const spawnFn = vi.fn().mockRejectedValue(new Error('spawn failure'));

    const ret = await dispatchParallelReview(baseOpts, { spawnFn });

    expect(ret.success).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(spawnFn).toHaveBeenCalledOnce();
    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-999', { reviewStatus: 'pending' });
  });

  it('maps CHANGES_REQUESTED to blocked status on success path', async () => {
    const blockedResult: ReviewResult = { success: true, reviewResult: 'CHANGES_REQUESTED', notes: 'Fix required' };
    const spawnFn = vi.fn().mockResolvedValue(blockedResult);

    await dispatchParallelReview(baseOpts, { spawnFn });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-999', {
      reviewStatus: 'blocked',
      reviewNotes: 'Fix required',
    });
  });

  it('reviewing→pending: sets reviewing optimistically then resets to pending on spawn failure', async () => {
    // dispatchParallelReview now manages the status lifecycle internally:
    // 1. sets 'reviewing' before fire-and-forget
    // 2. resets to 'pending' in .catch if spawn fails
    // Callers no longer set reviewStatus themselves, eliminating the race condition.
    const spawnFn = vi.fn().mockRejectedValue(new Error('spawn failure'));

    await dispatchParallelReview(baseOpts, { spawnFn });

    // Flush the microtask queue so the background .catch() fires
    await new Promise(resolve => setTimeout(resolve, 0));

    const calls = mockSetReviewStatus.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual(['PAN-999', { reviewStatus: 'reviewing' }]);
    expect(calls[1]).toEqual(['PAN-999', { reviewStatus: 'pending' }]);
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
    // Must reference pan done / rebase-and-submit skill
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

  it('APPROVED body does not include resubmit instructions', () => {
    const approved: ReviewResult = { success: true, reviewResult: 'APPROVED', notes: 'LGTM' };
    const body = buildReviewFeedbackBody('PAN-999', approved);
    expect(body).toContain('approved');
    expect(body).not.toMatch(/pan done|rebase-and-submit|request-review/);
  });
});

// ── waitForReviewer ───────────────────────────────────────────────────────────

describe('waitForReviewer', () => {
  it('returns completed when output file appears while session still running', async () => {
    // This is the normal case: Claude writes the file but does not exit.
    // waitForReviewer must detect the file and kill the session.
    const sessionExists = vi.fn().mockResolvedValue(true); // session still running
    const fileExists = vi.fn().mockReturnValue(true);       // output file written
    const killSession = vi.fn().mockResolvedValue(undefined);

    const result = await waitForReviewer('review-PAN-999-ts-correctness', '/tmp/out.md', 5000, {
      sessionExists, fileExists, killSession,
    });

    expect(result).toBe('completed');
    expect(fileExists).toHaveBeenCalledWith('/tmp/out.md');
    expect(killSession).toHaveBeenCalledWith('review-PAN-999-ts-correctness');
  });

  it('returns completed when session exits with output file present', async () => {
    const sessionExists = vi.fn().mockResolvedValue(false); // session already gone
    const fileExists = vi.fn().mockReturnValue(true);       // output file written
    const killSession = vi.fn().mockResolvedValue(undefined);

    const result = await waitForReviewer('review-PAN-999-ts-correctness', '/tmp/out.md', 5000, {
      sessionExists, fileExists, killSession,
    });

    expect(result).toBe('completed');
    expect(fileExists).toHaveBeenCalledWith('/tmp/out.md');
    // killSession still called (session exists check never reached when file found first)
    expect(killSession).toHaveBeenCalledWith('review-PAN-999-ts-correctness');
  });

  it('returns failed when session exits without output file', async () => {
    const sessionExists = vi.fn().mockResolvedValue(false);
    const fileExists = vi.fn().mockReturnValue(false);
    const killSession = vi.fn().mockResolvedValue(undefined);

    const result = await waitForReviewer('review-PAN-999-ts-correctness', '/tmp/out.md', 5000, {
      sessionExists, fileExists, killSession,
    });

    expect(result).toBe('failed');
    expect(killSession).not.toHaveBeenCalled();
  });

  it('kills session and returns failed on timeout', async () => {
    const sessionExists = vi.fn().mockResolvedValue(true); // session always running
    const fileExists = vi.fn().mockReturnValue(false);
    const killSession = vi.fn().mockResolvedValue(undefined);

    // timeoutMs = 0 → deadline already passed → loop never enters → timeout path
    const result = await waitForReviewer('review-PAN-999-ts-correctness', '/tmp/out.md', 0, {
      sessionExists, fileExists, killSession,
    });

    expect(result).toBe('failed');
    expect(sessionExists).not.toHaveBeenCalled(); // never entered loop
    expect(killSession).toHaveBeenCalledWith('review-PAN-999-ts-correctness');
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
    expect(reviewResultToReviewStatus('CHANGES_REQUESTED')).toBe('blocked');
  });

  it('maps APPROVED to passed', () => {
    expect(reviewResultToReviewStatus('APPROVED')).toBe('passed');
  });

  it('maps COMMENTED to pending', () => {
    expect(reviewResultToReviewStatus('COMMENTED')).toBe('pending');
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

  it('falls back to defaultModel for unknown roles', () => {
    const model = resolveReviewerModel(
      { name: 'unknown-role', focus: [] },
      'claude-haiku-4-5',
    );
    expect(model).toBe('claude-haiku-4-5');
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
  // Template frontmatter uses "haiku"/"sonnet"/"opus" but getProviderEnvForModel
  // and claude --model require fully-qualified IDs (claude-haiku-4-5 etc.).
  it('resolves "haiku" alias from template default to concrete claude-haiku-4-5', () => {
    const model = resolveReviewerModel({ name: 'unknown-role', focus: [] }, 'haiku');
    expect(model).toBe('claude-haiku-4-5');
    expect(model).toMatch(/^claude-/);
  });

  it('resolves "sonnet" alias from template default to concrete claude-sonnet-4-6', () => {
    const model = resolveReviewerModel({ name: 'unknown-role', focus: [] }, 'sonnet');
    expect(model).toBe('claude-sonnet-4-6');
    expect(model).toMatch(/^claude-/);
  });

  it('resolves "opus" alias from template default to concrete claude-opus-4-6', () => {
    const model = resolveReviewerModel({ name: 'unknown-role', focus: [] }, 'opus');
    expect(model).toBe('claude-opus-4-6');
    expect(model).toMatch(/^claude-/);
  });

  it('passes through concrete model IDs unchanged', () => {
    const model = resolveReviewerModel({ name: 'unknown-role', focus: [] }, 'claude-haiku-4-5');
    expect(model).toBe('claude-haiku-4-5');
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
  // Templates live at agents/<name>.md, two directories up from tests/lib/cloister/
  const templatePath = resolve(import.meta.dirname, '../../../agents', `${name}.md`);
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
    expect(src).toContain('existsSync(templatePath)');
  });
});

// ── resolveTemplatePath ───────────────────────────────────────────────────────

describe('resolveTemplatePath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pan-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns workspace agents/ path when template exists in the project', () => {
    mkdirSync(join(tmpDir, 'agents'), { recursive: true });
    writeFileSync(join(tmpDir, 'agents', 'code-review-correctness.md'), 'template content');
    const result = resolveTemplatePath('code-review-correctness', tmpDir);
    expect(result).toBe(join(tmpDir, 'agents', 'code-review-correctness.md'));
  });

  it('falls back to CACHE_AGENTS_DIR when template is absent from workspace', () => {
    // No agents/ dir in tmpDir → must fall back to the global cache path
    const result = resolveTemplatePath('code-review-correctness', tmpDir);
    expect(result).toContain('agent-definitions');
    expect(result).toContain('code-review-correctness.md');
  });
});

// ── runParallelReview orchestration ──────────────────────────────────────────

describe('runParallelReview', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pan-review-'));
    // Create workspace agents/ dir with minimal templates so resolveTemplatePath
    // finds them in the workspace (proving branch templates take precedence).
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
    const waitFn = vi.fn().mockResolvedValue('completed');
    const approvedResult: ReviewResult = { success: true, reviewResult: 'APPROVED', notes: 'LGTM' };
    const parseSynthesisFn = vi.fn().mockResolvedValue(approvedResult);
    const postReviewFn = vi.fn().mockResolvedValue(undefined);

    const { result } = await runParallelReview(
      baseContext(),
      ['src/foo.ts'],
      [{ name: 'correctness', focus: ['logic'] }],
      { spawnFn, waitFn, parseSynthesisFn, postReviewFn },
    );

    expect(spawnFn).toHaveBeenCalledTimes(2); // 1 reviewer + 1 synthesis
    expect(waitFn).toHaveBeenCalledTimes(2);
    expect(parseSynthesisFn).toHaveBeenCalledOnce();
    expect(postReviewFn).toHaveBeenCalledOnce();
    expect(result.reviewResult).toBe('APPROVED');
  });

  it('failure path: reviewer failure aborts synthesis → COMMENTED returned', async () => {
    const spawnFn = vi.fn().mockResolvedValue(undefined);
    const waitFn = vi.fn().mockResolvedValue('failed'); // all reviewers fail
    const parseSynthesisFn = vi.fn();
    const postReviewFn = vi.fn();

    const { result } = await runParallelReview(
      baseContext(),
      [],
      [{ name: 'correctness' }],
      { spawnFn, waitFn, parseSynthesisFn, postReviewFn },
    );

    expect(parseSynthesisFn).not.toHaveBeenCalled();
    expect(postReviewFn).not.toHaveBeenCalled();
    expect(result.reviewResult).toBe('COMMENTED');
    expect(result.notes).toContain('correctness');
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
