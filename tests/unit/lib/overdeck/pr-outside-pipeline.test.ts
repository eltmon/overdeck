import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/lib/pipeline-notifier.js', () => ({ notifyPipeline: vi.fn() }));

import { appendPipelineEntry } from '../../../../src/lib/cloister/pipeline-journal.js';
import {
  findBranchWorktree,
  pipelineBranchFor,
  prOutsidePipelineFix,
  readPrOutsidePipeline,
} from '../../../../src/lib/overdeck/pr-outside-pipeline.js';

const PORCELAIN = [
  'worktree /repo',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /repo/workspaces/feature-pan-1',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/feature/pan-1',
  '',
  'worktree /home/me/Projects/hoff-pan-1',
  'HEAD 3333333333333333333333333333333333333333',
  'branch refs/heads/feature/pan-1',
  '',
  'worktree /gone/hoff-pan-2',
  'HEAD 4444444444444444444444444444444444444444',
  'branch refs/heads/feature/pan-2',
  'prunable gitdir file points to non-existent location',
  '',
].join('\n');

describe('pipelineBranchFor', () => {
  it('lower-cases the issue id into the feature branch', () => {
    expect(pipelineBranchFor('PAN-1')).toBe('feature/pan-1');
  });
});

describe('findBranchWorktree', () => {
  it('returns the handoff worktree that holds the branch, skipping the excluded canonical path', () => {
    expect(findBranchWorktree(PORCELAIN, 'feature/pan-1', '/repo/workspaces/feature-pan-1')).toBe('/home/me/Projects/hoff-pan-1');
  });

  it('returns null when only the excluded canonical path holds the branch', () => {
    const onlyCanonical = PORCELAIN.split('\n\n').filter((block) => !block.includes('hoff-pan-1')).join('\n\n');
    expect(findBranchWorktree(onlyCanonical, 'feature/pan-1', '/repo/workspaces/feature-pan-1')).toBeNull();
  });

  it('skips a prunable entry', () => {
    expect(findBranchWorktree(PORCELAIN, 'feature/pan-2', '/repo/workspaces/feature-pan-2')).toBeNull();
  });

  it('returns null when no worktree holds the branch', () => {
    expect(findBranchWorktree(PORCELAIN, 'feature/pan-9', '/repo/workspaces/feature-pan-9')).toBeNull();
  });
});

describe('prOutsidePipelineFix', () => {
  it('names the blocking worktree and the exact commands when a worktree holds the branch', () => {
    const fix = prOutsidePipelineFix({ issueId: 'pan-1', prNumber: 7, projectPath: '/repo', worktreePath: '/home/me/hoff' });
    expect(fix).toContain('PR #7 (feature/pan-1) is checked out in /home/me/hoff');
    expect(fix).toContain('`git -C /repo worktree remove /home/me/hoff`');
    expect(fix).toContain('`pan review request PAN-1`');
  });

  it('tells the operator to adopt the branch when no worktree holds it', () => {
    const fix = prOutsidePipelineFix({ issueId: 'PAN-1', prNumber: 7, projectPath: '/repo' });
    expect(fix).toContain('PR #7 (feature/pan-1) was opened outside a pipeline workspace');
    expect(fix).toContain('`pan review request PAN-1`');
    expect(fix).not.toContain('worktree remove');
  });
});

describe('readPrOutsidePipeline', () => {
  let projectPath: string;
  const noRegistry = { registryPath: () => null, remoteMetadata: () => null };

  function makeWorkspace(): string {
    const ws = join(projectPath, 'workspaces', 'feature-pan-1');
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, '.git'), 'gitdir: /repo/.git/worktrees/feature-pan-1\n');
    return ws;
  }

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'pan-4605-outside-pr-'));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('returns a detail naming the worktree that holds the branch when no workspace exists', async () => {
    const porcelain = `worktree ${projectPath}\nHEAD abc\nbranch refs/heads/main\n\nworktree /home/me/hoff\nHEAD def\nbranch refs/heads/feature/pan-1\n`;
    const detail = await readPrOutsidePipeline({
      issueId: 'PAN-1', projectPath, prNumber: 7, listWorktrees: async () => porcelain, deps: noRegistry,
    });
    expect(detail).toEqual({
      prNumber: 7,
      worktreePath: '/home/me/hoff',
      fix: prOutsidePipelineFix({ issueId: 'PAN-1', prNumber: 7, projectPath, worktreePath: '/home/me/hoff' }),
    });
  });

  it('returns the journaled fix when the workspace journal ends with workspace.adoption-failed', async () => {
    const ws = makeWorkspace();
    appendPipelineEntry(ws, { type: 'review.requested', issueId: 'PAN-1' });
    appendPipelineEntry(ws, { type: 'workspace.adoption-failed', issueId: 'PAN-1', data: { reason: 'head-moved', fix: 'journaled fix' } });
    const listWorktrees = vi.fn(async () => '');

    const detail = await readPrOutsidePipeline({ issueId: 'PAN-1', projectPath, prNumber: 7, listWorktrees, deps: noRegistry });

    expect(detail).toEqual({ prNumber: 7, fix: 'journaled fix' });
    expect(listWorktrees).not.toHaveBeenCalled();
  });

  it('returns undefined when the workspace journal ends with review.requested', async () => {
    const ws = makeWorkspace();
    appendPipelineEntry(ws, { type: 'workspace.adoption-failed', issueId: 'PAN-1', data: { fix: 'old' } });
    appendPipelineEntry(ws, { type: 'review.requested', issueId: 'PAN-1' });

    const detail = await readPrOutsidePipeline({ issueId: 'PAN-1', projectPath, prNumber: 7, listWorktrees: async () => '', deps: noRegistry });

    expect(detail).toBeUndefined();
  });

  it('resolves to a detail without worktreePath when listWorktrees rejects', async () => {
    const detail = await readPrOutsidePipeline({
      issueId: 'PAN-1', projectPath, prNumber: 7, listWorktrees: async () => { throw new Error('git failed'); }, deps: noRegistry,
    });
    expect(detail).toEqual({ prNumber: 7, fix: prOutsidePipelineFix({ issueId: 'PAN-1', prNumber: 7, projectPath }) });
  });

  it('does not let a stale registry row pointing at a missing directory hide the PR', async () => {
    const detail = await readPrOutsidePipeline({
      issueId: 'PAN-1',
      projectPath,
      prNumber: 7,
      listWorktrees: async () => '',
      deps: { registryPath: () => join(projectPath, 'reaped-workspace'), remoteMetadata: () => null },
    });
    expect(detail).toEqual({ prNumber: 7, fix: prOutsidePipelineFix({ issueId: 'PAN-1', prNumber: 7, projectPath }) });
  });

  it('returns undefined for a remote workspace', async () => {
    const detail = await readPrOutsidePipeline({
      issueId: 'PAN-1', projectPath, prNumber: 7, listWorktrees: async () => '',
      deps: { registryPath: () => null, remoteMetadata: () => ({ vmName: 'vm-1' }) },
    });
    expect(detail).toBeUndefined();
  });
});
