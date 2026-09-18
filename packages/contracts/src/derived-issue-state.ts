// Derived issue state (PAN-3917 FR-6).
//
// Overdeck stores no status it can derive. An issue's pipeline state is
// computed at read time from the tracker, the plan home, the PR, checks, git,
// and the terminal backend. This module holds the vocabulary the server
// derives and the dashboard renders; the derivation itself lives in
// `src/dashboard/server/services/derived-issue-state.ts`.

/**
 * The nine pipeline states of the FR-6 table. They are mutually exclusive and
 * resolved in this precedence (highest first), because the underlying facts
 * overlap:
 *
 *   closed > merged > ready > changes-requested > in-review > working >
 *   parked > planned > backlog
 */
export type IssueState =
  | "backlog"
  | "parked"
  | "planned"
  | "working"
  | "in-review"
  | "changes-requested"
  | "ready"
  | "merged"
  | "closed"

/** Something the operator has to look at. Orthogonal to `IssueState`. */
export type IssueAttention =
  | /** An unanswered AskUserQuestion or a permission prompt (a `blocked` pane). */ "needs-you"
  | /** Idle for N minutes with unpushed commits. */ "stuck"
  | /** 429 or provider-failure text in a pane. */ "api-error"

/** Latest review decision on the PR, as the forge reports it. */
export type PrReviewState =
  | "approved"
  | "changes-requested"
  | "review-requested"
  | "commented"
  | "none"

/** Aggregate check-run conclusion for the PR head. */
export type PrChecksState = "green" | "red" | "pending"

/** The pull request (or merge request) backing an issue. */
export interface DerivedPrState {
  readonly url: string
  readonly number: number
  readonly reviewState: PrReviewState
  readonly checks: PrChecksState
  /** Forge mergeability. `null` when the forge has not computed it yet. */
  readonly mergeable: boolean | null
}

/** The issue's feature branch as git reports it. */
export interface DerivedBranchState {
  readonly name: string
  readonly aheadOfMain: number
  readonly pushed: boolean
}

/** Everything the dashboard needs to render an issue's pipeline position. */
export interface DerivedIssueState {
  readonly issueId: string
  readonly state: IssueState
  readonly attention?: IssueAttention
  readonly pr?: DerivedPrState
  readonly branch?: DerivedBranchState
}

export const ISSUE_STATES: readonly IssueState[] = [
  "backlog",
  "parked",
  "planned",
  "working",
  "in-review",
  "changes-requested",
  "ready",
  "merged",
  "closed",
]

/** Highest precedence first — the order `deriveIssueState` resolves in. */
export const ISSUE_STATE_PRECEDENCE: readonly IssueState[] = [
  "closed",
  "merged",
  "ready",
  "changes-requested",
  "in-review",
  "working",
  "parked",
  "planned",
  "backlog",
]

export const ISSUE_ATTENTIONS: readonly IssueAttention[] = ["needs-you", "stuck", "api-error"]

export function isIssueState(value: unknown): value is IssueState {
  return typeof value === "string" && (ISSUE_STATES as readonly string[]).includes(value)
}

export function isIssueAttention(value: unknown): value is IssueAttention {
  return typeof value === "string" && (ISSUE_ATTENTIONS as readonly string[]).includes(value)
}
