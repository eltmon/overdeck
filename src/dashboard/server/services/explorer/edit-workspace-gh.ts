/**
 * GitHub helpers for edit workspaces (PAN-5191 WI-F1).
 *
 * Every `gh` call is an argument vector through a `GhRunner`, never a shell
 * string, so an operator-typed title or body with `"` or `$(` reaches GitHub
 * as plain text (D-F4). The default runner is `runGh` with caller `'other'`;
 * tests inject a fake. `gh` failures propagate as thrown errors and callers
 * choose the HTTP code.
 *
 * `mergeVerdict` is the D-F7 table: whether the explorer may offer one-click
 * Merge, and the reason in words when it may not.
 */
import type { EditWorkspacePr } from '@overdeck/contracts';
import { runGh } from '../../../../lib/github-quota/run-gh.js';
import { EditWorkspaceError } from './edit-workspace-errors.js';

export type GhRunner = (args: string[], opts: { cwd?: string; timeout?: number }) => Promise<{ stdout: string }>;

export const defaultGh: GhRunner = (args, opts) => runGh(args, { caller: 'other', ...opts });

export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long to wait before re-reading a PR whose mergeability GitHub has not computed yet. */
export const UNKNOWN_REREAD_MS = 2000;

export type PrState = EditWorkspacePr['state'];

export interface BranchPr {
  number: number;
  url: string;
  state: PrState;
}

export interface PrMergeState {
  state: PrState;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  headRefOid: string;
}

export interface MergeVerdict {
  canMerge: boolean;
  reason: string | null;
}

function parsePrState(value: unknown): PrState {
  const state = String(value ?? '').toUpperCase();
  if (state === 'OPEN' || state === 'MERGED' || state === 'CLOSED') return state;
  throw new Error(`gh reported an unknown PR state: ${String(value)}`);
}

function lastLine(stdout: string): string {
  const lines = stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  return lines[lines.length - 1] ?? '';
}

/** The PR (any state) whose head is `branch`, or null when there is none. */
export async function findBranchPr(gh: GhRunner, repo: string, branch: string, cwd: string): Promise<BranchPr | null> {
  const { stdout } = await gh(
    ['pr', 'list', '--repo', repo, '--head', branch, '--state', 'all', '--json', 'number,url,state', '--limit', '1'],
    { cwd },
  );
  const rows = JSON.parse(stdout) as Array<{ number: number; url: string; state: string }>;
  const row = rows[0];
  if (!row) return null;
  return { number: Number(row.number), url: String(row.url), state: parsePrState(row.state) };
}

export async function readPrMergeState(gh: GhRunner, repo: string, number: number, cwd: string): Promise<PrMergeState> {
  const { stdout } = await gh(
    ['pr', 'view', String(number), '--repo', repo, '--json', 'mergeable,mergeStateStatus,headRefOid,state,isDraft'],
    { cwd },
  );
  const view = JSON.parse(stdout) as Record<string, unknown>;
  return {
    state: parsePrState(view.state),
    isDraft: view.isDraft === true,
    mergeable: String(view.mergeable ?? 'UNKNOWN'),
    mergeStateStatus: String(view.mergeStateStatus ?? 'UNKNOWN'),
    headRefOid: String(view.headRefOid ?? ''),
  };
}

export interface CreatePullRequestInput {
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  cwd: string;
}

/** Opens a PR and returns its URL and number, parsed from the last line `gh` prints. */
export async function createPullRequest(gh: GhRunner, input: CreatePullRequestInput): Promise<{ url: string; number: number }> {
  const args = [
    'pr', 'create',
    '--repo', input.repo,
    '--head', input.head,
    '--base', input.base,
    '--title', input.title,
    '--body', input.body,
  ];
  if (input.draft) args.push('--draft');
  const { stdout } = await gh(args, { cwd: input.cwd });
  const url = lastLine(stdout);
  const match = /\/pull\/(\d+)/.exec(url);
  if (!match) throw new EditWorkspaceError('PR_CREATE_FAILED', 502, `gh pr create did not print a PR URL: ${url || '(no output)'}`);
  return { url, number: Number(match[1]) };
}

export async function closePullRequest(gh: GhRunner, repo: string, number: number, cwd: string): Promise<void> {
  await gh(['pr', 'close', String(number), '--repo', repo], { cwd });
}

export interface CreateGitHubIssueInput {
  repo: string;
  title: string;
  body: string;
  cwd: string;
}

/** Creates an issue and returns its number and URL, parsed from the last line `gh` prints. */
export async function createGitHubIssue(gh: GhRunner, input: CreateGitHubIssueInput): Promise<{ number: number; url: string }> {
  const { stdout } = await gh(
    ['issue', 'create', '--repo', input.repo, '--title', input.title, '--body', input.body],
    { cwd: input.cwd },
  );
  const url = lastLine(stdout);
  const match = /\/issues\/(\d+)/.exec(url);
  if (!match) throw new EditWorkspaceError('ISSUE_CREATE_FAILED', 502, `gh issue create did not print an issue URL: ${url || '(no output)'}`);
  return { number: Number(match[1]), url };
}

const MERGEABLE_STATUSES = new Set(['CLEAN', 'UNSTABLE', 'HAS_HOOKS']);

/** The D-F7 merge verdict table. */
export function mergeVerdict(pr: Pick<PrMergeState, 'state' | 'isDraft' | 'mergeable' | 'mergeStateStatus'>): MergeVerdict {
  const { state, isDraft, mergeable, mergeStateStatus } = pr;
  if (state === 'OPEN' && !isDraft && mergeable === 'MERGEABLE' && MERGEABLE_STATUSES.has(mergeStateStatus)) {
    return { canMerge: true, reason: null };
  }
  let reason: string;
  if (state === 'MERGED') reason = 'Already merged';
  else if (state === 'CLOSED') reason = 'The PR is closed';
  else if (isDraft || mergeStateStatus === 'DRAFT') reason = 'The PR is a draft';
  else if (mergeable === 'CONFLICTING' || mergeStateStatus === 'DIRTY') reason = 'Conflicts with the base branch';
  else if (mergeStateStatus === 'BLOCKED') reason = 'Required checks or reviews are not met';
  else if (mergeStateStatus === 'BEHIND') reason = 'The branch is out of date with the base branch';
  else if (mergeable === 'UNKNOWN' || mergeStateStatus === 'UNKNOWN') reason = 'GitHub is still checking whether this PR can merge';
  else reason = `GitHub reports ${mergeStateStatus}`;
  return { canMerge: false, reason };
}

function isUnknown(state: PrMergeState): boolean {
  return state.mergeable === 'UNKNOWN' || state.mergeStateStatus === 'UNKNOWN';
}

/**
 * The branch's PR with its merge verdict, or null when the branch has none.
 * An open PR whose first read is UNKNOWN is read once more after 2,000 ms.
 * A merged or closed PR is not read with `gh pr view`.
 */
export async function readPrWithVerdict(
  gh: GhRunner,
  repo: string,
  branch: string,
  cwd: string,
  sleep: Sleep = defaultSleep,
): Promise<EditWorkspacePr | null> {
  const pr = await findBranchPr(gh, repo, branch, cwd);
  if (!pr) return null;
  if (pr.state !== 'OPEN') {
    const closed: PrMergeState = { state: pr.state, isDraft: false, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN', headRefOid: '' };
    return toEditWorkspacePr(pr, closed);
  }
  let view = await readPrMergeState(gh, repo, pr.number, cwd);
  if (isUnknown(view)) {
    await sleep(UNKNOWN_REREAD_MS);
    view = await readPrMergeState(gh, repo, pr.number, cwd);
  }
  return toEditWorkspacePr(pr, view);
}

function toEditWorkspacePr(pr: BranchPr, view: PrMergeState): EditWorkspacePr {
  return {
    url: pr.url,
    number: pr.number,
    state: view.state,
    isDraft: view.isDraft,
    mergeable: view.mergeable,
    mergeStateStatus: view.mergeStateStatus,
    headSha: view.headRefOid,
    ...mergeVerdict(view),
  };
}
