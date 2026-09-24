import { describe, expect, it } from "vitest"

import { INITIAL_READ_MODEL_STATE, applyEvent } from "./event-reducers"
import { resolveEffectivePullRequest, type PullRequestLink, type PullRequestSnapshot } from "./pull-request-links"

function snapshot(state: PullRequestSnapshot["state"], updatedAt: string | null = null): PullRequestSnapshot {
  return {
    state,
    isDraft: false,
    title: "t",
    headBranch: null,
    baseBranch: null,
    reviewState: "none",
    checks: "pending",
    mergeable: null,
    additions: null,
    deletions: null,
    changedFiles: null,
    author: null,
    updatedAt,
    mergedAt: null,
    closedAt: null,
    syncedAt: "2026-09-20T00:00:00Z",
  }
}

function link(number: number, overrides: Partial<PullRequestLink> = {}): PullRequestLink {
  return {
    host: "github.com",
    repository: "eltmon/overdeck",
    number,
    url: `https://github.com/eltmon/overdeck/pull/${number}`,
    source: "branch",
    linkedAt: "2026-09-20T00:00:00Z",
    dismissedAt: null,
    snapshot: snapshot("open"),
    ...overrides,
  }
}

describe("resolveEffectivePullRequest", () => {
  it("returns null for no links", () => {
    expect(resolveEffectivePullRequest([])).toBeNull()
  })

  it("returns the only branch link", () => {
    expect(resolveEffectivePullRequest([link(1)])?.number).toBe(1)
  })

  it("prefers an explicit link over a branch link", () => {
    const explicit = link(2, { source: "manual", snapshot: snapshot("merged") })
    expect(resolveEffectivePullRequest([link(1), explicit])?.number).toBe(2)
  })

  it("prefers open over merged among explicit links", () => {
    const merged = link(1, { source: "agent", snapshot: snapshot("merged", "2026-09-22T00:00:00Z") })
    const open = link(2, { source: "created", snapshot: snapshot("open", "2026-09-19T00:00:00Z") })
    expect(resolveEffectivePullRequest([merged, open])?.number).toBe(2)
  })

  it("prefers the most recently updated among equals", () => {
    const older = link(1, { snapshot: snapshot("open", "2026-09-19T00:00:00Z") })
    const newer = link(2, { snapshot: snapshot("open", "2026-09-21T00:00:00Z") })
    expect(resolveEffectivePullRequest([older, newer])?.number).toBe(2)
  })

  it("ignores dismissed links", () => {
    expect(resolveEffectivePullRequest([link(1, { dismissedAt: "2026-09-20T01:00:00Z" })])).toBeNull()
  })

  it("falls back to a live branch link when the explicit link is dismissed", () => {
    const dismissedExplicit = link(2, { source: "manual", dismissedAt: "2026-09-20T01:00:00Z" })
    expect(resolveEffectivePullRequest([dismissedExplicit, link(1)])?.number).toBe(1)
  })
})

describe("conversation.pull_requests_changed reducer", () => {
  it("bumps conversationsListRevision", () => {
    const initial = INITIAL_READ_MODEL_STATE
    const next = applyEvent(initial, {
      type: "conversation.pull_requests_changed",
      sequence: 1,
      timestamp: "2026-09-20T00:00:00Z",
      payload: { conversationName: "c", effective: link(1) },
    })
    expect(next.conversationsListRevision).toBe(initial.conversationsListRevision + 1)
  })
})
