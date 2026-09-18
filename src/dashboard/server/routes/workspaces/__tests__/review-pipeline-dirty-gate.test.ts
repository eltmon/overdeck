import { describe, expect, it, vi } from 'vitest';

// W1 deleted src/lib/state-read-home.ts and src/lib/state-home.ts; W3 deletes
// the record plane and the mirror syncs that import them. They are still on
// this module's import chain in this tree, so stub the importers rather than
// loading them. Every entry here disappears once W3 lands.
vi.mock('../../../../../lib/pan-dir/record.js', () => ({}));
vi.mock('../../../../../lib/pan-dir/record-update.js', () => ({}));
vi.mock('../../../../../lib/pan-dir/record-list.js', () => ({}));
vi.mock('../../../../../lib/pan-dir/records.js', () => ({}));
vi.mock('../../../../../lib/pan-dir/records-backfill.js', () => ({}));
vi.mock('../../../../../lib/pan-dir/auto-commit.js', () => ({}));
vi.mock('../../../../../lib/pan-dir/agents.js', () => ({}));
vi.mock('../../../../../lib/pan-dir/push-health.js', () => ({}));
vi.mock('../../../../../lib/overdeck/review-status-record-sync.js', () => ({}));
vi.mock('../../../../../lib/remote-workspace.js', () => ({}));
vi.mock('../../../../../lib/remote/remote-agents.js', () => ({}));
vi.mock('../../../../../lib/state-auto-migrate.js', () => ({}));
vi.mock('../../../../../lib/memory/state-mirror.js', () => ({}));
vi.mock('../../../../../lib/overdeck/planning-promotion.js', () => ({}));
vi.mock('../../../../../lib/overdeck/conversation-retrospective.js', () => ({}));
vi.mock('../../../../../lib/orders/dispatch-gate.js', () => ({}));
vi.mock('../../../../../lib/orders/dispatch-reservation.js', () => ({}));
vi.mock('../../../../../lib/cloister/flywheel.js', () => ({}));
vi.mock('../../../../../lib/cloister/state-recreation-patrol.js', () => ({}));
vi.mock('../../../../../lib/agents/spawn.js', () => ({ spawnRun: vi.fn(), spawnAgent: vi.fn(), spawnRunPromise: vi.fn() }));
vi.mock('../../../../../lib/agents.js', () => ({ transitionIssueToInReview: vi.fn(), spawnRun: vi.fn() }));



import { getDirtyWorkspaceErrorForReviewRequestStatus } from '../review-pipeline.js';

describe('getDirtyWorkspaceErrorForReviewRequestStatus', () => {
  const workspacePath = '/tmp/workspaces/feature-pan-2167';

  it('returns null when status is clean', () => {
    expect(getDirtyWorkspaceErrorForReviewRequestStatus('', workspacePath)).toBeNull();
    expect(getDirtyWorkspaceErrorForReviewRequestStatus('   \n', workspacePath)).toBeNull();
  });

  // PAN-3917: there is no state plane in the workspace any more. `.pan/` is
  // tracked repo content the agent commits itself, so uncommitted `.pan/`
  // files are the agent's own work and the reviewer would not see them.
  it('treats uncommitted .pan/ plan artifacts as dirt', () => {
    const status = [
      ' M .pan/continues/pan-2167.xbrief.json',
      '?? .pan/drafts/min-911.md',
    ].join('\n');

    const error = getDirtyWorkspaceErrorForReviewRequestStatus(status, workspacePath);
    expect(error).toContain('uncommitted changes');
    expect(error).toContain(workspacePath);
  });

  it('returns the dirty workspace error when status contains a source file', () => {
    const status = ' M src/foo.ts';

    const error = getDirtyWorkspaceErrorForReviewRequestStatus(status, workspacePath);
    expect(error).toContain('uncommitted changes');
    expect(error).toContain('git status');
  });
});
