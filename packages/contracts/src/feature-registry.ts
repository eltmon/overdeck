import { Schema } from "effect"

export const FeatureRegistryStatus = Schema.Literals([
  "active",
  "archived",
  "merged",
  "deferred",
])
export type FeatureRegistryStatus = typeof FeatureRegistryStatus.Type

export const FeatureRegistryEntry = Schema.Struct({
  featureId: Schema.String,
  featureName: Schema.String,
  description: Schema.NullOr(Schema.String),
  owningWorkspaceId: Schema.NullOr(Schema.String),
  owningIssueId: Schema.NullOr(Schema.String),
  owningAgentId: Schema.NullOr(Schema.String),
  status: FeatureRegistryStatus,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  tags: Schema.Array(Schema.String),
})
export type FeatureRegistryEntry = typeof FeatureRegistryEntry.Type

export interface FeatureRegistryListFilter {
  featureName?: string
  issueId?: string
  workspaceId?: string
  agentId?: string
  status?: FeatureRegistryStatus
  tags?: string[]
  limit?: number
}

export interface FeatureRegistryTagInput {
  issueId: string
  featureName: string
  description?: string
  workspaceId?: string | null
  agentId?: string | null
  status?: FeatureRegistryStatus
  tags?: string[]
  now?: string
}

export interface FeatureRegistryUntagInput {
  issueId: string
  featureName: string
}

export interface FeatureRegistryOwnershipUpdate {
  featureName?: string
  issueId?: string | null
  workspaceId?: string | null
  agentId?: string | null
  status?: FeatureRegistryStatus
  tags?: string[]
  now?: string
}
