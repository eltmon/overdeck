// Derived issue state (PAN-3917 FR-6).
//
// Overdeck stores no status it can derive. An issue's pipeline state is
// computed at read time from the tracker, the plan home, the PR, checks, git,
// and the terminal backend. This module holds the vocabulary the server
// derives and the dashboard renders; the derivation itself lives in
// `src/dashboard/server/services/derived-issue-state.ts`.

import { Schema } from "effect"

/**
 * The nine pipeline states of the FR-6 table. They are mutually exclusive and
 * resolved in this precedence (highest first), because the underlying facts
 * overlap:
 *
 *   closed > merged > ready > changes-requested > in-review > working >
 *   parked > planned > backlog
 */
export const IssueState = Schema.Literals([
  "backlog",
  "parked",
  "planned",
  "working",
  "in-review",
  "changes-requested",
  "ready",
  "merged",
  "closed",
])
export type IssueState = typeof IssueState.Type

/** Something the operator has to look at. Orthogonal to `IssueState`. */
export const IssueAttention = Schema.Literals([
  /** An unanswered AskUserQuestion or a permission prompt (a `blocked` pane). */ "needs-you",
  /** Idle for N minutes with unpushed commits. */ "stuck",
  /** 429 or provider-failure text in a pane. */ "api-error",
])
export type IssueAttention = typeof IssueAttention.Type

/** Latest review decision on the PR, as the forge reports it. */
export const PrReviewState = Schema.Literals([
  "approved",
  "changes-requested",
  "review-requested",
  "commented",
  "none",
])
export type PrReviewState = typeof PrReviewState.Type

/** Aggregate check-run conclusion for the PR head. */
export const PrChecksState = Schema.Literals(["green", "red", "pending"])
export type PrChecksState = typeof PrChecksState.Type

/** The pull request (or merge request) backing an issue. */
export const DerivedPrState = Schema.Struct({
  url: Schema.String,
  number: Schema.Number,
  reviewState: PrReviewState,
  checks: PrChecksState,
  /** Forge mergeability. `null` when the forge has not computed it yet. */
  mergeable: Schema.NullOr(Schema.Boolean),
})
export type DerivedPrState = typeof DerivedPrState.Type

/** The issue's feature branch as git reports it. */
export const DerivedBranchState = Schema.Struct({
  name: Schema.String,
  aheadOfMain: Schema.Number,
  pushed: Schema.Boolean,
})
export type DerivedBranchState = typeof DerivedBranchState.Type

/** Everything the dashboard needs to render an issue's pipeline position. */
export const DerivedIssueState = Schema.Struct({
  issueId: Schema.String,
  state: IssueState,
  attention: Schema.optional(IssueAttention),
  pr: Schema.optional(DerivedPrState),
  branch: Schema.optional(DerivedBranchState),
})
export type DerivedIssueState = typeof DerivedIssueState.Type

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
