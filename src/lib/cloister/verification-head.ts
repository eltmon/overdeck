/**
 * PAN-4527: the one "is this the same head" rule for verification.
 *
 * Review verification runs in the agent's own workspace and merges the target
 * branch in before its gates run, so the workspace HEAD moves for two
 * different reasons while a worker is alive:
 *
 * - **synced** — the worker's own target-branch sync: a merge commit whose
 *   first parent is the launch head and whose second parent is on
 *   `origin/<target>` (or a fast-forward of the launch head onto it). The
 *   worker is still verifying the head it launched on.
 * - **moved** — the agent committed. The worker's verdict is not for this head.
 *
 * The supervisor's join/adopt decision, the runner's CI-verdict head, and the
 * runner's pre-gate stop check all classify through this module; nothing else
 * may compare a verification launch head with a later head. See
 * docs/PIPELINE-GATES.md, "Verification gate".
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { parseCompositeSnapshot } from '../git-utils.js';
import { resolveWorkspaceRepoRoots, type WorkspaceRepoRoot } from '../project-repos.js';

const execFileAsync = promisify(execFile);

export type VerificationHeadRelation = 'same' | 'synced' | 'moved' | 'unknown';

type HeadRoot = Pick<WorkspaceRepoRoot, 'repoKey' | 'dir' | 'targetBranch'>;

/** True when a later head is still the head a verification launched on. */
export function isSameVerificationHead(relation: VerificationHeadRelation): boolean {
  return relation === 'same' || relation === 'synced';
}

async function isAncestor(dir: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: dir, encoding: 'utf-8', timeout: 10_000 });
    return true;
  } catch (err) {
    if ((err as { code?: unknown }).code === 1) return false;
    throw err;
  }
}

async function classifyRepoHead(root: HeadRoot, launchSha: string, currentSha: string): Promise<VerificationHeadRelation> {
  if (launchSha === currentSha) return 'same';
  try {
    const target = `origin/${root.targetBranch}`;
    const { stdout } = await execFileAsync('git', ['rev-list', '--parents', '-n', '1', currentSha], { cwd: root.dir, encoding: 'utf-8', timeout: 10_000 });
    const [, firstParent, secondParent, ...more] = stdout.trim().split(/\s+/);
    if (more.length === 0 && firstParent === launchSha && secondParent && await isAncestor(root.dir, secondParent, target)) {
      return 'synced';
    }
    // `git merge` fast-forwards a branch that has no commits of its own.
    if (await isAncestor(root.dir, launchSha, currentSha) && await isAncestor(root.dir, currentSha, target)) {
      return 'synced';
    }
    return 'moved';
  } catch {
    return 'unknown';
  }
}

/** Per-repo shas of a head anchor: a plain sha belongs to the first root. */
function anchorHeads(anchor: string, roots: HeadRoot[]): Map<string, string> {
  const composite = parseCompositeSnapshot(anchor);
  if (composite.size > 0) return composite;
  return roots[0] ? new Map([[roots[0].repoKey, anchor.trim()]]) : new Map();
}

/**
 * Classify `current` against the head a verification launched on. An
 * unreadable side, or a different set of repos, is `unknown`; callers treat
 * `unknown` like `moved`.
 */
export async function classifyVerificationHead(
  roots: HeadRoot[],
  launch: string | undefined,
  current: string | undefined,
): Promise<VerificationHeadRelation> {
  if (!launch || !current) return 'unknown';
  if (launch === current) return 'same';
  const launchHeads = anchorHeads(launch, roots);
  const currentHeads = anchorHeads(current, roots);
  if (launchHeads.size === 0 || launchHeads.size !== currentHeads.size) return 'unknown';
  let relation: VerificationHeadRelation = 'same';
  for (const [repoKey, launchSha] of launchHeads) {
    const root = roots.find((candidate) => candidate.repoKey === repoKey);
    const currentSha = currentHeads.get(repoKey);
    if (!root || !currentSha) return 'unknown';
    const repoRelation = await classifyRepoHead(root, launchSha, currentSha);
    if (repoRelation === 'moved' || repoRelation === 'unknown') return repoRelation;
    if (repoRelation === 'synced') relation = 'synced';
  }
  return relation;
}

/** {@link classifyVerificationHead} over the issue's workspace repo roots. */
export function classifyWorkspaceVerificationHead(
  issueId: string,
  workspacePath: string,
  launch: string | undefined,
  current: string | undefined,
): Promise<VerificationHeadRelation> {
  return classifyVerificationHead(resolveWorkspaceRepoRoots(issueId, workspacePath), launch, current);
}
