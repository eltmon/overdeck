import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/lib/pipeline-notifier.js', () => ({ notifyPipeline: vi.fn() }));

import { readPipelineJournal } from '../../../../src/lib/cloister/pipeline-journal.js';
import {
  adoptionRefusalFix,
  adoptPrWorkspace,
  type AdoptionDeps,
  type AdoptionRefusal,
} from '../../../../src/lib/cloister/pr-workspace-adoption.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function commit(cwd: string, file: string, message: string): void {
  writeFileSync(join(cwd, file), `${message}\n`);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-m', message);
}

const BRANCH = 'feature/pan-1';

describe('adoptPrWorkspace (PAN-4605)', () => {
  let tempDir: string;
  let primary: string;
  let canonical: string;
  let headSha: string;
  let mainSha: string;
  let gitCalls: string[][];
  let createWorkspace: ReturnType<typeof vi.fn<AdoptionDeps['createWorkspace']>>;

  const recordingGit: AdoptionDeps['git'] = async (args, cwd) => {
    gitCalls.push([...args]);
    return execFileSync('git', [...args], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  };

  function deps(overrides: Partial<AdoptionDeps> = {}): Partial<AdoptionDeps> {
    return {
      git: recordingGit,
      createWorkspace,
      resolveProject: () => ({ projectPath: primary, projectName: 'demo', polyrepo: false }),
      ...overrides,
    };
  }

  function pr(overrides: Partial<{ headRef: string; headSha: string | undefined }> = {}) {
    return { issueId: 'PAN-1', number: 7, headRef: BRANCH, headSha, repo: 'acme/demo', ...overrides };
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-4605-adopt-'));
    const origin = join(tempDir, 'origin.git');
    const author = join(tempDir, 'author');
    primary = join(tempDir, 'primary');
    canonical = join(primary, 'workspaces', 'feature-pan-1');
    gitCalls = [];

    git(tempDir, 'init', '--bare', '-b', 'main', origin);
    git(tempDir, 'clone', origin, author);
    git(author, 'config', 'user.email', 'test@example.com');
    git(author, 'config', 'user.name', 'Test User');
    git(author, 'checkout', '-b', 'main');
    commit(author, 'README.md', 'initial');
    git(author, 'push', 'origin', 'main');
    mainSha = git(author, 'rev-parse', 'HEAD');
    git(author, 'checkout', '-b', BRANCH);
    commit(author, 'feature.txt', 'feature work');
    git(author, 'push', 'origin', BRANCH);
    headSha = git(author, 'rev-parse', 'HEAD');

    git(tempDir, 'clone', origin, primary);
    git(primary, 'config', 'user.email', 'test@example.com');
    git(primary, 'config', 'user.name', 'Test User');

    createWorkspace = vi.fn<AdoptionDeps['createWorkspace']>(async () => {
      git(primary, 'worktree', 'add', canonical, BRANCH);
      return { success: true, workspacePath: canonical, errors: [] };
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('adopts the PR head into a new workspace when the local branch is absent', async () => {
    const outcome = await adoptPrWorkspace(pr(), deps());

    expect(outcome).toEqual({ adopted: true, workspacePath: canonical });
    expect(git(canonical, 'rev-parse', 'HEAD')).toBe(headSha);
    const journal = readPipelineJournal(canonical);
    expect(journal.at(-1)).toMatchObject({
      type: 'workspace.adopted', issueId: 'PAN-1', source: 'pr-adoption', data: { prNumber: 7, headSha, repo: 'acme/demo' },
    });
  });

  it('refuses when the branch is checked out in another worktree and never creates a workspace', async () => {
    const hoff = join(tempDir, 'hoff');
    git(primary, 'worktree', 'add', hoff, BRANCH);

    const outcome = await adoptPrWorkspace(pr(), deps());

    expect(outcome).toMatchObject({ adopted: false, reason: 'checked-out-elsewhere', worktreePath: hoff });
    expect(outcome.adopted === false && outcome.fix).toContain(`git -C ${primary} worktree remove ${hoff}`);
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('refuses when origin is not at the PR head and never creates a workspace', async () => {
    const outcome = await adoptPrWorkspace(pr({ headSha: mainSha }), deps());

    expect(outcome).toMatchObject({ adopted: false, reason: 'head-moved' });
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('fast-forwards a local branch that is an ancestor of the PR head, then adopts', async () => {
    git(primary, 'branch', '--no-track', BRANCH, mainSha);

    const outcome = await adoptPrWorkspace(pr(), deps());

    expect(outcome).toEqual({ adopted: true, workspacePath: canonical });
    expect(git(primary, 'rev-parse', `refs/heads/${BRANCH}`)).toBe(headSha);
    expect(git(canonical, 'rev-parse', 'HEAD')).toBe(headSha);
  });

  it('refuses a local branch with commits not in the PR and leaves it untouched', async () => {
    git(primary, 'checkout', '-b', BRANCH, mainSha);
    commit(primary, 'local.txt', 'unpushed local work');
    const localSha = git(primary, 'rev-parse', 'HEAD');
    git(primary, 'checkout', 'main');

    const outcome = await adoptPrWorkspace(pr(), deps());

    expect(outcome).toMatchObject({ adopted: false, reason: 'local-branch-diverged' });
    expect(outcome.adopted === false && outcome.fix).toContain(`git -C ${primary} log ${headSha}..${BRANCH}`);
    expect(git(primary, 'rev-parse', `refs/heads/${BRANCH}`)).toBe(localSha);
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('journals create-failed with the resume fix when createWorkspace fails after creating the worktree', async () => {
    createWorkspace.mockImplementation(async () => {
      git(primary, 'worktree', 'add', canonical, BRANCH);
      return { success: false, workspacePath: canonical, errors: ['docker setup failed'] };
    });

    const outcome = await adoptPrWorkspace(pr(), deps());

    expect(outcome).toMatchObject({ adopted: false, reason: 'create-failed', detail: 'docker setup failed', workspacePath: canonical });
    const last = readPipelineJournal(canonical).at(-1);
    expect(last).toMatchObject({ type: 'workspace.adoption-failed', source: 'pr-adoption', data: { prNumber: 7, reason: 'create-failed' } });
    expect(String(last?.data?.['fix'])).toContain('pan workspace create PAN-1');
  });

  it('refuses an unknown head and a non-pipeline branch before touching git', async () => {
    await expect(adoptPrWorkspace(pr({ headSha: undefined }), deps())).resolves.toMatchObject({ adopted: false, reason: 'head-unknown' });
    await expect(adoptPrWorkspace(pr({ headRef: 'strike/pan-1' }), deps())).resolves.toMatchObject({ adopted: false, reason: 'not-feature-branch' });
    expect(gitCalls).toEqual([]);
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('never pushes, forces, deletes a branch, or removes a worktree (NFR-1)', async () => {
    await expect(adoptPrWorkspace(pr({ headSha: mainSha }), deps())).resolves.toMatchObject({ reason: 'head-moved' });
    const hoff = join(tempDir, 'hoff-guard');
    git(primary, 'worktree', 'add', hoff, BRANCH);
    await expect(adoptPrWorkspace(pr(), deps())).resolves.toMatchObject({ reason: 'checked-out-elsewhere' });
    git(primary, 'worktree', 'remove', hoff);
    git(primary, 'branch', '-f', BRANCH, mainSha);
    await expect(adoptPrWorkspace(pr(), deps())).resolves.toMatchObject({ adopted: true });

    expect(gitCalls.some((args) => args[0] === 'update-ref')).toBe(true);
    for (const args of gitCalls) {
      expect(args).not.toContain('push');
      expect(args).not.toContain('--force');
      expect(args).not.toContain('-D');
      expect(args.slice(0, 2)).not.toEqual(['worktree', 'remove']);
    }
  });

  it('never suggests a destructive git command in any refusal fix', () => {
    const reasons: AdoptionRefusal[] = [
      'not-feature-branch', 'head-unknown', 'no-project', 'polyrepo', 'fetch-failed', 'head-moved',
      'checked-out-elsewhere', 'local-branch-diverged', 'create-failed', 'workspace-head-mismatch',
    ];
    for (const reason of reasons) {
      const fix = adoptionRefusalFix(reason, {
        issueId: 'PAN-1', prNumber: 7, projectPath: '/repo', headRef: 'strike/pan-1', headSha: 'a'.repeat(40),
        localSha: 'b'.repeat(40), detail: 'boom', worktreePath: '/home/me/hoff', workspacePath: '/repo/workspaces/feature-pan-1',
      });
      expect(fix, reason).not.toContain('branch -D');
      expect(fix, reason).not.toContain('-D ');
      expect(fix, reason).not.toContain('--force');
      expect(fix, reason).not.toContain('reset --hard');
    }
  });
});
