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
import { mkdirSync, writeFileSync, rmSync } from 'fs';
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
  type ReviewResult,
} from '../../../src/lib/cloister/review-agent.js';

// ── dispatchParallelReview ────────────────────────────────────────────────────
// vi.mock is hoisted, so mock fns must be defined with vi.hoisted() before they
// are referenced in the factory.

const { mockSetReviewStatus, mockGetReviewStatus } = vi.hoisted(() => ({
  mockSetReviewStatus: vi.fn(),
  mockGetReviewStatus: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../src/lib/review-status.js', () => ({
  setReviewStatus: mockSetReviewStatus,
  getReviewStatus: mockGetReviewStatus,
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

  it('reviewing→pending: background spawn failure overwrites optimistic reviewing status', async () => {
    // This covers the deacon/service recovery path: dispatchParallelReview returns immediately,
    // the caller optimistically sets 'reviewing', then the background .catch resets to 'pending'.
    const spawnFn = vi.fn().mockRejectedValue(new Error('spawn failure'));

    await dispatchParallelReview(baseOpts, { spawnFn });
    // Simulate what deacon/service does after dispatch: optimistically mark reviewing
    mockSetReviewStatus('PAN-999', { reviewStatus: 'reviewing' });

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
  it('returns completed when session exits with output file present', async () => {
    const sessionExists = vi.fn().mockResolvedValue(false); // session already gone
    const fileExists = vi.fn().mockReturnValue(true);       // output file written
    const killSession = vi.fn().mockResolvedValue(undefined);

    const result = await waitForReviewer('review-PAN-999-ts-correctness', '/tmp/out.md', 5000, {
      sessionExists, fileExists, killSession,
    });

    expect(result).toBe('completed');
    expect(fileExists).toHaveBeenCalledWith('/tmp/out.md');
    expect(killSession).not.toHaveBeenCalled();
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
});
