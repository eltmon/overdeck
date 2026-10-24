/**
 * Adopt-then-review (PAN-4605): start the review pipeline for a PR that was
 * opened outside a pipeline workspace.
 *
 * Two callers reach a PR with no workspace: the GitHub webhook (the review
 * starter answered `no-workspace`) and `pan review request` (the operator ran
 * the fix after removing the other worktree). Both go through here:
 *
 *   - `adoptPrAndStartReview` adopts the branch (`pr-workspace-adoption.ts`)
 *     and starts the review. One adoption per issue at a time; a second caller
 *     awaits the first one's promise. A refusal is announced once on the
 *     activity stream with the exact fix. A review that does not start after a
 *     successful adoption is journaled as `workspace.adoption-failed`, so the
 *     derived `pr-outside-pipeline` attention stays on until a later
 *     `review.requested` supersedes it. Nothing here ever throws to the caller.
 *   - `findOpenPipelinePr` is a fresh, branch-targeted `gh pr list --head`,
 *     never the cached repo listing, and reports a forge failure as an error,
 *     never as "no PR".
 *   - `answerMissingWorkspace` is the `/request` route's pre-guard: with no
 *     workspace and an open pipeline-branch PR it starts adoption in the
 *     background and answers 202.
 */
import type { IssueState } from '@overdeck/contracts';

import { runGh } from '../github-quota/run-gh.js';
import { pipelineBranchFor } from '../overdeck/pr-outside-pipeline.js';
import { inferProjectForge } from '../project-repos.js';
import { findProjectByPath, resolveProjectFromIssueSync } from '../projects.js';
import { surfaceIssueFeedbackNeedsYou } from './feedback-target.js';
import { appendPipelineEntry } from './pipeline-journal.js';
import { adoptPrWorkspace, type AdoptablePr, type AdoptionOutcome } from './pr-workspace-adoption.js';
import { getRequestReviewStarter, type RequestReviewSource, type RequestReviewStarter } from './request-review-pipeline.js';

export type AdoptAndReviewOutcome =
  | { kind: 'started'; workspacePath: string }
  | { kind: 'refused'; adoption: Extract<AdoptionOutcome, { adopted: false }> }
  | { kind: 'review-not-started'; workspacePath: string; reason: string }
  | { kind: 'no-starter'; workspacePath: string };

export interface AdoptAndReviewOptions {
  source: RequestReviewSource;
  /** Default `adoptPrWorkspace`. */
  adopt?: (pr: AdoptablePr) => Promise<AdoptionOutcome>;
  /** Default `getRequestReviewStarter()`; null means no starter is registered in this process. */
  startReview?: RequestReviewStarter | null;
  /** Default `surfaceIssueFeedbackNeedsYou`. */
  announce?: (issueId: string, reason: string, details: Record<string, unknown>) => Promise<void>;
  /** Default `appendPipelineEntry`. */
  journal?: typeof appendPipelineEntry;
}

const inFlight = new Map<string, Promise<AdoptAndReviewOutcome>>();

/** Test hook: forget every in-flight adoption. */
export function __resetPrAdoptionForTests(): void {
  inFlight.clear();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Adopt an outside PR into a pipeline workspace and start its review. Coalesced per issue; never throws. */
export function adoptPrAndStartReview(pr: AdoptablePr, options: AdoptAndReviewOptions): Promise<AdoptAndReviewOutcome> {
  const key = pr.issueId.toUpperCase();
  const existing = inFlight.get(key);
  if (existing) return existing;
  const run = runAdoptAndReview({ ...pr, issueId: key }, options).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, run);
  return run;
}

async function runAdoptAndReview(pr: AdoptablePr, options: AdoptAndReviewOptions): Promise<AdoptAndReviewOutcome> {
  const adopt = options.adopt ?? ((target: AdoptablePr) => adoptPrWorkspace(target));
  const announce = options.announce ?? surfaceIssueFeedbackNeedsYou;
  const journal = options.journal ?? appendPipelineEntry;
  const issueId = pr.issueId;

  const announceSafely = async (reason: string, details: Record<string, unknown>): Promise<void> => {
    try {
      await announce(issueId, reason, details);
    } catch (err) {
      console.warn(`[pr-adoption] Could not announce ${issueId}: ${errorMessage(err)}`);
    }
  };

  let adoption: AdoptionOutcome;
  try {
    adoption = await adopt(pr);
  } catch (err) {
    const message = errorMessage(err);
    await announceSafely(`PR #${pr.number} adoption failed: ${message}`, { prNumber: pr.number, reason: 'create-failed' });
    return {
      kind: 'refused',
      adoption: {
        adopted: false,
        reason: 'create-failed',
        detail: message,
        fix: `PR #${pr.number} adoption failed: ${message}. Run \`pan review request ${issueId}\` to retry.`,
      },
    };
  }

  if (!adoption.adopted) {
    await announceSafely(`PR #${pr.number} was not reviewed: ${adoption.fix}`, {
      prNumber: pr.number,
      reason: adoption.reason,
      ...(adoption.worktreePath ? { worktreePath: adoption.worktreePath } : {}),
    });
    return { kind: 'refused', adoption };
  }

  const { workspacePath } = adoption;
  const recordNotStarted = async (reason: 'no-starter' | 'review-not-started', detail: string, fix: string): Promise<void> => {
    journal(workspacePath, {
      type: 'workspace.adoption-failed',
      issueId,
      source: 'pr-adoption',
      data: { prNumber: pr.number, reason, detail, fix },
    });
    await announceSafely(fix, { prNumber: pr.number, reason });
  };

  const startReview = options.startReview === undefined ? getRequestReviewStarter() : options.startReview;
  if (!startReview) {
    await recordNotStarted('no-starter', 'no review starter is registered in this process', `Run pan review request ${issueId}.`);
    return { kind: 'no-starter', workspacePath };
  }

  try {
    const answer = await startReview(issueId, {
      note: `Adopted PR #${pr.number} (${pr.headRef}) into a pipeline workspace — starting verification`,
      source: options.source,
    });
    if (answer.started) return { kind: 'started', workspacePath };
    const detail = 'error' in answer && answer.error ? `${answer.reason}: ${answer.error}` : answer.reason;
    await recordNotStarted(
      'review-not-started',
      detail,
      `PR #${pr.number} was adopted into ${workspacePath} but review did not start (${detail}). Resolve that, then run \`pan review request ${issueId}\`.`,
    );
    return { kind: 'review-not-started', workspacePath, reason: detail };
  } catch (err) {
    const detail = errorMessage(err);
    await recordNotStarted(
      'review-not-started',
      detail,
      `PR #${pr.number} was adopted into ${workspacePath} but review did not start (${detail}). Resolve that, then run \`pan review request ${issueId}\`.`,
    );
    return { kind: 'review-not-started', workspacePath, reason: detail };
  }
}

export type OpenPipelinePrLookup =
  | { kind: 'found'; pr: AdoptablePr }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

interface GhPrRow {
  number?: unknown;
  url?: unknown;
  headRefName?: unknown;
  headRefOid?: unknown;
  isDraft?: unknown;
}

async function defaultGh(args: string[], cwd: string): Promise<string> {
  const { stdout } = await runGh(args, { caller: 'pr-adoption', cwd, timeout: 20_000 });
  return stdout;
}

/** A fresh, branch-targeted read of the open PR on the pipeline branch. Never cached. */
export async function findOpenPipelinePr(
  issueId: string,
  deps: { projectPath?: string; gh?: (args: string[], cwd: string) => Promise<string> } = {},
): Promise<OpenPipelinePrLookup> {
  const upper = issueId.toUpperCase();
  const branch = pipelineBranchFor(upper);
  const projectPath = deps.projectPath ?? resolveProjectFromIssueSync(upper)?.projectPath;
  if (!projectPath) return { kind: 'none' };
  const project = findProjectByPath(projectPath);
  if (project && inferProjectForge(project) === 'gitlab') return { kind: 'none' };

  let rows: GhPrRow[];
  try {
    const stdout = await (deps.gh ?? defaultGh)(
      ['pr', 'list', '--head', branch, '--state', 'open', '--limit', '10', '--json', 'number,url,headRefName,headRefOid,isDraft'],
      projectPath,
    );
    const parsed: unknown = JSON.parse(stdout || '[]');
    rows = Array.isArray(parsed) ? (parsed as GhPrRow[]) : [];
  } catch (err) {
    return { kind: 'error', message: errorMessage(err) };
  }

  const row = rows.find((candidate) =>
    candidate.headRefName === branch && candidate.isDraft !== true && typeof candidate.number === 'number');
  if (!row) return { kind: 'none' };
  const url = typeof row.url === 'string' ? row.url : '';
  const repo = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url)?.[1] ?? '';
  return {
    kind: 'found',
    pr: {
      issueId: upper,
      number: row.number as number,
      headRef: branch,
      headSha: typeof row.headRefOid === 'string' && row.headRefOid ? row.headRefOid : undefined,
      repo,
    },
  };
}

/**
 * The `/request` route's pre-guard answer (D7): null means "continue with the normal
 * route". Non-null means the issue has no workspace and this is the whole answer.
 */
export async function answerMissingWorkspace(
  issueId: string,
  source: RequestReviewSource,
  context: { derivedState: IssueState; workspaceExists: boolean },
  deps: { findPr?: typeof findOpenPipelinePr; adoptAndReview?: typeof adoptPrAndStartReview } = {},
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  if (context.workspaceExists || context.derivedState === 'merged') return null;
  const id = issueId.toUpperCase();
  const branch = pipelineBranchFor(id);

  const lookup = await (deps.findPr ?? findOpenPipelinePr)(id);
  if (lookup.kind === 'error') {
    return {
      status: 503,
      body: {
        success: false,
        error: `Could not read open pull requests for ${branch} from GitHub: ${lookup.message}`,
        hint: `Retry pan review request ${id} once GitHub answers.`,
      },
    };
  }
  if (lookup.kind === 'none') {
    return {
      status: 400,
      body: {
        success: false,
        error: 'Workspace does not exist',
        hint: `No pipeline workspace and no open ${branch} pull request for ${id}. Run pan start ${id} or pan workspace create ${id}.`,
      },
    };
  }

  void (deps.adoptAndReview ?? adoptPrAndStartReview)(lookup.pr, { source }).catch(() => {});
  return {
    status: 202,
    body: {
      success: true,
      queued: true,
      adopting: true,
      message: `No pipeline workspace for ${id}: adopting PR #${lookup.pr.number} (${branch}) into one — verification starts when it is ready. If adoption is refused, the reason appears under Needs you and in pan show ${id}.`,
    },
  };
}
