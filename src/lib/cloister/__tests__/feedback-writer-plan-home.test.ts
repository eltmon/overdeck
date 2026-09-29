import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
  findProjectByPath: vi.fn().mockReturnValue(null),
}));

import { clearFeedbackFiles, writeFeedbackFile } from '../feedback-writer.js';
import { continueStatePath } from '../../xbrief/continue-state.js';

let TEST_DIR: string;
const issueId = 'PAN-4242';

function workspaceDir(): string {
  return join(TEST_DIR, 'workspaces', 'feature-pan-4242');
}

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'feedback-writer-plan-home-'));
  mocks.resolveProjectFromIssueSync.mockReturnValue({
    projectKey: 'x',
    projectName: 'x',
    projectPath: TEST_DIR,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('writeFeedbackFile / clearFeedbackFiles plan-home routing (PAN-4225)', () => {
  it('ac1: writes feedback[0] to the workspace continue file and creates the .pan/feedback mirror', async () => {
    mkdirSync(workspaceDir(), { recursive: true });

    const result = await writeFeedbackFile({
      issueId,
      specialist: 'review-agent',
      outcome: 'changes-requested',
      summary: 'Review changes requested',
      markdownBody: '# Review changes requested',
    });

    expect(result.success).toBe(true);
    expect(
      existsSync(join(workspaceDir(), '.overdeck', 'feedback', '001-review-agent-changes-requested.md')),
    ).toBe(true);

    const continuePath = continueStatePath(workspaceDir(), issueId);
    expect(existsSync(continuePath)).toBe(true);
    const state = JSON.parse(readFileSync(continuePath, 'utf-8'));
    expect(state.feedback).toHaveLength(1);
    expect(state.feedback[0].specialist).toBe('review-agent');
  });

  it('ac2: leaves the primary checkout untouched once writeFeedbackFile and clearFeedbackFiles have run', async () => {
    mkdirSync(workspaceDir(), { recursive: true });

    await writeFeedbackFile({
      issueId,
      specialist: 'review-agent',
      outcome: 'approved',
      summary: 'Approved',
      markdownBody: '# Approved',
    });
    await clearFeedbackFiles(workspaceDir());

    expect(existsSync(join(TEST_DIR, '.pan'))).toBe(false);
  });

  it('ac3: clearFeedbackFiles on a workspace with no continue file leaves .pan/continues absent', async () => {
    mkdirSync(workspaceDir(), { recursive: true });

    await clearFeedbackFiles(workspaceDir());

    expect(existsSync(join(workspaceDir(), '.pan', 'continues'))).toBe(false);
  });

  it('ac4: returns success: true with filePath under the workspace .pan/feedback/', async () => {
    mkdirSync(workspaceDir(), { recursive: true });

    const result = await writeFeedbackFile({
      issueId,
      specialist: 'test-agent',
      outcome: 'failed',
      summary: 'Tests failed',
      markdownBody: '# Tests failed',
    });

    expect(result.success).toBe(true);
    expect(result.filePath).toBe(join(workspaceDir(), '.overdeck', 'feedback', '001-test-agent-failed.md'));
  });
});
