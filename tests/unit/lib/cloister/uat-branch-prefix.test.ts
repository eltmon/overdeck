/**
 * Configured per-repo branch prefixes must reach the real assembly adapter
 * (PAN-3093 review round 3).
 *
 * The canonical resolver honours `branch_prefix`, so a member repo can produce
 * `feat/<issue>`. A validator hardcoded to `feature/` made every one of that
 * repo's contributions throw and get held out — the whole repo silently
 * unusable.
 */

import { describe, it, expect } from 'vitest';
import { buildUatGenerationGitDeps } from '../../../../src/lib/cloister/uat-generation-deps.js';

describe('feature branch prefix validation', () => {
  it('accepts a branch in the repo\'s configured namespace', async () => {
    const git = buildUatGenerationGitDeps('/tmp/does-not-exist', { featureBranchPrefix: 'feat/' });

    // Reaching git at all means validation passed; the repo is absent so the
    // command fails, which is a different error than the validator's.
    await expect(git.branchHeadSha('feat/min-901')).rejects.not.toThrow(/unsafe feature branch name/);
  });

  it('still rejects a branch outside the configured namespace', async () => {
    const git = buildUatGenerationGitDeps('/tmp/does-not-exist', { featureBranchPrefix: 'feat/' });

    await expect(git.branchHeadSha('feature/min-901')).rejects.toThrow(/unsafe feature branch name/);
  });

  it('defaults to feature/ when no prefix is configured', async () => {
    const git = buildUatGenerationGitDeps('/tmp/does-not-exist');

    await expect(git.branchHeadSha('feat/min-901')).rejects.toThrow(/unsafe feature branch name/);
  });

  it('rejects shell metacharacters and traversal in a custom namespace', async () => {
    const git = buildUatGenerationGitDeps('/tmp/does-not-exist', { featureBranchPrefix: 'feat/' });

    for (const bad of ['feat/../../etc/passwd', 'feat/x;rm -rf /', 'feat/$(whoami)', 'feat/']) {
      await expect(git.branchHeadSha(bad)).rejects.toThrow(/unsafe feature branch name/);
    }
  });
});
