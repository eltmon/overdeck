/**
 * Regression tests for workspace planning markdown path resolution.
 */

import { describe, expect, it } from 'vitest';
import { getWorkspacePathForIssue } from '../../../../../src/dashboard/server/routes/workspaces.js';

describe('getWorkspacePathForIssue', () => {
  it('builds a workspace path from a valid issue id', () => {
    expect(getWorkspacePathForIssue('/repo/project', 'PAN-866')).toEqual({
      parsedIssueId: 'PAN-866',
      workspacePath: '/repo/project/workspaces/feature-pan-866',
    });
  });

  it('rejects traversal-style issue ids', () => {
    expect(() => getWorkspacePathForIssue('/repo/project', '../../etc/passwd')).toThrow('Invalid issue ID');
  });

  it('normalizes mixed-case issue ids', () => {
    expect(getWorkspacePathForIssue('/repo/project', 'Pan-866')).toEqual({
      parsedIssueId: 'Pan-866',
      workspacePath: '/repo/project/workspaces/feature-pan-866',
    });
  });
});
