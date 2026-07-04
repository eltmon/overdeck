import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveProjectFromIssueSync: vi.fn(),
  appendContinueSessionEntryForIssue: vi.fn(),
  appendFeedbackEntryForIssue: vi.fn(),
  clearFeedbackForIssue: vi.fn(),
  readContinueStateForIssue: vi.fn(),
  clearFeedback: vi.fn(),
  getWorkspacePanPaths: vi.fn(),
  readFeedback: vi.fn(),
  writeFeedback: vi.fn(),
}));

vi.mock('../../projects.js', () => ({
  resolveProjectFromIssueSync: mocks.resolveProjectFromIssueSync,
}));

vi.mock('../../vbrief/lifecycle-io.js', () => ({
  appendContinueSessionEntryForIssue: mocks.appendContinueSessionEntryForIssue,
  appendFeedbackEntryForIssue: mocks.appendFeedbackEntryForIssue,
  clearFeedbackForIssue: mocks.clearFeedbackForIssue,
  readContinueStateForIssue: mocks.readContinueStateForIssue,
}));

vi.mock('../../pan-dir/index.js', () => ({
  clearFeedback: mocks.clearFeedback,
  getWorkspacePanPaths: mocks.getWorkspacePanPaths,
  readFeedback: mocks.readFeedback,
  writeFeedback: mocks.writeFeedback,
}));

import { writeFeedbackFile } from '../feedback-writer.js';

describe('writeFeedbackFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectFromIssueSync.mockReturnValue(null);
    mocks.readContinueStateForIssue.mockReturnValue({ feedback: [{ seq: 1 }] });
    mocks.getWorkspacePanPaths.mockReturnValue({
      feedbackDir: '/tmp/overdeck/workspaces/feature-pan-1917/.pan/feedback',
    });
    mocks.writeFeedback.mockReturnValue(Effect.succeed(undefined));
  });

  it('falls back to the workspace path when project resolution is unavailable', async () => {
    const result = await Effect.runPromise(writeFeedbackFile({
      issueId: 'PAN-1917',
      workspacePath: '/tmp/overdeck/workspaces/feature-pan-1917',
      specialist: 'review-agent',
      outcome: 'failed',
      summary: 'Review failed',
      markdownBody: '# Review FAILED for PAN-1917',
    }));
    const generatedFilename = result.relativePath?.split('/').pop();

    expect(result.success).toBe(true);
    expect(result.relativePath).toMatch(/\.pan\/feedback\/\d{3}-review-agent-failed\.md$/);
    expect(result.filePath).toBe(`/tmp/overdeck/workspaces/feature-pan-1917/.pan/feedback/${generatedFilename}`);
    expect(mocks.readContinueStateForIssue).toHaveBeenCalledWith('/tmp/overdeck', 'PAN-1917');
    expect(mocks.appendFeedbackEntryForIssue).toHaveBeenCalledWith('/tmp/overdeck', 'PAN-1917', expect.objectContaining({
      seq: expect.any(Number),
      specialist: 'review-agent',
      outcome: 'failed',
      markdownBody: '# Review FAILED for PAN-1917',
    }));
    expect(mocks.appendContinueSessionEntryForIssue).toHaveBeenCalledWith('/tmp/overdeck', 'PAN-1917', expect.objectContaining({
      reason: 'feedback',
    }));
    expect(mocks.writeFeedback).toHaveBeenCalledWith(
      '/tmp/overdeck/workspaces/feature-pan-1917',
      expect.stringMatching(/^\d{3}-review-agent-failed\.md$/),
      '# Review FAILED for PAN-1917',
    );
  });
});
