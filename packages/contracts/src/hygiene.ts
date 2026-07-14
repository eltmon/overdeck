import { Schema } from "effect"

export const HygieneFinding = Schema.Struct({
  id: Schema.String,
  summary: Schema.String,
  detail: Schema.optional(Schema.String),
  urgent: Schema.optional(Schema.Boolean),
})
export type HygieneFinding = typeof HygieneFinding.Type

export const HygienePullRequest = Schema.Struct({
  number: Schema.Number,
  branch: Schema.String,
  url: Schema.String,
  blocking: Schema.Literals(["review-pending", "test-pending", "failing-checks", "awaiting-UAT", "clean"]),
})

export const HygieneReport = Schema.Struct({
  generatedAt: Schema.String,
  root: Schema.String,
  needsAttention: Schema.Boolean,
  skipped: Schema.Array(Schema.String),
  push: Schema.Struct({ ahead: Schema.Number, commits: Schema.Array(Schema.String) }),
  tree: Schema.Struct({ files: Schema.Array(Schema.String), backups: Schema.Array(Schema.String) }),
  prs: Schema.Array(HygienePullRequest),
  agents: Schema.Struct({
    counts: Schema.Record(Schema.String, Schema.Number),
    problems: Schema.Array(HygieneFinding),
  }),
  sessions: Schema.Struct({ total: Schema.Number, zombies: Schema.Array(Schema.String) }),
  branches: Schema.Struct({ stale: Schema.Array(Schema.String) }),
  workspaces: Schema.Struct({ stale: Schema.Array(Schema.String) }),
  disk: Schema.Struct({ availableGb: Schema.Number, thresholdGb: Schema.Number, urgent: Schema.Boolean }),
  fixes: Schema.Struct({
    branchesDeleted: Schema.Array(Schema.String),
    workspacesRemoved: Schema.Array(Schema.Struct({ path: Schema.String, freedBytes: Schema.Number })),
    errors: Schema.Array(Schema.String),
  }),
})
export type HygieneReport = typeof HygieneReport.Type
