import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
  findProjectByPath: vi.fn().mockReturnValue(null),
}));

import { clearFeedbackFiles, writeFeedbackFile } from '../feedback-writer.js';
import { continueStatePath } from '../../xbrief/continue-state.js';
import { readFeedback } from '../../pan-dir/index.js';

/**
 * PAN-4690: review dispatch clears the previous cycle's feedback. It used to
 * rewrite the tracked continue file's feedback[] without committing, so the
 * dirty-tree gate refused the review the pipeline was dispatching.
 */
const issueId = 'PAN-4690';
let TEST_DIR: string;

function workspaceDir(): string {
  return join(TEST_DIR, 'workspaces', 'feature-pan-4690');
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: workspaceDir(), encoding: 'utf-8' });
}

function seedCommittedContinueFileWithFeedback(): string {
  const path = continueStatePath(workspaceDir(), issueId);
  mkdirSync(join(workspaceDir(), '.pan', 'continues'), { recursive: true });
  writeFileSync(path, `${JSON.stringify({
    version: '1',
    issueId,
    created: '2026-11-01T07:00:00.000Z',
    updated: '2026-11-01T07:20:00.000Z',
    gitState: {},
    decisions: [],
    hazards: [],
    resumePoint: null,
    sessionHistory: [],
    feedback: [
      { seq: 1, specialist: 'ci-monitor', outcome: 'failed', timestamp: '2026-11-01T07:10:00.000Z', markdownBody: '# CI red' },
      { seq: 2, specialist: 'verification-gate', outcome: 'failed', timestamp: '2026-11-01T07:20:00.000Z', markdownBody: '# Lint failed' },
    ],
  }, null, 2)}\n`);
  writeFileSync(join(workspaceDir(), '.gitignore'), '.overdeck/\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'seed']);
  return path;
}

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'feedback-writer-clean-tree-'));
  mkdirSync(workspaceDir(), { recursive: true });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  git(['config', 'commit.gpgsign', 'false']);
  mocks.resolveProjectFromIssueSync.mockReturnValue({ projectKey: 'x', projectName: 'x', projectPath: TEST_DIR });
});

afterEach(() => {
  vi.clearAllMocks();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('clearFeedbackFiles leaves the workspace clean (PAN-4690)', () => {
  it('leaves git status --porcelain empty when the committed continue file has feedback[]', async () => {
    const continuePath = seedCommittedContinueFileWithFeedback();
    const before = readFileSync(continuePath, 'utf-8');

    await clearFeedbackFiles(workspaceDir());

    expect(git(['status', '--porcelain'])).toBe('');
    expect(readFileSync(continuePath, 'utf-8')).toBe(before);
  });

  it('clears the previous cycle from the feedback mirror the work agent reads', async () => {
    seedCommittedContinueFileWithFeedback();
    await writeFeedbackFile({
      issueId,
      specialist: 'review-agent',
      outcome: 'changes-requested',
      summary: 'Old cycle',
      markdownBody: '# Old cycle',
    });
    git(['commit', '-q', '-am', 'agent commits its feedback bookkeeping']);

    await clearFeedbackFiles(workspaceDir());
    expect(await Effect.runPromise(readFeedback(workspaceDir()))).toEqual([]);

    await writeFeedbackFile({
      issueId,
      specialist: 'review-agent',
      outcome: 'changes-requested',
      summary: 'New cycle',
      markdownBody: '# New cycle',
    });
    const current = await Effect.runPromise(readFeedback(workspaceDir()));
    expect(current).toHaveLength(1);
    expect(current[0].content).toContain('# New cycle');
    expect(current[0].content).not.toContain('# Old cycle');
  });
});
