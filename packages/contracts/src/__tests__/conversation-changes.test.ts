import { describe, expect, it } from "vitest"
import type {
  ChangeCommit,
  ChangeScope,
  ChangedFile,
  ConversationChangeTotals,
  ConversationChanges,
  ProjectChanges,
  ProjectCommit,
  UncommittedFile,
} from "../index"

describe("conversation-changes contracts", () => {
  it("builds one value of each type through the package index", () => {
    const scope = "uncommitted" satisfies ChangeScope
    const file = { path: "src/app.ts", status: "M", additions: 3, deletions: 1 } satisfies ChangedFile
    const uncommitted = {
      path: "docs/shared.md",
      status: "M",
      additions: 4,
      deletions: 0,
      attribution: "lines",
      turnIds: ["msg_1"],
      otherLines: 2,
      otherConversations: [{ name: "fixture-2", title: "Second fixture conversation" }],
    } satisfies UncommittedFile
    const commit = {
      sha: "a".repeat(40),
      shortSha: "aaaaaaa",
      subject: "feat: add app entry",
      authoredAt: "2026-11-14T13:00:00.000Z",
      pushed: true,
      attribution: "tool-output",
      files: [file],
      turnId: "msg_2",
      by: { kind: "conversation", id: "fixture-1", title: "Fixture", isThisConversation: true },
    } satisfies ChangeCommit
    const totals = {
      files: 2,
      additions: 7,
      deletions: 1,
      uncommittedFiles: 1,
      commitsLocal: 1,
    } satisfies ConversationChangeTotals
    const changes = {
      conversation: "fixture-1",
      repoRoot: "/tmp/workflow-fixture",
      rootId: "project:workflow-fixture",
      branch: "main",
      scope,
      uncommitted: [uncommitted],
      commits: [commit],
      totals: { files: 2, additions: 7, deletions: 1, commitsPushed: 2, commitsLocal: 1, uncommittedFiles: 1 },
    } satisfies ConversationChanges
    const projectCommit = {
      sha: "b".repeat(40),
      shortSha: "bbbbbbb",
      subject: "chore: initial fixture",
      authoredAt: "2026-11-14T12:00:00.000Z",
      by: { kind: "unattributed" },
    } satisfies ProjectCommit
    const project = {
      projectKey: "workflow-fixture",
      branch: "main",
      commits: [projectCommit],
    } satisfies ProjectChanges

    expect(scope).toBe("uncommitted")
    expect(file.status).toBe("M")
    expect(uncommitted.attribution).toBe("lines")
    expect(commit.pushed).toBe(true)
    expect(totals.commitsLocal).toBe(1)
    expect(changes.totals.commitsPushed).toBe(2)
    expect(projectCommit.by.kind).toBe("unattributed")
    expect(project.commits).toHaveLength(1)
  })

  it("rejects an unknown change scope at compile time", () => {
    // @ts-expect-error 'other' is not a ChangeScope
    const bad: ChangeScope = "other"
    expect(bad).toBe("other")
  })
})
