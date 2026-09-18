/**
 * Derived issue state for the CLI (PAN-3917 FR-6).
 *
 * Overdeck stores no issue status. The nine states below are computed at read
 * time from the owners of the facts: the tracker owns whether the issue is
 * open, the forge owns the PR and its reviews and checks, git owns the branch,
 * and the terminal backend owns whether a pane is live.
 *
 * `deriveIssueState` is pure so it can be tested without a network; the
 * gatherers around it are the ones that shell out. W6 writes the server's own
 * `derived-issue-state.ts` against the same table — when it lands, this file is
 * the one to delete.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The nine states of the FR-6 table, in pipeline order. */
export type DerivedIssueState =
  | 'backlog'
  | 'parked'
  | 'planned'
  | 'working'
  | 'in review'
  | 'changes requested'
  | 'ready'
  | 'merged'
  | 'closed';

/** What is wrong right now, if anything. Never stored. */
export type IssueAttention = 'needs you' | 'stuck' | 'api error';

/** Everything the derivation needs, each field owned by the system that answers it. */
export interface IssueStateInputs {
  /** Tracker: the issue is open. */
  readonly issueOpen: boolean;
  /** Tracker label `parked`, or the issue is listed in `.pan/parked.md`. */
  readonly parked: boolean;
  /** A spec file exists for the issue on main or on the feature branch. */
  readonly specExists: boolean;
  /** Forge: the pull request for the feature branch, if there is one. */
  readonly pr: PullRequestFacts | null;
  /** git: the feature branch has commits main does not. */
  readonly branchAheadOfMain: boolean;
  /** Terminal backend: a live pane whose `issue` token is this issue. */
  readonly livePanes: number;
  /** Terminal backend: a live pane whose `role` token is `review`. */
  readonly liveReviewPanes?: number;
}

export interface PullRequestFacts {
  readonly state: 'OPEN' | 'CLOSED' | 'MERGED';
  readonly isDraft: boolean;
  /** `gh pr view --json reviewDecision`. */
  readonly reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  /** `gh pr view --json mergeable` — MERGEABLE, CONFLICTING, UNKNOWN. */
  readonly mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  /** Every required check has concluded successfully. */
  readonly checksGreen: boolean;
}

/**
 * The FR-6 table, top rule first. Order matters: a merged PR outranks a live
 * pane, and a closed issue outranks everything.
 */
export function deriveIssueState(inputs: IssueStateInputs): DerivedIssueState {
  if (!inputs.issueOpen) return 'closed';
  if (inputs.pr?.state === 'MERGED') return 'merged';

  if (inputs.pr?.state === 'OPEN') {
    if (inputs.pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes requested';
    if (inputs.pr.reviewDecision === 'APPROVED' && inputs.pr.checksGreen && inputs.pr.mergeable === 'MERGEABLE') {
      return 'ready';
    }
    if (!inputs.pr.isDraft || (inputs.liveReviewPanes ?? 0) > 0) return 'in review';
  }

  if (inputs.livePanes > 0 || inputs.branchAheadOfMain) return 'working';
  if (inputs.parked) return 'parked';
  if (inputs.specExists) return 'planned';
  return 'backlog';
}

export interface IssueAttentionInputs {
  /** A pane is waiting on the operator (a blocked agent, an unanswered question). */
  readonly blockedPanes: number;
  /** Idle with unpushed work — deacon-lite's stuck rule. */
  readonly idleWithUnpushedWork: boolean;
  /** Repeated provider failure text in a pane. */
  readonly apiError: boolean;
}

/** The three attention states of FR-6, most urgent first. */
export function deriveIssueAttention(inputs: IssueAttentionInputs): IssueAttention | null {
  if (inputs.apiError) return 'api error';
  if (inputs.blockedPanes > 0) return 'needs you';
  if (inputs.idleWithUnpushedWork) return 'stuck';
  return null;
}

// ─── Gatherers ────────────────────────────────────────────────────────────────

/**
 * `gh pr view` for the issue's feature branch. Returns null when there is no
 * PR, or when `gh` cannot answer (no remote, not authenticated) — the caller
 * then derives from git and the backend alone.
 */
export async function readPullRequestFacts(cwd: string, sourceBranch: string): Promise<PullRequestFacts | null> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'view', sourceBranch, '--json', 'state,isDraft,reviewDecision,mergeable,statusCheckRollup'],
      { cwd, timeout: 20_000 },
    );
    const raw = JSON.parse(stdout) as {
      state?: string;
      isDraft?: boolean;
      reviewDecision?: string;
      mergeable?: string;
      statusCheckRollup?: { conclusion?: string | null; state?: string | null }[] | null;
    };
    const rollup = raw.statusCheckRollup ?? [];
    return {
      state: (raw.state as PullRequestFacts['state']) ?? 'OPEN',
      isDraft: raw.isDraft === true,
      reviewDecision: (raw.reviewDecision as PullRequestFacts['reviewDecision']) || null,
      mergeable: (raw.mergeable as PullRequestFacts['mergeable']) ?? 'UNKNOWN',
      checksGreen: rollup.length > 0
        && rollup.every((check) => (check.conclusion ?? check.state ?? '').toUpperCase() === 'SUCCESS'),
    };
  } catch {
    return null;
  }
}

/** git: does the feature branch carry commits `main` does not? */
export async function branchIsAheadOfMain(
  cwd: string,
  sourceBranch: string,
  targetBranch = 'main',
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-list', '--count', `origin/${targetBranch}..${sourceBranch}`],
      { cwd, timeout: 15_000 },
    );
    return (Number.parseInt(stdout.trim(), 10) || 0) > 0;
  } catch {
    return false;
  }
}

// ─── The CLI's gatherer ───────────────────────────────────────────────────────

export interface IssueStateSnapshot {
  readonly issueId: string;
  readonly state: DerivedIssueState;
  readonly attention: IssueAttention | null;
  readonly prUrl?: string;
  readonly workspacePath: string | null;
}

/** The issue is listed in the project's `.pan/parked.md`. */
async function isParked(planHome: string, issueId: string): Promise<boolean> {
  const { readFile } = await import('node:fs/promises');
  try {
    const parked = await readFile(`${planHome}/.pan/parked.md`, 'utf-8');
    return parked.toUpperCase().includes(issueId.toUpperCase());
  } catch {
    return false;
  }
}

/** Tracker: is the issue still open? Unknown trackers are treated as open. */
async function issueIsOpen(issueId: string): Promise<boolean> {
  const { resolveGitHubIssueSync } = await import('../tracker-utils.js');
  const gh = resolveGitHubIssueSync(issueId);
  if (!gh.isGitHub) return true;
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['issue', 'view', String(gh.number), '--repo', `${gh.owner}/${gh.repo}`, '--json', 'state', '--jq', '.state'],
      { timeout: 20_000 },
    );
    return stdout.trim().toUpperCase() !== 'CLOSED';
  } catch {
    return true;
  }
}

/**
 * Gather every input and derive the issue's state. Everything here is a read of
 * an owner — the tracker, the forge, git, and agent liveness — and nothing is
 * written back.
 */
export async function gatherIssueState(issueId: string): Promise<IssueStateSnapshot> {
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { resolveProjectFromIssueSync } = await import('../projects.js');
  const { resolvePlanHome } = await import('../pan-dir/paths.js');
  const { findPlanSync } = await import('../xbrief/io.js');
  const { isAliveSync, isIdle } = await import('../agents/liveness.js');

  const upper = issueId.toUpperCase();
  const resolved = resolveProjectFromIssueSync(upper);
  const workspacePath = resolved
    ? join(resolved.projectPath, 'workspaces', `feature-${upper.toLowerCase()}`)
    : null;
  const hasWorkspace = !!workspacePath && existsSync(workspacePath);
  const sourceBranch = `feature/${upper.toLowerCase()}`;
  const gitCwd = hasWorkspace ? workspacePath! : resolved?.projectPath ?? process.cwd();

  const agentId = `agent-${upper.toLowerCase()}`;
  const alive = isAliveSync(agentId).alive;

  const [issueOpen, parked, pr, branchAheadOfMain] = await Promise.all([
    issueIsOpen(upper),
    isParked(resolvePlanHome(resolved?.projectPath ?? gitCwd), upper),
    readPullRequestFacts(gitCwd, sourceBranch),
    branchIsAheadOfMain(gitCwd, sourceBranch),
  ]);

  const state = deriveIssueState({
    issueOpen,
    parked,
    specExists: hasWorkspace ? !!findPlanSync(workspacePath!) : false,
    pr,
    branchAheadOfMain,
    livePanes: alive ? 1 : 0,
  });

  const attention = deriveIssueAttention({
    blockedPanes: 0,
    idleWithUnpushedWork: alive && isIdle(agentId) && branchAheadOfMain,
    apiError: false,
  });

  return { issueId: upper, state, attention, workspacePath: hasWorkspace ? workspacePath : null };
}
