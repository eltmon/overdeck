import { describe, expect, it } from 'vitest';

import { getApproveDirtyWorkspaceErrorForStatus } from '../merge-ops.js';

describe('getApproveDirtyWorkspaceErrorForStatus', () => {
  const workspacePath = '/tmp/workspaces/feature-pan-2167';

  it('returns null when approve sees only state-plane paths', () => {
    const status = [
      'MM .pan/records/pan-2167.json',
      ' M .pan/test/result.json',
    ].join('\n');

    expect(getApproveDirtyWorkspaceErrorForStatus(status, workspacePath)).toBeNull();
  });

  it('returns the uncommitted-changes error when approve sees a dirty source path', () => {
    const error = getApproveDirtyWorkspaceErrorForStatus(' M src/foo.ts\n', workspacePath);

    expect(error).toContain('Workspace has uncommitted changes');
    expect(error).toContain(`cd ${workspacePath}`);
    expect(error).toContain('git status');
  });

  it('returns the uncommitted-changes error for mixed state-plane and source dirt', () => {
    const status = [
      'MM .pan/records/pan-2167.json',
      ' M src/foo.ts',
    ].join('\n');

    const error = getApproveDirtyWorkspaceErrorForStatus(status, workspacePath);

    expect(error).toContain('Workspace has uncommitted changes');
  });
});
