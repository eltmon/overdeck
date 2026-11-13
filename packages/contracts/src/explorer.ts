// File explorer contracts (PAN-5183). Payload and result schemas for the 14
// pan.explorer* RPC methods. The Rpc definitions themselves live in rpc.ts.
//
// Paths in payloads and results are root-relative POSIX paths: no leading
// "/", no "." or ".." segments, no empty segments. "" names the root itself.
import { Schema } from "effect"

// ─── Shared ───────────────────────────────────────────────────────────────────

/** "project:<key>", "issue:<id>" or "workspace:<id>". */
export const ExplorerRootId = Schema.String
export type ExplorerRootId = typeof ExplorerRootId.Type

export const ExplorerEntryKind = Schema.Literals(["file", "dir", "symlink"])
export type ExplorerEntryKind = typeof ExplorerEntryKind.Type

export const ExplorerEntry = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  kind: ExplorerEntryKind,
  size: Schema.optional(Schema.Number),
  mtimeMs: Schema.Number,
  ignored: Schema.Boolean,
})
export type ExplorerEntry = typeof ExplorerEntry.Type

/** Result shared by create, rename and copy. */
export const ExplorerEntryResult = Schema.Struct({
  entry: ExplorerEntry,
})
export type ExplorerEntryResult = typeof ExplorerEntryResult.Type

// ─── List and read ────────────────────────────────────────────────────────────

export const ExplorerListDirInput = Schema.Struct({
  rootId: ExplorerRootId,
  path: Schema.String,
})
export type ExplorerListDirInput = typeof ExplorerListDirInput.Type

export const ExplorerListDirResult = Schema.Struct({
  entries: Schema.Array(ExplorerEntry),
  truncated: Schema.Boolean,
  absPath: Schema.String,
})
export type ExplorerListDirResult = typeof ExplorerListDirResult.Type

export const ExplorerReadFileInput = Schema.Struct({
  rootId: ExplorerRootId,
  path: Schema.String,
  ref: Schema.optional(Schema.Literals(["HEAD"])),
})
export type ExplorerReadFileInput = typeof ExplorerReadFileInput.Type

export const ExplorerReadFileResult = Schema.Struct({
  kind: Schema.Literals(["text", "binary", "large-text"]),
  text: Schema.optional(Schema.String),
  size: Schema.Number,
  mtimeMs: Schema.Number,
  signature: Schema.String,
  lang: Schema.String,
  writable: Schema.Boolean,
})
export type ExplorerReadFileResult = typeof ExplorerReadFileResult.Type

// ─── Write-side file operations ───────────────────────────────────────────────

export const ExplorerWriteFileInput = Schema.Struct({
  rootId: ExplorerRootId,
  path: Schema.String,
  text: Schema.String,
  expectedSignature: Schema.NullOr(Schema.String),
  allowMissing: Schema.Boolean,
})
export type ExplorerWriteFileInput = typeof ExplorerWriteFileInput.Type

export const ExplorerWriteFileResult = Schema.Struct({
  signature: Schema.String,
  mtimeMs: Schema.Number,
})
export type ExplorerWriteFileResult = typeof ExplorerWriteFileResult.Type

export const ExplorerCreateInput = Schema.Struct({
  rootId: ExplorerRootId,
  path: Schema.String,
  kind: Schema.Literals(["file", "dir"]),
})
export type ExplorerCreateInput = typeof ExplorerCreateInput.Type

export const ExplorerRenameInput = Schema.Struct({
  rootId: ExplorerRootId,
  from: Schema.String,
  to: Schema.String,
})
export type ExplorerRenameInput = typeof ExplorerRenameInput.Type

export const ExplorerCopyInput = Schema.Struct({
  rootId: ExplorerRootId,
  from: Schema.String,
  to: Schema.String,
})
export type ExplorerCopyInput = typeof ExplorerCopyInput.Type

export const ExplorerDeleteInput = Schema.Struct({
  rootId: ExplorerRootId,
  paths: Schema.Array(Schema.String),
})
export type ExplorerDeleteInput = typeof ExplorerDeleteInput.Type

export const ExplorerDeleteResult = Schema.Struct({
  trashIds: Schema.Array(Schema.String),
})
export type ExplorerDeleteResult = typeof ExplorerDeleteResult.Type

export const ExplorerRestoreInput = Schema.Struct({
  rootId: ExplorerRootId,
  trashId: Schema.String,
})
export type ExplorerRestoreInput = typeof ExplorerRestoreInput.Type

export const ExplorerRestoreResult = Schema.Struct({
  path: Schema.String,
})
export type ExplorerRestoreResult = typeof ExplorerRestoreResult.Type

// ─── Git ──────────────────────────────────────────────────────────────────────

export const ExplorerGitFileStatus = Schema.Literals(["untracked", "added", "modified", "deleted", "renamed", "conflicted"])
export type ExplorerGitFileStatus = typeof ExplorerGitFileStatus.Type

export const ExplorerGitCommittedStatus = Schema.Literals(["added", "modified", "deleted", "renamed"])
export type ExplorerGitCommittedStatus = typeof ExplorerGitCommittedStatus.Type

export const ExplorerGitStatusInput = Schema.Struct({
  rootId: ExplorerRootId,
})
export type ExplorerGitStatusInput = typeof ExplorerGitStatusInput.Type

export const ExplorerGitStatusEntry = Schema.Struct({
  path: Schema.String,
  status: ExplorerGitFileStatus,
  staged: Schema.Boolean,
})
export type ExplorerGitStatusEntry = typeof ExplorerGitStatusEntry.Type

export const ExplorerGitCommittedEntry = Schema.Struct({
  path: Schema.String,
  status: ExplorerGitCommittedStatus,
})
export type ExplorerGitCommittedEntry = typeof ExplorerGitCommittedEntry.Type

export const ExplorerGitStatusResult = Schema.Struct({
  entries: Schema.Array(ExplorerGitStatusEntry),
  committed: Schema.Array(ExplorerGitCommittedEntry),
  branch: Schema.NullOr(Schema.String),
  truncated: Schema.Boolean,
})
export type ExplorerGitStatusResult = typeof ExplorerGitStatusResult.Type

export const ExplorerGitStageInput = Schema.Struct({
  rootId: ExplorerRootId,
  paths: Schema.Array(Schema.String),
  action: Schema.Literals(["stage", "unstage", "discard"]),
})
export type ExplorerGitStageInput = typeof ExplorerGitStageInput.Type

export const ExplorerGitStageResult = Schema.Struct({})
export type ExplorerGitStageResult = typeof ExplorerGitStageResult.Type

// ─── Search ───────────────────────────────────────────────────────────────────

export const ExplorerSearchFilesInput = Schema.Struct({
  rootId: ExplorerRootId,
  query: Schema.String,
  limit: Schema.Number,
})
export type ExplorerSearchFilesInput = typeof ExplorerSearchFilesInput.Type

export const ExplorerSearchFilesResult = Schema.Struct({
  paths: Schema.Array(Schema.String),
})
export type ExplorerSearchFilesResult = typeof ExplorerSearchFilesResult.Type

export const ExplorerSearchContentInput = Schema.Struct({
  rootId: ExplorerRootId,
  query: Schema.String,
  scopePath: Schema.optional(Schema.String),
  regex: Schema.Boolean,
  caseSensitive: Schema.Boolean,
  limit: Schema.Number,
})
export type ExplorerSearchContentInput = typeof ExplorerSearchContentInput.Type

export const ExplorerSearchContentMatch = Schema.Struct({
  path: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
  preview: Schema.String,
})
export type ExplorerSearchContentMatch = typeof ExplorerSearchContentMatch.Type

export const ExplorerSearchContentResult = Schema.Struct({
  matches: Schema.Array(ExplorerSearchContentMatch),
  truncated: Schema.Boolean,
})
export type ExplorerSearchContentResult = typeof ExplorerSearchContentResult.Type

// ─── Watch ────────────────────────────────────────────────────────────────────

/** An `overflow` event has `path: ""`: the client re-lists everything it shows. */
export const ExplorerWatchEvent = Schema.Struct({
  kind: Schema.Literals(["create", "update", "delete", "rename", "overflow"]),
  path: Schema.String,
  oldPath: Schema.optional(Schema.String),
  isDirectory: Schema.optional(Schema.Boolean),
})
export type ExplorerWatchEvent = typeof ExplorerWatchEvent.Type

export const ExplorerWatchInput = Schema.Struct({
  rootId: ExplorerRootId,
})
export type ExplorerWatchInput = typeof ExplorerWatchInput.Type

/** One element of the pan.explorerWatch stream. */
export const ExplorerWatchBatch = Schema.Struct({
  events: Schema.Array(ExplorerWatchEvent),
})
export type ExplorerWatchBatch = typeof ExplorerWatchBatch.Type

// ─── Edit workspace ───────────────────────────────────────────────────────────

export const ExplorerBeginEditInput = Schema.Struct({
  projectKey: Schema.String,
  forceNew: Schema.Boolean,
})
export type ExplorerBeginEditInput = typeof ExplorerBeginEditInput.Type

export const ExplorerBeginEditResult = Schema.Struct({
  rootId: ExplorerRootId,
  workspaceId: Schema.String,
  name: Schema.String,
  branch: Schema.String,
  path: Schema.String,
  created: Schema.Boolean,
})
export type ExplorerBeginEditResult = typeof ExplorerBeginEditResult.Type

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Values of PanRpcError.code that explorer methods return. */
export const EXPLORER_ERROR_CODES = [
  "ROOT_NOT_FOUND",
  "PATH_OUTSIDE_ROOT",
  "PATH_IN_GIT_DIR",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "DISK_CONFLICT",
  "EDIT_WORKSPACE_REQUIRED",
  "FILE_TOO_LARGE",
  "NOT_A_GIT_REPO",
  "NOTHING_TO_COMMIT",
  "NOT_IMPLEMENTED",
  "INVALID_QUERY",
  "EXPLORER_FAILED",
] as const
export type ExplorerErrorCode = (typeof EXPLORER_ERROR_CODES)[number]
