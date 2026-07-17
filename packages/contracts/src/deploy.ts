import { Schema } from "effect"

export const DeployStalenessSnapshot = Schema.Struct({
  status: Schema.Literals(["fresh", "stale", "unknown"]),
  buildCommit: Schema.NullOr(Schema.String),
  originMainSha: Schema.NullOr(Schema.String),
  behindTotal: Schema.NullOr(Schema.Number),
  behindBuildInputs: Schema.NullOr(Schema.Number),
  originMainLastCommitAt: Schema.NullOr(Schema.Number),
  computedAt: Schema.Number,
  reason: Schema.optional(Schema.String),
})
export type DeployStalenessSnapshot = typeof DeployStalenessSnapshot.Type
