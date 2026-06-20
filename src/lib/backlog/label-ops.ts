import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import { resolveGitHubIssueSync } from '../tracker-utils.js';

const execAsync = promisify(exec);

export const PARKED_LABEL = 'needs-design';

/**
 * Apply the parked label to a GitHub issue when its gate is set to 'blocked'.
 * Non-GitHub issues are silently skipped.
 */
export async function applyIssueParkedLabel(issueId: string): Promise<void> {
  const resolution = resolveGitHubIssueSync(issueId);
  if (!resolution.isGitHub) return;
  const { owner, repo, number } = resolution;
  await execAsync(
    `gh issue edit ${number} --repo ${owner}/${repo} --add-label "${PARKED_LABEL}" 2>/dev/null || true`,
  );
}
