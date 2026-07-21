import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { Command } from 'commander';

import { clearWorkspaceStuck, getReviewStatusSync, setReviewStatusSync, type ReviewStatus } from '../../lib/review-status.js';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';

const execFileAsync = promisify(execFile);

export interface StrikeReadyDependencies {
  cwd: string;
  now: () => string;
  resolveProject: typeof resolveProjectFromIssueSync;
  getStatus: typeof getReviewStatusSync;
  setStatus: typeof setReviewStatusSync;
  clearStuck: typeof clearWorkspaceStuck;
  git: (args: string[], cwd: string) => Promise<string>;
}

const defaultDependencies: StrikeReadyDependencies = {
  cwd: process.cwd(),
  now: () => new Date().toISOString(),
  resolveProject: resolveProjectFromIssueSync,
  getStatus: getReviewStatusSync,
  setStatus: setReviewStatusSync,
  clearStuck: clearWorkspaceStuck,
  git: async (args, cwd) => (await execFileAsync('git', args, { cwd })).stdout.trim(),
};

export async function strikeReadyCommand(
  rawIssueId: string,
  overrides: Partial<StrikeReadyDependencies> = {},
): Promise<ReviewStatus> {
  const deps = { ...defaultDependencies, ...overrides };
  const issueId = rawIssueId.toUpperCase();
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(issueId)) {
    throw new Error(`Invalid issue ID "${rawIssueId}".`);
  }

  const project = deps.resolveProject(issueId);
  if (!project) throw new Error(`No configured project resolves ${issueId}.`);

  const expectedWorkspace = resolve(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}-strike`);
  const workspace = resolve(await deps.git(['rev-parse', '--show-toplevel'], deps.cwd));
  if (workspace !== expectedWorkspace) {
    throw new Error(`Strike readiness must be signaled from ${expectedWorkspace}; current worktree is ${workspace}.`);
  }

  const expectedBranch = `strike/${issueId.toLowerCase()}`;
  const branch = await deps.git(['branch', '--show-current'], workspace);
  if (branch !== expectedBranch) {
    throw new Error(`Strike readiness requires branch ${expectedBranch}; current branch is ${branch || 'detached HEAD'}.`);
  }

  const registered = await deps.git(['worktree', 'list', '--porcelain'], project.projectPath);
  const registration = registered.split('\n\n').find((entry) => entry.includes(`worktree ${workspace}\n`));
  if (!registration?.includes(`branch refs/heads/${expectedBranch}`)) {
    throw new Error(`Current directory is not the registered ${expectedBranch} strike worktree.`);
  }

  const dirty = await deps.git(['status', '--porcelain'], workspace);
  if (dirty) throw new Error('Strike worktree has uncommitted changes; commit them before signaling readiness.');

  await deps.git(['fetch', 'origin', expectedBranch], workspace);
  const localHead = await deps.git(['rev-parse', 'HEAD'], workspace);
  const remoteHead = await deps.git(['rev-parse', `origin/${expectedBranch}`], workspace);
  if (localHead !== remoteHead) {
    throw new Error(`Strike branch is not fully pushed: local HEAD ${localHead} differs from origin ${remoteHead}.`);
  }

  const previous = deps.getStatus(issueId);
  if (previous?.strikeReadyHead === remoteHead) {
    if (previous.strikeLandingState !== 'needs_you') return previous;
    deps.clearStuck(issueId);
    return deps.setStatus(issueId, {
      strikeLandingState: 'ready',
      strikeRecoveryCount: 0,
      strikeLandingAttempts: previous.strikeLandingAttempts ?? [],
    });
  }

  const readyAt = deps.now();
  return deps.setStatus(issueId, {
    strikeReadyHead: remoteHead,
    strikeReadyAt: readyAt,
    strikeLandingState: 'ready',
    strikeRecoveryCount: 0,
    strikeLandingAttempts: previous?.strikeLandingAttempts ?? [],
  });
}

export function registerStrikeReadyCommand(program: Command): void {
  program.command('strike-ready <id>')
    .description('Persist readiness for a pushed strike branch so Deacon can land it')
    .action(async (id: string) => {
      const status = await strikeReadyCommand(id);
      console.log(`Strike ${id.toUpperCase()} ready at ${status.strikeReadyHead}.`);
    });
}
