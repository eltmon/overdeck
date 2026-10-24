/**
 * PR workspace adoption (PAN-4605): create the pipeline workspace for a PR
 * that was opened outside one, at exactly the PR's head.
 *
 * A PR pushed from a supervised `pan handoff --cwd` worktree has no
 * `workspaces/feature-<issue>` worktree, so the review starter answered
 * `no-workspace` and the PR was never verified or reviewed. Adoption gives it
 * one — but only when that is provably safe:
 *
 *   - Only the exact pipeline branch `feature/<issue>` is adopted, and only at
 *     the head the PR reports (fetched and compared first).
 *   - Every check runs in git BEFORE `createWorkspace`. A mismatch refuses
 *     with an operator fix; nothing is ever cleaned up afterwards, because
 *     `removeWorktree`/`removeWorkspace` run `git branch -D`, which would
 *     destroy unpushed commits.
 *   - Adoption never pushes, forces, deletes a branch, or removes a worktree.
 *     A local branch that is not an ancestor of the PR head may hold unpushed
 *     work, so it is refused, not reset.
 *
 * The journal records only what happened inside a workspace: success appends
 * `workspace.adopted`; a failure that left a workspace behind appends
 * `workspace.adoption-failed` with the fix. A refusal with no workspace cannot
 * be journaled; the derived `pr-outside-pipeline` attention surfaces it.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { findBranchWorktree, pipelineBranchFor, prOutsidePipelineFix } from '../overdeck/pr-outside-pipeline.js';
import { findProjectByPath, resolveProjectFromIssueSync } from '../projects.js';
import { appendPipelineEntry } from './pipeline-journal.js';

const execFileAsync = promisify(execFile);

export interface AdoptablePr {
  /** Upper-case issue id. */
  readonly issueId: string;
  readonly number: number;
  readonly headRef: string;
  readonly headSha: string | undefined;
  /** owner/name, for messages. */
  readonly repo: string;
}

export type AdoptionRefusal =
  | 'not-feature-branch' | 'head-unknown' | 'no-project' | 'polyrepo'
  | 'fetch-failed' | 'head-moved' | 'checked-out-elsewhere'
  | 'local-branch-diverged' | 'create-failed' | 'workspace-head-mismatch';

export type AdoptionOutcome =
  | { readonly adopted: true; readonly workspacePath: string }
  | {
    readonly adopted: false;
    readonly reason: AdoptionRefusal;
    readonly detail: string;
    readonly fix: string;
    readonly worktreePath?: string;
    readonly workspacePath?: string;
  };

export interface AdoptionDeps {
  /** Runs git with argv; resolves trimmed stdout; rejects on non-zero exit. */
  git(args: readonly string[], cwd: string): Promise<string>;
  createWorkspace(issueId: string, project: { name: string; path: string }):
    Promise<{ success: boolean; workspacePath: string; errors: string[] }>;
  resolveProject(issueId: string):
    { projectPath: string; projectName: string; polyrepo: boolean } | null;
}

/** What a refusal's fix text may need. */
export interface AdoptionFixContext {
  readonly issueId: string;
  readonly prNumber: number;
  readonly projectPath: string;
  readonly headRef?: string;
  readonly headSha?: string;
  readonly localSha?: string;
  readonly detail?: string;
  readonly worktreePath?: string;
  readonly workspacePath?: string;
}

/** The operator-facing fix for one refusal. Never suggests a destructive git command. */
export function adoptionRefusalFix(reason: AdoptionRefusal, ctx: AdoptionFixContext): string {
  const id = ctx.issueId.toUpperCase();
  const branch = pipelineBranchFor(ctx.issueId);
  switch (reason) {
    case 'checked-out-elsewhere':
      return prOutsidePipelineFix({
        issueId: ctx.issueId, prNumber: ctx.prNumber, projectPath: ctx.projectPath,
        ...(ctx.worktreePath ? { worktreePath: ctx.worktreePath } : {}),
      });
    case 'head-moved':
      return `The PR head moved while Overdeck was adopting it. Run \`pan review request ${id}\` to adopt the current head.`;
    case 'local-branch-diverged':
      return `Local branch ${branch} (${(ctx.localSha ?? '').slice(0, 7)}) has commits that are not in PR #${ctx.prNumber}, and they may be unpushed work. Inspect them with \`git -C ${ctx.projectPath} log ${ctx.headSha ?? ''}..${branch}\`, then either push them to the PR or move them to another branch, so ${branch} matches the PR head. Then run \`pan review request ${id}\`.`;
    case 'fetch-failed':
      return `Overdeck could not fetch ${branch} from origin (${ctx.detail ?? 'unknown error'}). Check the remote, then run \`pan review request ${id}\`.`;
    case 'create-failed':
      return `Creating the pipeline workspace failed: ${ctx.detail ?? 'unknown error'}. Fix the cause, run \`pan workspace create ${id}\` (it resumes an unfinished setup), then run \`pan review request ${id}\`.`;
    case 'workspace-head-mismatch':
      return `The new workspace ${ctx.workspacePath ?? ''} is not at PR #${ctx.prNumber}'s head. Inspect it, then run \`pan review request ${id}\`.`;
    case 'polyrepo':
      return `Overdeck does not adopt polyrepo branches automatically. Run \`pan workspace create ${id}\`, then \`pan review request ${id}\`.`;
    case 'head-unknown':
      return `The webhook did not carry the PR head commit. Run \`pan review request ${id}\`.`;
    case 'no-project':
      return `No project in projects.yaml owns ${id}. Add it, then run \`pan review request ${id}\`.`;
    case 'not-feature-branch':
      return `Only ${branch} is reviewed by the pipeline; PR #${ctx.prNumber} is on ${ctx.headRef ?? 'another branch'}.`;
  }
}

async function defaultGit(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], { cwd });
  return stdout.trim();
}

async function defaultCreateWorkspace(
  issueId: string,
  project: { name: string; path: string },
): Promise<{ success: boolean; workspacePath: string; errors: string[] }> {
  const { createWorkspace } = await import('../workspace-manager.js');
  return createWorkspace({ projectConfig: findProjectByPath(project.path) ?? project, featureName: issueId.toLowerCase() });
}

function defaultResolveProject(issueId: string): { projectPath: string; projectName: string; polyrepo: boolean } | null {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return null;
  return {
    projectPath: resolved.projectPath,
    projectName: resolved.projectName,
    polyrepo: findProjectByPath(resolved.projectPath)?.workspace?.type === 'polyrepo',
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Create the pipeline workspace on an outside PR's head, or refuse with a fix.
 * Never throws for an expected refusal; an unexpected git error rejects.
 */
export async function adoptPrWorkspace(pr: AdoptablePr, deps: Partial<AdoptionDeps> = {}): Promise<AdoptionOutcome> {
  const git = deps.git ?? defaultGit;
  const createWorkspace = deps.createWorkspace ?? defaultCreateWorkspace;
  const resolveProject = deps.resolveProject ?? defaultResolveProject;

  const issueId = pr.issueId.toUpperCase();
  const lower = issueId.toLowerCase();
  const branch = pipelineBranchFor(issueId);

  let projectPath = '';
  const refuse = (
    reason: AdoptionRefusal,
    detail: string,
    extra: Omit<AdoptionFixContext, 'issueId' | 'prNumber' | 'projectPath'> = {},
  ): AdoptionOutcome => {
    const fix = adoptionRefusalFix(reason, {
      issueId, prNumber: pr.number, projectPath, headRef: pr.headRef, ...(pr.headSha ? { headSha: pr.headSha } : {}), detail, ...extra,
    });
    return {
      adopted: false, reason, detail, fix,
      ...(extra.worktreePath ? { worktreePath: extra.worktreePath } : {}),
      ...(extra.workspacePath ? { workspacePath: extra.workspacePath } : {}),
    };
  };
  const journalFailure = (workspacePath: string, outcome: AdoptionOutcome): AdoptionOutcome => {
    if (!outcome.adopted) {
      appendPipelineEntry(workspacePath, {
        type: 'workspace.adoption-failed',
        issueId,
        source: 'pr-adoption',
        data: { prNumber: pr.number, reason: outcome.reason, detail: outcome.detail, fix: outcome.fix },
      });
    }
    return outcome;
  };

  if (pr.headRef !== branch) return refuse('not-feature-branch', `PR #${pr.number} is on ${pr.headRef}, not ${branch}`);
  const headSha = pr.headSha;
  if (!headSha) return refuse('head-unknown', `PR #${pr.number} has no head commit in the payload`);

  const project = resolveProject(issueId);
  if (!project) return refuse('no-project', `no project owns ${issueId}`);
  projectPath = project.projectPath;
  if (project.polyrepo) return refuse('polyrepo', `${project.projectName} is a polyrepo project`);

  const canonical = join(projectPath, 'workspaces', `feature-${lower}`);

  try {
    await git(['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], projectPath);
  } catch (err) {
    return refuse('fetch-failed', errorMessage(err));
  }

  const remote = await git(['rev-parse', `refs/remotes/origin/${branch}`], projectPath);
  if (remote !== headSha) return refuse('head-moved', `origin/${branch} is at ${remote}, PR #${pr.number} reports ${headSha}`);

  await git(['worktree', 'prune'], projectPath);
  const worktreePath = findBranchWorktree(await git(['worktree', 'list', '--porcelain'], projectPath), branch, canonical);
  if (worktreePath) return refuse('checked-out-elsewhere', `${branch} is checked out in ${worktreePath}`, { worktreePath });

  const localSha = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], projectPath).catch(() => null);
  if (!localSha) {
    await git(['branch', '--track', branch, `refs/remotes/origin/${branch}`], projectPath);
  } else if (localSha !== headSha) {
    const isAncestor = await git(['merge-base', '--is-ancestor', localSha, headSha], projectPath).then(() => true, () => false);
    if (!isAncestor) {
      return refuse('local-branch-diverged', `local ${branch} at ${localSha} is not an ancestor of ${headSha}`, { localSha });
    }
    // Compare-and-swap: only moves the ref if it is still at localSha.
    await git(['update-ref', `refs/heads/${branch}`, headSha, localSha], projectPath);
  }

  const created = await createWorkspace(issueId, { name: project.projectName, path: projectPath });
  const workspacePath = created.workspacePath || canonical;
  if (!created.success) {
    const leftBehind = existsSync(join(workspacePath, '.git'));
    const outcome = refuse('create-failed', created.errors.join('; '), leftBehind ? { workspacePath } : {});
    return leftBehind ? journalFailure(workspacePath, outcome) : outcome;
  }

  const head = await git(['rev-parse', 'HEAD'], workspacePath);
  const current = await git(['branch', '--show-current'], workspacePath);
  if (head !== headSha || current !== branch) {
    return journalFailure(workspacePath, refuse(
      'workspace-head-mismatch',
      `workspace is on ${current || '(detached)'} at ${head}, PR #${pr.number} is ${branch} at ${headSha}`,
      { workspacePath },
    ));
  }

  appendPipelineEntry(workspacePath, {
    type: 'workspace.adopted',
    issueId,
    source: 'pr-adoption',
    data: { prNumber: pr.number, headSha, repo: pr.repo },
  });
  return { adopted: true, workspacePath };
}
