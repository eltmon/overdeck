import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { XBriefItem } from '../../xbrief/types.js';

const repoRootsMock = vi.hoisted(() => ({
  resolveWorkspaceRepoRootsSync: vi.fn(),
}));

vi.mock('../../project-repos.js', async () => {
  const actual = await vi.importActual<typeof import('../../project-repos.js')>('../../project-repos.js');
  return {
    ...actual,
    resolveWorkspaceRepoRootsSync: repoRootsMock.resolveWorkspaceRepoRootsSync,
  };
});

import { deliverCommitForReview } from '../tier-supervisor.js';

const tempDirs: string[] = [];
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Overdeck Test',
  GIT_AUTHOR_EMAIL: 'test@overdeck.local',
  GIT_COMMITTER_NAME: 'Overdeck Test',
  GIT_COMMITTER_EMAIL: 'test@overdeck.local',
};

function createRepo(workspace: string, repoKey: string, filename: string): { dir: string; sha: string } {
  const dir = join(workspace, repoKey);
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, env: gitEnv });
  writeFileSync(join(dir, filename), `${repoKey} change\n`);
  execFileSync('git', ['add', filename], { cwd: dir, env: gitEnv });
  execFileSync('git', ['commit', '-m', `${repoKey} change`], { cwd: dir, env: gitEnv });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, env: gitEnv, encoding: 'utf-8' }).trim();
  return { dir, sha };
}

afterEach(() => {
  repoRootsMock.resolveWorkspaceRepoRootsSync.mockReset();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('deliverCommitForReview polyrepo diff', () => {
  it('renders each composite anchor commit from its sub-repo', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'tier-supervisor-polyrepo-'));
    tempDirs.push(workspace);
    const fe = createRepo(workspace, 'fe', 'frontend.txt');
    const api = createRepo(workspace, 'api', 'backend.txt');
    repoRootsMock.resolveWorkspaceRepoRootsSync.mockReturnValue([
      {
        repoKey: 'fe',
        dir: fe.dir,
        sourceBranch: 'feature/min-882',
        targetBranch: 'main',
        isPolyrepo: true,
      },
      {
        repoKey: 'api',
        dir: api.dir,
        sourceBranch: 'feature/min-882',
        targetBranch: 'main',
        isPolyrepo: true,
      },
    ]);
    const deliver = vi.fn().mockResolvedValue({ ok: true, path: 'supervisor' as const });

    await deliverCommitForReview({
      supervisorAgentId: 'agent-min-882-review-supervisor',
      workspacePath: workspace,
      issueId: 'MIN-882',
      item: {
        id: 'metering-cost-door',
        title: 'Metering cost door',
        status: 'running',
      } as XBriefItem,
      sha: `fe@${fe.sha} api@${api.sha}`,
      deps: { deliver },
    });

    expect(deliver).toHaveBeenCalledTimes(1);
    const message = deliver.mock.calls[0][1] as string;
    expect(message).toContain('── fe ──');
    expect(message).toContain('frontend.txt');
    expect(message).toContain('── api ──');
    expect(message).toContain('backend.txt');
  });
});
