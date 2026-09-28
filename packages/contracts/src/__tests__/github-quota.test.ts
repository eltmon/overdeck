import { describe, expect, it } from "vitest"
import { Schema } from "effect"

import { INITIAL_READ_MODEL_STATE, applyEvent, syncSnapshot } from "../event-reducers"
import { GitHubQuotaSnapshot, NON_ESSENTIAL_GITHUB_CALLERS } from "../github-quota"
import { DomainEvent } from "../events"

// PAN-4264: the GitHub quota snapshot is a plain-replace read-model field.

function quota(remaining: number): GitHubQuotaSnapshot {
  return {
    generatedAt: "2026-09-27T15:00:00.000Z",
    login: "octo-login",
    callers: [{ caller: "pipeline-membership", graphql: { points: 12, calls: 4 }, rest: { points: 0, calls: 0 }, estimated: false }],
    samples: [{ pool: "user", bucket: "graphql", ts: "2026-09-27T14:59:00.000Z", remaining, limit: 5000 }],
    pauses: [],
    ownUsageLow: true,
    unattributed: 0,
    refusals: { primary: 0, secondary: 0 },
  }
}

describe("github_quota.changed (PAN-4264)", () => {
  it("replaces the read-model quota snapshot", () => {
    expect(INITIAL_READ_MODEL_STATE.githubQuota).toBeNull()
    const first = applyEvent(INITIAL_READ_MODEL_STATE, {
      type: "github_quota.changed", sequence: 3, timestamp: "t", payload: quota(4000),
    })
    expect(first.githubQuota).toEqual(quota(4000))
    const second = applyEvent(first, {
      type: "github_quota.changed", sequence: 4, timestamp: "t", payload: quota(3000),
    })
    expect(second.githubQuota).toEqual(quota(3000))
    expect(second.sequence).toBe(4)
  })

  it("decodes as a domain event and survives a snapshot sync", () => {
    const event = { type: "github_quota.changed", sequence: 1, timestamp: "t", payload: quota(10) }
    expect(Schema.decodeUnknownSync(DomainEvent)(event)).toEqual(event)
    const synced = syncSnapshot(INITIAL_READ_MODEL_STATE, {
      sequence: 1, agents: [], specialists: [], githubQuota: quota(10), timestamp: "t",
    } as never)
    expect(synced.githubQuota).toEqual(quota(10))
  })

  it("keeps only read-model pollers non-essential", () => {
    expect([...NON_ESSENTIAL_GITHUB_CALLERS].sort()).toEqual(
      ["ci-repair", "close-out", "issue-poller", "pipeline-membership", "pr-cache", "pr-sync"],
    )
  })
})
