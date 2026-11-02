/**
 * Real wiring for the merge-train reconciler (PAN-1691). Lazy-loaded from
 * merge-train.ts only when the merge-train flag is on.
 *
 * PAN-4801: the post-merge path now reaches this on every merge, so each piece
 * of I/O is injectable (`TrainIo`) and unit-tested:
 *
 * - Siblings are the merged issue's own project's approved PRs. The cached
 *   `mergeable` flag is ignored: right after a merge GitHub still reports a
 *   just-conflicted sibling as mergeable, or has not computed it yet.
 * - A rebase runs only on a clean workspace on the feature branch whose HEAD
 *   is the PR head, and the push is leased on that head. A workspace in any
 *   other state, or a failed push, is an `error` outcome, never a `conflict`.
 * - A clean rebase that leaves the PR's own patch unchanged (`git patch-id
 *   --stable` of merge-base..head, before and after) carries the approval:
 *   an approval pinned to the new head is posted and journaled as
 *   `review.approval-carried`. CI still re-runs on the new head.
 * - Any other rebased sibling is re-reviewed through the guarded review door
 *   (its breaker and in-flight check), not a direct review spawn.
 * - A real conflict is left to the conflict-repair patrol (PAN-4384), which
 *   messages the issue's work agent once per conflicting head. Starting a
 *   second agent here would double that.
 */
import { exec, execFile } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { withDeftInstallLifted } from '../deft/lift.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import type { MergeGateResult } from './merge-gate.js';
import type { ApprovalCarry, ReconcileDeps, RebaseStatus } from './merge-train-reconciler.js';
import { appendPipelineEntry, type PipelineJournalEntry } from './pipeline-journal.js';
import type { PrFacts } from './pr-facts.js';
import type { PostReviewVerdictInput, PostReviewVerdictResult } from './pr-review-verdict.js';
import { getGuardedReviewRequester, type GuardedReviewRequester } from './request-review-pipeline.js';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const SHA_RE = /^[0-9a-f]{40}$/i;

export interface TrainIo {
  /** Run git in `cwd`; resolves stdout, rejects on a non-zero exit. */
  git: (cwd: string, args: string[]) => Promise<string>;
  /** The sibling's pipeline workspace, or null when it has none. */
  workspacePathFor: (issueId: string) => string | null;
  /** In-flight issues with an open PR in the merged issue's project. */
  listProjectIssuesWithPr: (mergedIssueId: string) => Promise<string[]>;
  evaluateGate: (issueId: string) => Promise<MergeGateResult>;
  reviewRequester: () => GuardedReviewRequester | null;
  /** `git patch-id --stable` of `git diff base head`; empty when the diff is. */
  patchId: (cwd: string, base: string, head: string) => Promise<string>;
  /** The PR's facts, read fresh (no cache). */
  readFacts: (issueId: string) => Promise<PrFacts>;
  postApproval: (input: PostReviewVerdictInput) => Promise<PostReviewVerdictResult>;
  journal: (workspacePath: string, entry: Omit<PipelineJournalEntry, 'at'>) => void;
  log: (line: string) => void;
  /** PAN-4820: run a git operation with a hidden Deft install lifted; `withDeftInstallLifted` by default. */
  withDeftInstallLifted: <T>(worktree: string, targetRef: string, fn: () => Promise<T>) => Promise<T>;
}

const defaultIo: TrainIo = {
  withDeftInstallLifted,
  git: async (cwd, args) => (await execFileAsync('git', args, { cwd, encoding: 'utf-8' })).stdout,
  workspacePathFor: (issueId) => {
    const project = resolveProjectFromIssueSync(issueId);
    if (!project) return null;
    const path = join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
    return existsSync(path) ? path : null;
  },
  listProjectIssuesWithPr: async (mergedIssueId) => {
    const project = resolveProjectFromIssueSync(mergedIssueId);
    if (!project) return [];
    const [{ getProjectSync }, { listInFlightIssuesWithPr }] = await Promise.all([
      import('../projects.js'),
      import('./merge-ready-set.js'),
    ]);
    const config = getProjectSync(project.projectKey);
    if (!config) return [];
    return listInFlightIssuesWithPr({ listProjects: async () => [{ key: project.projectKey, config }] });
  },
  evaluateGate: async (issueId) => (await import('./merge-gate.js')).evaluateIssueMergeGate(issueId),
  reviewRequester: getGuardedReviewRequester,
  patchId: async (cwd, base, head) => {
    if (!SHA_RE.test(base) || !SHA_RE.test(head)) throw new Error(`patch-id needs full shas, got ${base}..${head}`);
    const { stdout } = await execAsync(`git diff ${base} ${head} | git patch-id --stable`, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.trim().split(/\s+/)[0] ?? '';
  },
  readFacts: async (issueId) => (await import('./pr-facts.js')).getPrFacts(
    issueId,
    {},
    { preferBranch: `feature/${issueId.toLowerCase()}`, fresh: true },
  ),
  postApproval: async (input) => (await import('./pr-review-verdict.js')).postReviewVerdict(input),
  journal: (workspacePath, entry) => {
    appendPipelineEntry(workspacePath, entry);
  },
  log: (line) => console.log(line),
};

/**
 * A train sibling: merge-ready, or merge-ready in every respect the forge can
 * judge before it recomputes mergeability. It is open, not a draft, has no
 * changes requested and no failed UAT at its head, its checks are not red, and
 * its approval stands at its head. Pending or absent CI passes for a PR that is
 * not `mergeable: true`: GitHub builds no merge ref for a conflicting PR.
 */
function isTrainSibling({ ready, facts }: MergeGateResult): boolean {
  if (ready) return true;
  return facts.open
    && !facts.draft
    && !facts.changesRequested
    && facts.mergeable !== true
    && facts.checks !== 'red'
    && facts.approvedAtHead === true
    && facts.uatVerdict?.status !== 'failed';
}

export function buildRealReconcileDeps(overrides: Partial<TrainIo> = {}): ReconcileDeps {
  const io: TrainIo = { ...defaultIo, ...overrides };

  return {
    getReadySiblings: async (mergedIssueId) => {
      const merged = mergedIssueId.toUpperCase();
      const siblings: string[] = [];
      for (const issueId of await io.listProjectIssuesWithPr(merged)) {
        if (issueId.toUpperCase() === merged) continue;
        if (isTrainSibling(await io.evaluateGate(issueId))) siblings.push(issueId);
      }
      return siblings;
    },

    rebaseSibling: async (issueId): Promise<{ status: RebaseStatus; carry?: ApprovalCarry }> => {
      const ws = io.workspacePathFor(issueId);
      if (!ws) throw new Error(`no workspace for ${issueId}`);
      const git = (...args: string[]) => io.git(ws, args).then((out) => out.trim());
      const branch = `feature/${issueId.toLowerCase()}`;

      const current = await git('branch', '--show-current');
      if (current !== branch) throw new Error(`workspace is on ${current || 'a detached HEAD'}, not ${branch}`);
      if (await git('status', '--porcelain', '--untracked-files=no')) {
        throw new Error('workspace has uncommitted changes');
      }
      await git('fetch', 'origin', 'main', branch);
      const head = await git('rev-parse', 'HEAD');
      const prHead = await git('rev-parse', `refs/remotes/origin/${branch}`);
      if (head !== prHead) {
        throw new Error(`workspace HEAD ${head.slice(0, 12)} is not the PR head ${prHead.slice(0, 12)}`);
      }
      if (await git('rev-list', '--count', 'HEAD..origin/main') === '0') return { status: 'up-to-date' };
      const main = await git('rev-parse', 'origin/main');
      const forkPoint = await git('merge-base', 'HEAD', 'origin/main');
      const patchBefore = await io.patchId(ws, forkPoint, prHead);

      // PAN-4820: a Deft issue's hidden install is lifted for the rebase and
      // push (skip-worktree files abort a rebase; Deft's pre-push hook would
      // refuse the push). Without an install this runs the body alone.
      const newHead = await io.withDeftInstallLifted(ws, 'origin/main', async () => {
        try {
          await git('rebase', 'origin/main');
        } catch {
          await git('rebase', '--abort').catch(() => {});
          return null;
        }
        const rebasedHead = await git('rev-parse', 'HEAD');
        try {
          await git('push', `--force-with-lease=refs/heads/${branch}:${prHead}`, 'origin', `${rebasedHead}:refs/heads/${branch}`);
        } catch (err) {
          // Put the workspace back on the PR head it had, so the agent's next
          // push is not a surprise rebase.
          await git('reset', '--hard', prHead).catch(() => {});
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`push of the rebased ${branch} failed: ${message}`);
        }
        return rebasedHead;
      });
      if (newHead === null) return { status: 'conflict' };
      const patchAfter = await io.patchId(ws, main, newHead);
      return patchBefore && patchBefore === patchAfter
        ? { status: 'clean', carry: { from: prHead, to: newHead, patchId: patchAfter } }
        : { status: 'clean' };
    },

    carryApproval: async (issueId, carry: ApprovalCarry) => {
      const facts = await io.readFacts(issueId);
      if (facts.forge !== 'github') return false;
      if (facts.headSha?.toLowerCase() !== carry.to.toLowerCase()) return false;
      const result = await io.postApproval({
        issueId,
        verdict: 'approve',
        facts,
        reviewedHead: carry.to,
        pinHead: carry.to,
        body: [
          `Approval carried forward by the merge train (PAN-4801). Rebasing onto main moved the head from`,
          `${carry.from} to ${carry.to}, and this PR's own patch is unchanged (patch-id ${carry.patchId}).`,
          'CI re-runs on the new head.',
        ].join(' '),
      });
      if (!result.posted) {
        io.log(`[merge-train] ${issueId}: approval not carried to ${carry.to.slice(0, 12)}: ${result.reason}`);
        return false;
      }
      const ws = io.workspacePathFor(issueId);
      if (ws) {
        io.journal(ws, {
          type: 'review.approval-carried',
          issueId,
          source: 'merge-train',
          data: { from: carry.from, to: carry.to, patchId: carry.patchId, ...(result.via ? { via: result.via } : {}) },
        });
      }
      return true;
    },

    reDispatchVerification: async (issueId) => {
      const requester = io.reviewRequester();
      if (!requester) throw new Error('no guarded review door in this process');
      const outcome = await requester(issueId, {
        source: 'merge-train',
        message: 'the merge train rebased this branch onto main; re-review the new head',
      });
      if (outcome.kind !== 'started' && outcome.kind !== 'already-running') {
        io.log(`[merge-train] ${issueId}: re-review after the rebase not started (${outcome.kind})`);
      }
    },

    dispatchConflictResolver: async (issueId, mergedIssueId) => {
      io.log(
        `[merge-train] ${issueId} conflicts with main after ${mergedIssueId}; ` +
          'the conflict-repair patrol routes it to the work agent',
      );
    },
  };
}
