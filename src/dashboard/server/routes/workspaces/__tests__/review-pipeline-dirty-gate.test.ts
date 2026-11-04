import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

// W1 deleted src/lib/state-read-home.ts and src/lib/state-home.ts; W3 deletes
// the record plane and the mirror syncs that import them. They are still on
// this module's import chain in this tree, so stub the importers rather than
// loading them. Every entry here disappears once W3 lands.
vi.mock('../../../../../lib/remote-workspace.js', () => ({}));
vi.mock('../../../../../lib/remote/remote-agents.js', () => ({}));
vi.mock('../../../../../lib/overdeck/planning-promotion.js', () => ({}));
vi.mock('../../../../../lib/overdeck/conversation-retrospective.js', () => ({}));
vi.mock('../../../../../lib/cloister/flywheel.js', () => ({}));
vi.mock('../../../../../lib/agents/spawn.js', () => ({ spawnRun: vi.fn(), spawnAgent: vi.fn(), spawnRunPromise: vi.fn() }));
vi.mock('../../../../../lib/agents.js', () => ({ transitionIssueToInReview: vi.fn(), spawnRun: vi.fn() }));


import { getDirtyWorkspaceErrorForReviewRequestStatus, reReviewGuardError } from '../review-pipeline.js';
import { clearFeedbackFiles } from '../../../../../lib/cloister/feedback-writer.js';

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

// PAN-4690: review dispatch used to rewrite the tracked continue file's
// feedback[] without committing it, so deacon-lite's re-request of the
// undispatched review was refused by this guard on every tick.
describe('re-request guard after a review dispatch clears feedback (PAN-4690)', () => {
  it('passes for a workspace whose committed continue file has feedback[]', async () => {
    const root = mkdtempSync(join(tmpdir(), 'review-pipeline-dirty-gate-'));
    const workspacePath = join(root, 'workspaces', 'feature-pan-4690');
    const git = (args: string[]) => execFileSync('git', args, { cwd: workspacePath, encoding: 'utf-8' });
    try {
      mkdirSync(join(workspacePath, '.pan', 'continues'), { recursive: true });
      git(['init', '-q']);
      git(['config', 'user.email', 'test@example.com']);
      git(['config', 'user.name', 'test']);
      git(['config', 'commit.gpgsign', 'false']);
      writeFileSync(join(workspacePath, '.pan', 'continues', 'PAN-4690.xbrief.json'), `${JSON.stringify({
        version: '1',
        issueId: 'PAN-4690',
        created: '2026-11-01T07:00:00.000Z',
        updated: '2026-11-01T07:20:00.000Z',
        gitState: {},
        decisions: [],
        hazards: [],
        resumePoint: null,
        sessionHistory: [],
        feedback: [{ seq: 1, specialist: 'ci-monitor', outcome: 'failed', timestamp: '2026-11-01T07:10:00.000Z', markdownBody: '# CI red' }],
      }, null, 2)}\n`);
      git(['add', '.']);
      git(['commit', '-q', '-m', 'seed']);

      await clearFeedbackFiles(workspacePath);

      await expect(reReviewGuardError('PAN-4690', workspacePath, { isRemote: false }, null)).resolves.toBeNull();

      // Control: the guard is live — the pre-fix rewrite of feedback[] is refused.
      writeFileSync(join(workspacePath, '.pan', 'continues', 'PAN-4690.xbrief.json'), '{"feedback": []}\n');
      await expect(reReviewGuardError('PAN-4690', workspacePath, { isRemote: false }, null))
        .resolves.toMatchObject({ error: 'working tree is dirty' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
