import { Schema } from "effect"

export const ArtifactId = Schema.String
export type ArtifactId = typeof ArtifactId.Type

export const ArtifactSlug = Schema.String
export type ArtifactSlug = typeof ArtifactSlug.Type

export const ArtifactHash = Schema.String
export type ArtifactHash = typeof ArtifactHash.Type

export const ArtifactAgentRole = Schema.Literals(["plan", "work", "review", "test", "ship", "flywheel", "user"])
export type ArtifactAgentRole = typeof ArtifactAgentRole.Type

export const ArtifactAgentHarness = Schema.Literals(["claude-code", "pi", "ohmypi", "codex", "user"])
export type ArtifactAgentHarness = typeof ArtifactAgentHarness.Type

export const ArtifactLifecycleState = Schema.Literals([
  "published",
  "pending_changes",
  "unshared",
])
export type ArtifactLifecycleState = typeof ArtifactLifecycleState.Type

export const ArtifactValidationCode = Schema.Literals([
  "invalid_file_type",
  "not_a_file",
  "size_limit_exceeded",
  "forbidden_asset_url",
  "secret_detected",
  "secret_allowed",
  "high_entropy_string",
  "inline_event_handler",
  "missing_image_alt",
])
export type ArtifactValidationCode = typeof ArtifactValidationCode.Type

export const ArtifactValidationFinding = Schema.Struct({
  code: ArtifactValidationCode,
  message: Schema.String,
  line: Schema.optional(Schema.Number),
  column: Schema.optional(Schema.Number),
  rule: Schema.optional(Schema.String),
  strict: Schema.optional(Schema.Boolean),
})
export type ArtifactValidationFinding = typeof ArtifactValidationFinding.Type

export const ArtifactValidationResult = Schema.Struct({
  ok: Schema.Boolean,
  filePath: Schema.optional(Schema.String),
  size: Schema.Number,
  hash: ArtifactHash,
  strict: Schema.Boolean,
  errors: Schema.Array(ArtifactValidationFinding),
  warnings: Schema.Array(ArtifactValidationFinding),
})
export type ArtifactValidationResult = typeof ArtifactValidationResult.Type

export const ArtifactMetadata = Schema.Struct({
  artifactId: ArtifactId,
  slug: ArtifactSlug,
  issueId: Schema.optional(Schema.NullOr(Schema.String)),
  workspaceId: Schema.optional(Schema.NullOr(Schema.String)),
  agentRole: Schema.optional(Schema.NullOr(ArtifactAgentRole)),
  agentHarness: Schema.optional(Schema.NullOr(ArtifactAgentHarness)),
  runId: Schema.optional(Schema.NullOr(Schema.String)),
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
  filePath: Schema.String,
  currentHash: ArtifactHash,
  lastPublishedHash: Schema.optional(Schema.NullOr(ArtifactHash)),
  supersedes: Schema.optional(Schema.NullOr(ArtifactId)),
  title: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  publishedAt: Schema.optional(Schema.NullOr(Schema.String)),
  unsharedAt: Schema.optional(Schema.NullOr(Schema.String)),
})
export type ArtifactMetadata = typeof ArtifactMetadata.Type

export const ArtifactUrls = Schema.Struct({
  wrapperUrl: Schema.String,
  rawUrl: Schema.String,
})
export type ArtifactUrls = typeof ArtifactUrls.Type

export const ArtifactStatusResponse = Schema.Struct({
  artifact: Schema.optional(ArtifactMetadata),
  filePath: Schema.String,
  currentHash: ArtifactHash,
  lastPublishedHash: Schema.optional(Schema.NullOr(ArtifactHash)),
  pendingChanges: Schema.Boolean,
  validation: Schema.optional(ArtifactValidationResult),
})
export type ArtifactStatusResponse = typeof ArtifactStatusResponse.Type

export const ArtifactCreateResponse = Schema.Struct({
  artifact: ArtifactMetadata,
  urls: ArtifactUrls,
  validation: ArtifactValidationResult,
  published: Schema.Boolean,
})
export type ArtifactCreateResponse = typeof ArtifactCreateResponse.Type

export const ArtifactPublishResponse = Schema.Struct({
  artifact: ArtifactMetadata,
  urls: ArtifactUrls,
  validation: ArtifactValidationResult,
  published: Schema.Boolean,
  pendingChanges: Schema.Boolean,
})
export type ArtifactPublishResponse = typeof ArtifactPublishResponse.Type

export const ArtifactUnshareResponse = Schema.Struct({
  artifact: ArtifactMetadata,
  unshared: Schema.Boolean,
})
export type ArtifactUnshareResponse = typeof ArtifactUnshareResponse.Type

export const ArtifactListEntry = Schema.Struct({
  artifact: ArtifactMetadata,
  urls: ArtifactUrls,
  status: ArtifactLifecycleState,
  pendingChanges: Schema.Boolean,
  thumbnailUrl: Schema.optional(Schema.String),
})
export type ArtifactListEntry = typeof ArtifactListEntry.Type

export const ArtifactListResponse = Schema.Struct({
  artifacts: Schema.Array(ArtifactListEntry),
})
export type ArtifactListResponse = typeof ArtifactListResponse.Type

export const ArtifactDetailResponse = Schema.Struct({
  artifact: ArtifactMetadata,
  urls: ArtifactUrls,
  status: ArtifactLifecycleState,
  pendingChanges: Schema.Boolean,
})
export type ArtifactDetailResponse = typeof ArtifactDetailResponse.Type

export const WorkspaceArtifactsResponse = Schema.Struct({
  issueId: Schema.optional(Schema.String),
  workspaceId: Schema.optional(Schema.String),
  artifacts: Schema.Array(ArtifactListEntry),
})
export type WorkspaceArtifactsResponse = typeof WorkspaceArtifactsResponse.Type
