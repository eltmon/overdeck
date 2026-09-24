// Pull requests linked to conversations (PAN-3822).
//
// A conversation holds zero or more PR links keyed by host/repository/number.
// Each link records why it exists (`source`) and the last known forge state
// (`snapshot`). The server's pull-request sync sweep writes `branch` links by
// matching a PR's head branch to the conversation's branch; explicit sources
// (`manual`, `agent`, `created`) override them. The row and header badge render
// the one effective link chosen by `resolveEffectivePullRequest`.

import { Schema } from "effect"

import { PrChecksState, PrReviewState } from "./derived-issue-state"

export const PullRequestLinkSource = Schema.Literals(["manual", "agent", "created", "branch"])
export type PullRequestLinkSource = typeof PullRequestLinkSource.Type

export const PullRequestKey = Schema.Struct({
  host: Schema.String,
  repository: Schema.String,
  number: Schema.Number,
})
export type PullRequestKey = typeof PullRequestKey.Type

export const PullRequestState = Schema.Literals(["open", "merged", "closed"])
export type PullRequestState = typeof PullRequestState.Type

export const PullRequestSnapshot = Schema.Struct({
  state: PullRequestState,
  isDraft: Schema.Boolean,
  title: Schema.String,
  headBranch: Schema.NullOr(Schema.String),
  baseBranch: Schema.NullOr(Schema.String),
  reviewState: PrReviewState,
  checks: PrChecksState,
  mergeable: Schema.NullOr(Schema.Boolean),
  additions: Schema.NullOr(Schema.Number),
  deletions: Schema.NullOr(Schema.Number),
  changedFiles: Schema.NullOr(Schema.Number),
  author: Schema.NullOr(Schema.String),
  /** Forge timestamp, ISO. */
  updatedAt: Schema.NullOr(Schema.String),
  mergedAt: Schema.NullOr(Schema.String),
  closedAt: Schema.NullOr(Schema.String),
  /** When Overdeck last read the PR, ISO. */
  syncedAt: Schema.String,
})
export type PullRequestSnapshot = typeof PullRequestSnapshot.Type

export const PullRequestLink = Schema.Struct({
  ...PullRequestKey.fields,
  url: Schema.String,
  source: PullRequestLinkSource,
  linkedAt: Schema.String,
  dismissedAt: Schema.NullOr(Schema.String),
  snapshot: Schema.NullOr(PullRequestSnapshot),
})
export type PullRequestLink = typeof PullRequestLink.Type

export const ConversationPullRequests = Schema.Struct({
  links: Schema.Array(PullRequestLink),
  effective: Schema.NullOr(PullRequestLink),
})
export type ConversationPullRequests = typeof ConversationPullRequests.Type

/** One conversation linked to a PR — the reverse index (PR → conversations). */
export const PullRequestLinkedConversation = Schema.Struct({
  /** The /conv/<id> number. */
  id: Schema.Number,
  name: Schema.String,
  title: Schema.NullOr(Schema.String),
  source: PullRequestLinkSource,
  linkedAt: Schema.String,
})
export type PullRequestLinkedConversation = typeof PullRequestLinkedConversation.Type

/** One live link across all conversations, for the Pull requests list. */
export const PullRequestLinkListing = Schema.Struct({
  ...PullRequestLink.fields,
  conversationId: Schema.Number,
  conversationName: Schema.String,
  conversationTitle: Schema.NullOr(Schema.String),
  /** The conversation's effective project, or null when none resolves. */
  projectKey: Schema.NullOr(Schema.String),
})
export type PullRequestLinkListing = typeof PullRequestLinkListing.Type

function stateRank(link: PullRequestLink): number {
  if (link.snapshot === null) return 1
  if (link.snapshot.state === "open") return 0
  if (link.snapshot.state === "merged") return 2
  return 3
}

function recency(link: PullRequestLink): number {
  return Date.parse(link.snapshot?.updatedAt ?? link.linkedAt) || 0
}

/**
 * The one PR shown on a conversation: explicit links before branch links,
 * open before merged before closed, most recently updated among equals.
 * Dismissed links never count.
 */
export function resolveEffectivePullRequest(links: readonly PullRequestLink[]): PullRequestLink | null {
  const live = links.filter((link) => link.dismissedAt === null)
  const explicit = live.filter((link) => link.source !== "branch")
  const pool = explicit.length > 0 ? explicit : live
  if (pool.length === 0) return null
  return [...pool].sort((a, b) => stateRank(a) - stateRank(b) || recency(b) - recency(a))[0] ?? null
}
