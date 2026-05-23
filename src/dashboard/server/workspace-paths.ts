import { join, resolve, sep } from 'node:path';

import { parseIssueIdSync } from '../../lib/issue-id.js';

export function getWorkspacePathForIssue(projectPath: string, rawIssueId: string): { parsedIssueId: string; workspacePath: string } {
  const parsed = parseIssueIdSync(rawIssueId);
  if (!parsed) {
    throw new Error('Invalid issue ID');
  }

  const workspaceRoot = resolve(join(projectPath, 'workspaces'));
  const workspacePath = resolve(join(workspaceRoot, `feature-${parsed.normalized}`));

  if (workspacePath !== workspaceRoot && !workspacePath.startsWith(`${workspaceRoot}${sep}`)) {
    throw new Error('Invalid workspace path');
  }

  return {
    parsedIssueId: parsed.raw,
    workspacePath,
  };
}
