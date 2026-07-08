import { describe, expect, it } from 'vitest';

import { getDirtyWorkspaceErrorForReviewRequestStatus } from '../review-pipeline.js';

describe('getDirtyWorkspaceErrorForReviewRequestStatus', () => {
  const workspacePath = '/tmp/workspaces/feature-pan-2167';

  it('returns null when status is clean', () => {
    expect(getDirtyWorkspaceErrorForReviewRequestStatus('', workspacePath)).toBeNull();
  });

  it('returns null when status contains only state-plane paths', () => {
    const status = [
      'MM .pan/records/pan-2167.json',
      ' M .pan/test/result.json',
      '?? .pan/feedback/review.json',
    ].join('\n');

    expect(getDirtyWorkspaceErrorForReviewRequestStatus(status, workspacePath)).toBeNull();
  });

  it('returns the dirty workspace error when status contains a source file', () => {
    const status = [
      'MM .pan/records/pan-2167.json',
      ' M src/foo.ts',
    ].join('\n');

    const error = getDirtyWorkspaceErrorForReviewRequestStatus(status, workspacePath);

    expect(error).toContain('Workspace has uncommitted changes');
    expect(error).toContain(`cd ${workspacePath}`);
    expect(error).toContain('git status');
  });
});
