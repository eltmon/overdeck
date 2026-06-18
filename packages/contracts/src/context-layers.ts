import { Schema } from "effect"
import type { Harness } from "./types"

export const CONTEXT_LAYER_KINDS = ["global", "project", "workspace"] as const
export const CONTEXT_PREVIEW_HARNESSES = ["claude-code", "pi", "codex"] as const satisfies readonly Harness[]

export const ContextLayerKind = Schema.Literals(CONTEXT_LAYER_KINDS)
export type ContextLayerKind = typeof ContextLayerKind.Type

export const ContextPreviewHarness = Schema.Literals(CONTEXT_PREVIEW_HARNESSES)
export type ContextPreviewHarness = typeof ContextPreviewHarness.Type

export const ContextProjectSummary = Schema.Struct({
  projectKey: Schema.String,
  name: Schema.String,
  path: Schema.String,
  issuePrefix: Schema.optional(Schema.String),
  tracker: Schema.optional(Schema.Literals(["linear", "github", "gitlab", "rally"])),
  workspaceRoot: Schema.optional(Schema.String),
})
export type ContextProjectSummary = typeof ContextProjectSummary.Type

export const ContextWorkspaceSummary = Schema.Struct({
  projectKey: Schema.String,
  path: Schema.String,
  name: Schema.String,
  issueId: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
})
export type ContextWorkspaceSummary = typeof ContextWorkspaceSummary.Type

const ContextLayerBase = {
  file: Schema.String,
  exists: Schema.Boolean,
  content: Schema.String,
  editable: Schema.Boolean,
}

export const GlobalContextLayerRecord = Schema.Struct({
  kind: Schema.Literal("global"),
  ...ContextLayerBase,
})
export type GlobalContextLayerRecord = typeof GlobalContextLayerRecord.Type

export const ProjectContextLayerRecord = Schema.Struct({
  kind: Schema.Literal("project"),
  projectKey: Schema.String,
  ...ContextLayerBase,
})
export type ProjectContextLayerRecord = typeof ProjectContextLayerRecord.Type

export const WorkspaceContextLayerRecord = Schema.Struct({
  kind: Schema.Literal("workspace"),
  projectKey: Schema.String,
  workspacePath: Schema.String,
  ...ContextLayerBase,
})
export type WorkspaceContextLayerRecord = typeof WorkspaceContextLayerRecord.Type

export const ContextEditableLayerRecord = Schema.Union([
  GlobalContextLayerRecord,
  ProjectContextLayerRecord,
  WorkspaceContextLayerRecord,
])
export type ContextEditableLayerRecord = typeof ContextEditableLayerRecord.Type

export const GlobalContextLayerTarget = Schema.Struct({
  kind: Schema.Literal("global"),
})
export type GlobalContextLayerTarget = typeof GlobalContextLayerTarget.Type

export const ProjectContextLayerTarget = Schema.Struct({
  kind: Schema.Literal("project"),
  projectKey: Schema.String,
})
export type ProjectContextLayerTarget = typeof ProjectContextLayerTarget.Type

export const WorkspaceContextLayerTarget = Schema.Struct({
  kind: Schema.Literal("workspace"),
  projectKey: Schema.String,
  workspacePath: Schema.String,
})
export type WorkspaceContextLayerTarget = typeof WorkspaceContextLayerTarget.Type

export const ContextLayerTarget = Schema.Union([
  GlobalContextLayerTarget,
  ProjectContextLayerTarget,
  WorkspaceContextLayerTarget,
])
export type ContextLayerTarget = typeof ContextLayerTarget.Type

export const ContextLayerDraft = Schema.Struct({
  target: ContextLayerTarget,
  content: Schema.String,
})
export type ContextLayerDraft = typeof ContextLayerDraft.Type

/**
 * A rendered output file `pan sync` writes a Overdeck-managed region into
 * (e.g. ~/.claude/CLAUDE.md, a project's CLAUDE.md or AGENTS.md). Distinct from
 * the editable *layer source* files — this describes the injection *target* so
 * the dashboard can show the user exactly where context lands and reassure them
 * their own content is preserved.
 */
export const ContextSyncTarget = Schema.Struct({
  harness: ContextPreviewHarness,
  layerKind: Schema.Literals(["global", "project"]),
  projectKey: Schema.optional(Schema.String),
  /** Short human label, e.g. "Claude Code · global". */
  label: Schema.String,
  /** Resolved absolute path of the target file. */
  path: Schema.String,
  exists: Schema.Boolean,
  /** True when the file already contains a Overdeck-managed region. */
  hasManagedRegion: Schema.Boolean,
  /** True when the file has hand-authored content outside the managed region. */
  hasUserContent: Schema.Boolean,
})
export type ContextSyncTarget = typeof ContextSyncTarget.Type

export const ContextLayersResponse = Schema.Struct({
  operation: Schema.Literal("load"),
  projects: Schema.Array(ContextProjectSummary),
  workspaces: Schema.Array(ContextWorkspaceSummary),
  layers: Schema.Array(ContextEditableLayerRecord),
  /** Injection targets `pan sync` writes managed regions into. */
  targets: Schema.Array(ContextSyncTarget),
})
export type ContextLayersResponse = typeof ContextLayersResponse.Type

export const ContextPreviewRequest = Schema.Struct({
  operation: Schema.Literal("preview"),
  selectedLayer: ContextLayerTarget,
  drafts: Schema.Array(ContextLayerDraft),
})
export type ContextPreviewRequest = typeof ContextPreviewRequest.Type

export const ContextHarnessPreviews = Schema.Struct({
  "claude-code": Schema.String,
  pi: Schema.String,
  codex: Schema.String,
  fullPrompt: Schema.String,
})
export type ContextHarnessPreviews = typeof ContextHarnessPreviews.Type

export const ContextPreviewDiagnostic = Schema.Struct({
  level: Schema.Literals(["info", "warning", "error"]),
  message: Schema.String,
  layer: Schema.optional(ContextLayerTarget),
})
export type ContextPreviewDiagnostic = typeof ContextPreviewDiagnostic.Type

export const ContextPreviewResponse = Schema.Struct({
  operation: Schema.Literal("preview"),
  previews: ContextHarnessPreviews,
  diagnostics: Schema.Array(ContextPreviewDiagnostic),
})
export type ContextPreviewResponse = typeof ContextPreviewResponse.Type

export const ContextLayerSaveRequest = Schema.Struct({
  operation: Schema.Literal("save"),
  target: ContextLayerTarget,
  content: Schema.String,
})
export type ContextLayerSaveRequest = typeof ContextLayerSaveRequest.Type

export const ContextLayerSaveResponse = Schema.Struct({
  operation: Schema.Literal("save"),
  layer: ContextEditableLayerRecord,
  savedAt: Schema.String,
})
export type ContextLayerSaveResponse = typeof ContextLayerSaveResponse.Type

export const ContextSyncRequest = Schema.Struct({
  operation: Schema.Literal("sync"),
})
export type ContextSyncRequest = typeof ContextSyncRequest.Type

export const ContextSyncResponse = Schema.Struct({
  operation: Schema.Literal("sync"),
  success: Schema.Boolean,
  exitCode: Schema.optional(Schema.Number),
  stdout: Schema.String,
  stderr: Schema.String,
  syncedAt: Schema.String,
})
export type ContextSyncResponse = typeof ContextSyncResponse.Type
