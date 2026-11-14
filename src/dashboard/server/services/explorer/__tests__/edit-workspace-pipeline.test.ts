import { describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '../../../../../lib/projects.js';
import type { WorkspaceRow } from '../../../../../lib/workspaces/types.js';
import { EditWorkspaceError } from '../edit-workspace-errors.js';
import type { GhRunner } from '../edit-workspace-gh.js';
import { sendThroughPipeline, type EditWorkspacePipelineDeps } from '../edit-workspace-pipeline.js';
import type { ExplorerRoot } from '../roots.js';

const PATH = '/p/workspaces/scratch-edit-1';
const INPUT = { title: 'chore: edit README.md', body: 'Some context.\n\n' };

function row(): WorkspaceRow {
  return {
    id: 'w1', projectId: 'p', kind: 'scratch', name: 'edit-1', path: PATH, branchName: 'scratch/edit-1',
    parentBranch: 'main', parentBranchGuessed: false, isGitRepository: true, issueId: null, layoutConfig: null,
    runCommand: null, isFavorite: false, isArchived: false, title: null, createdAt: 1, lastAccessedAt: 1,
  };
}

interface Harness {
  deps: EditWorkspacePipelineDeps;
  order: string[];
  ghCalls: string[][];
  adopt: ReturnType<typeof vi.fn>;
  ensurePr: ReturnType<typeof vi.fn>;
  removeEditWorkspace: ReturnType<typeof vi.fn>;
  commitAll: ReturnType<typeof vi.fn>;
}

function harness(opts: {
  config?: Partial<ProjectConfig>;
  editPrState?: string | null;
  pushFails?: boolean;
  workspaceExists?: boolean;
  adoptNeverSettles?: boolean;
} = {}): Harness {
  const order: string[] = [];
  const ghCalls: string[][] = [];
  const root: ExplorerRoot = { kind: 'workspace', id: 'workspace:w1', absPath: PATH, writable: true, projectKey: 'p', workspaceId: 'w1', defaultBranch: 'main' };
  const gh: GhRunner = async (args) => {
    ghCalls.push(args);
    if (args[0] === 'pr' && args[1] === 'list') {
      const state = opts.editPrState ?? null;
      return { stdout: JSON.stringify(state ? [{ number: 3, url: 'https://github.com/o/r/pull/3', state }] : []) };
    }
    if (args[0] === 'issue' && args[1] === 'create') {
      order.push('issue');
      return { stdout: 'https://github.com/o/r/issues/77\n' };
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  const commitAll = vi.fn(async (..._args: unknown[]) => {
    order.push('commit');
    return { committed: true };
  });
  const pushHead = vi.fn(async (_cwd: string, branch: string) => {
    order.push(`push ${branch}`);
    if (opts.pushFails) throw new EditWorkspaceError('PUSH_FAILED', 502, `Pushing ${branch} failed: rejected`);
  });
  const ensurePr = vi.fn(async (issueId: string, _options: unknown) => {
    order.push(`ensurePr ${issueId}`);
    return { created: true, prUrl: 'https://github.com/o/r/pull/88' };
  });
  const removeEditWorkspace = vi.fn(async (..._args: unknown[]) => {
    order.push('remove');
  });
  const adopt = vi.fn((..._args: unknown[]) => {
    order.push('adopt');
    return opts.adoptNeverSettles ? new Promise(() => {}) : Promise.resolve({ kind: 'started', workspacePath: '/p/workspaces/feature-pan-77' });
  });
  const deps: EditWorkspacePipelineDeps = {
    resolveRoot: async () => root,
    getWorkspaceById: () => row(),
    listProjects: async () => [
      { key: 'p', config: { name: 'p', path: '/p', github_repo: 'o/r', issue_prefix: 'PAN', ...opts.config } as ProjectConfig },
    ],
    gh,
    commitAll: commitAll as EditWorkspacePipelineDeps['commitAll'],
    pushHead: pushHead as EditWorkspacePipelineDeps['pushHead'],
    headSha: async () => 'sha77',
    removeEditWorkspace: removeEditWorkspace as EditWorkspacePipelineDeps['removeEditWorkspace'],
    ensurePr: ensurePr as EditWorkspacePipelineDeps['ensurePr'],
    adopt: adopt as EditWorkspacePipelineDeps['adopt'],
    pathExists: async () => opts.workspaceExists ?? false,
  };
  return { deps, order, ghCalls, adopt, ensurePr, removeEditWorkspace, commitAll };
}

describe('sendThroughPipeline', () => {
  it('commits, creates the issue, pushes feature/pan-77, opens the PR, removes, then adopts', async () => {
    const h = harness();
    const result = await sendThroughPipeline('w1', INPUT, h.deps);
    expect(result).toEqual({
      mode: 'pipeline',
      issueId: 'PAN-77',
      issueUrl: 'https://github.com/o/r/issues/77',
      prUrl: 'https://github.com/o/r/pull/88',
      prNumber: 88,
    });
    expect(h.order).toEqual(['commit', 'issue', 'push feature/pan-77', 'ensurePr PAN-77', 'remove', 'adopt']);
    expect(h.ensurePr).toHaveBeenCalledWith('PAN-77', { cwd: PATH, branchName: 'feature/pan-77', targetBranch: 'main' });
    expect(h.removeEditWorkspace).toHaveBeenCalledWith(expect.objectContaining({ primaryPath: '/p' }), { force: false, deleteRemoteBranch: false });
  });

  it('ends the issue body with the explorer footer', async () => {
    const h = harness();
    await sendThroughPipeline('w1', INPUT, h.deps);
    const create = h.ghCalls.find((args) => args[0] === 'issue') ?? [];
    const body = create[create.indexOf('--body') + 1];
    expect(body).toBe('Some context.\n\nCreated from the Overdeck file explorer.');
    expect(create[create.indexOf('--title') + 1]).toBe('chore: edit README.md');
  });

  it('hands the PR to adoption and returns before adoption settles', async () => {
    const h = harness({ adoptNeverSettles: true });
    const result = await sendThroughPipeline('w1', INPUT, h.deps);
    expect(result.issueId).toBe('PAN-77');
    expect(h.adopt).toHaveBeenCalledWith(
      { issueId: 'PAN-77', number: 88, headRef: 'feature/pan-77', headSha: 'sha77', repo: 'o/r' },
      { source: 'api' },
    );
  });

  it('rejects PIPELINE_UNSUPPORTED for a Linear-tracked project and creates no issue', async () => {
    const h = harness({ config: { tracker: 'linear' } as Partial<ProjectConfig> });
    await expect(sendThroughPipeline('w1', INPUT, h.deps)).rejects.toMatchObject({ code: 'PIPELINE_UNSUPPORTED', status: 409 });
    expect(h.ghCalls.some((args) => args[0] === 'issue')).toBe(false);
    expect(h.commitAll).not.toHaveBeenCalled();
  });

  it('rejects PUSH_FAILED naming the created issue, and stops there', async () => {
    const h = harness({ pushFails: true });
    const error = await sendThroughPipeline('w1', INPUT, h.deps).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'PUSH_FAILED', status: 502 });
    expect((error as Error).message.startsWith('Created PAN-77')).toBe(true);
    expect(h.ensurePr).not.toHaveBeenCalled();
    expect(h.removeEditWorkspace).not.toHaveBeenCalled();
    expect(h.adopt).not.toHaveBeenCalled();
  });

  it('rejects PR_EXISTS for an open PR on the edit branch before committing', async () => {
    const h = harness({ editPrState: 'OPEN' });
    await expect(sendThroughPipeline('w1', INPUT, h.deps)).rejects.toMatchObject({ code: 'PR_EXISTS', status: 409 });
    expect(h.commitAll).not.toHaveBeenCalled();
  });

  it('is not blocked by a closed PR on the edit branch', async () => {
    const h = harness({ editPrState: 'CLOSED' });
    await expect(sendThroughPipeline('w1', INPUT, h.deps)).resolves.toMatchObject({ issueId: 'PAN-77' });
  });

  it('skips adoption when the feature workspace already exists', async () => {
    const h = harness({ workspaceExists: true });
    await sendThroughPipeline('w1', INPUT, h.deps);
    expect(h.adopt).not.toHaveBeenCalled();
  });
});
