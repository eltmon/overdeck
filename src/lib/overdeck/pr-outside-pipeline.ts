/**
 * Outside-PR detection (PAN-4605): an open PR on an issue's pipeline branch
 * that no pipeline workspace ever picked up.
 *
 * The webhook starts the review pipeline only for an issue that has a
 * `workspaces/feature-<issue>` worktree. A PR pushed from anywhere else — a
 * supervised `pan handoff --cwd` worktree is the usual case — answered
 * `no-workspace` and was silently dropped: never verified, never reviewed,
 * and nobody told. These helpers turn that situation into a derived read
 * (`prOutsidePipeline` on the issue's derived state) plus the exact operator
 * fix, so the dashboard and `pan show` can surface it.
 *
 * Contract: everything here is read-only and never throws into a loader.
 * Keep the imports light — no workspace-manager, no dashboard code — so the
 * derived-state loader and the adoption core can both import it.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { DerivedPrOutsidePipeline } from '@overdeck/contracts';

import { lastPipelineEntry } from '../cloister/pipeline-journal.js';
import { loadWorkspaceMetadata } from '../remote/workspace-metadata.js';
import { getWorkspaceForIssue } from '../workspaces/resolver.js';

/** Test seam for `pipelineWorkspacePath`. */
export interface PipelineWorkspaceDeps {
  /** The registry row path for an issue, or null. Default: `getWorkspaceForIssue(ID)?.path`. */
  readonly registryPath?: (issueId: string) => string | null;
  /** Non-null when the issue's workspace is remote. Default: `loadWorkspaceMetadata(ID)` with `location: 'remote'`. */
  readonly remoteMetadata?: (issueId: string) => { vmName?: string } | null;
}

/** The canonical pipeline branch for an issue. */
export function pipelineBranchFor(issueId: string): string {
  return `feature/${issueId.toLowerCase()}`;
}

/**
 * The path of a worktree (other than `excludePath`) that has `branch` checked out,
 * parsed from `git worktree list --porcelain` output; null when none. Pure.
 * Skips entries marked `prunable`.
 */
export function findBranchWorktree(porcelain: string, branch: string, excludePath: string): string | null {
  const wantedRef = `refs/heads/${branch}`;
  const excluded = resolve(excludePath);
  for (const block of porcelain.split(/\n\s*\n/)) {
    let path: string | null = null;
    let ref: string | null = null;
    let prunable = false;
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length).trim();
      else if (line.startsWith('branch ')) ref = line.slice('branch '.length).trim();
      else if (line === 'prunable' || line.startsWith('prunable ')) prunable = true;
    }
    if (!path || ref !== wantedRef || prunable) continue;
    if (resolve(path) === excluded) continue;
    return path;
  }
  return null;
}

/** Operator-facing fix paragraph. Pure. */
export function prOutsidePipelineFix(input: {
  issueId: string;
  prNumber: number;
  projectPath: string;
  worktreePath?: string;
}): string {
  const id = input.issueId.toUpperCase();
  const branch = pipelineBranchFor(input.issueId);
  if (input.worktreePath) {
    return `PR #${input.prNumber} (${branch}) is checked out in ${input.worktreePath}, so Overdeck cannot create the pipeline workspace and nothing has verified or reviewed it. When the session working there is finished, run \`git -C ${input.projectPath} worktree remove ${input.worktreePath}\`, then \`pan review request ${id}\`.`;
  }
  return `PR #${input.prNumber} (${branch}) was opened outside a pipeline workspace and nothing has verified or reviewed it. Run \`pan review request ${id}\` to adopt the branch into a workspace and start verification.`;
}

function defaultRegistryPath(issueId: string): string | null {
  return getWorkspaceForIssue(issueId)?.path ?? null;
}

function defaultRemoteMetadata(issueId: string): { vmName?: string } | null {
  const metadata = loadWorkspaceMetadata(issueId);
  return metadata?.location === 'remote' ? { vmName: metadata.vmName } : null;
}

/**
 * The issue's usable pipeline workspace path, or null. Candidates, in order: the
 * registry row path and `<projectPath>/workspaces/feature-<lower>`; the first
 * candidate containing `.git` wins — a registry row whose directory is missing
 * or has no `.git` is NOT a workspace. A remote workspace returns the sentinel
 * `remote:<vmName>` so callers treat it as present without reading a journal.
 */
export function pipelineWorkspacePath(
  issueId: string,
  projectPath: string,
  deps: PipelineWorkspaceDeps = {},
): string | null {
  const upper = issueId.toUpperCase();
  const remote = (deps.remoteMetadata ?? defaultRemoteMetadata)(upper);
  if (remote) return `remote:${remote.vmName ?? ''}`;

  const candidates = [
    (deps.registryPath ?? defaultRegistryPath)(upper),
    join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, '.git'))) return candidate;
  }
  return null;
}

/**
 * The derived detail for one issue, or undefined. `listWorktrees` is called lazily
 * (only when the attention qualifies) and is memoized by the caller per loader run.
 */
export async function readPrOutsidePipeline(input: {
  issueId: string;
  projectPath: string;
  prNumber: number;
  listWorktrees: () => Promise<string>;
  deps?: PipelineWorkspaceDeps;
}): Promise<DerivedPrOutsidePipeline | undefined> {
  const { issueId, projectPath, prNumber } = input;
  try {
    const workspace = pipelineWorkspacePath(issueId, projectPath, input.deps);
    if (workspace?.startsWith('remote:')) return undefined;
    if (workspace) {
      const entry = lastPipelineEntry(workspace);
      if (entry?.type !== 'workspace.adoption-failed') return undefined;
      return { prNumber, fix: String(entry.data?.['fix'] ?? prOutsidePipelineFix({ issueId, prNumber, projectPath })) };
    }

    const worktreePath = findBranchWorktree(
      await input.listWorktrees(),
      pipelineBranchFor(issueId),
      join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`),
    );
    return {
      prNumber,
      fix: prOutsidePipelineFix({ issueId, prNumber, projectPath, ...(worktreePath ? { worktreePath } : {}) }),
      ...(worktreePath ? { worktreePath } : {}),
    };
  } catch {
    return { prNumber, fix: prOutsidePipelineFix({ issueId, prNumber, projectPath }) };
  }
}
