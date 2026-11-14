// The explorer's one RPC seam (PAN-5186, D-B1).
//
// Every pan.explorer* call the explorer pane makes goes through this module, so
// a contract rename is a one-file change. No other file under
// components/explorer/ imports wsTransport.

import {
  PanRpcError,
  WS_METHODS,
  type ExplorerEntryResult,
  type ExplorerGitStageInput,
  type ExplorerGitStageResult,
  type ExplorerGitStatusResult,
  type ExplorerListDirResult,
  type ExplorerReadFileResult,
  type ExplorerRestoreResult,
  type ExplorerSearchContentResult,
  type ExplorerSearchFilesResult,
  type ExplorerWatchBatch,
  type ExplorerWriteFileInput,
  type ExplorerWriteFileResult,
} from '@overdeck/contracts'

import { getTransport, type PanRpcProtocolClient } from '../../lib/wsTransport'

export type GitStageAction = ExplorerGitStageInput['action']

export function listDir(rootId: string, path: string): Promise<ExplorerListDirResult> {
  return getTransport().request((client) => (client as PanRpcProtocolClient)[WS_METHODS.explorerListDir]({ rootId, path }))
}

/** Read a file of a root; `ref: 'HEAD'` reads its committed version (PAN-5187). */
export function readFile(rootId: string, path: string, ref?: 'HEAD'): Promise<ExplorerReadFileResult> {
  return getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.explorerReadFile]({ rootId, path, ...(ref ? { ref } : {}) }),
  )
}

/** Save a code pane's text with the disk-signature precondition (PAN-5187). */
export function writeFile(input: ExplorerWriteFileInput): Promise<ExplorerWriteFileResult> {
  return getTransport().request((client) => (client as PanRpcProtocolClient)[WS_METHODS.explorerWriteFile](input))
}

/** Create a file or folder; the server makes missing parent folders (PAN-5190). */
export function createEntry(rootId: string, path: string, kind: 'file' | 'dir'): Promise<ExplorerEntryResult> {
  return getTransport().request((client) => (client as PanRpcProtocolClient)[WS_METHODS.explorerCreate]({ rootId, path, kind }))
}

/** Rename or move one path within a root (PAN-5190). */
export function renameEntry(rootId: string, from: string, to: string): Promise<ExplorerEntryResult> {
  return getTransport().request((client) => (client as PanRpcProtocolClient)[WS_METHODS.explorerRename]({ rootId, from, to }))
}

/** Copy one path to a free target within a root (PAN-5190). */
export function copyEntry(rootId: string, from: string, to: string): Promise<ExplorerEntryResult> {
  return getTransport().request((client) => (client as PanRpcProtocolClient)[WS_METHODS.explorerCopy]({ rootId, from, to }))
}

/**
 * Move one path to the Overdeck trash; returns its trash id (PAN-5190 D-E6).
 * One path per call, because a failing multi-path delete does not report the
 * ids it already moved.
 */
export async function trashPath(rootId: string, path: string): Promise<string> {
  const { trashIds } = await getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.explorerDelete]({ rootId, paths: [path] }),
  )
  const id = trashIds[0]
  if (!id) throw new Error(`The server returned no trash id for ${path}`)
  return id
}

/** Restore a trashed entry to its original path (PAN-5190). */
export function restoreEntry(rootId: string, trashId: string): Promise<ExplorerRestoreResult> {
  return getTransport().request((client) => (client as PanRpcProtocolClient)[WS_METHODS.explorerRestore]({ rootId, trashId }))
}

export function gitStatus(rootId: string): Promise<ExplorerGitStatusResult> {
  return getTransport().request((client) => (client as PanRpcProtocolClient)[WS_METHODS.explorerGitStatus]({ rootId }))
}

/** Stage, unstage or discard; a discard returns the trash ids of the files it moved to the Overdeck trash. */
export function gitStage(rootId: string, paths: readonly string[], action: GitStageAction): Promise<ExplorerGitStageResult> {
  return getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.explorerGitStage]({ rootId, paths: [...paths], action }),
  )
}

export function searchFiles(rootId: string, query: string, limit = 50): Promise<ExplorerSearchFilesResult> {
  return getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.explorerSearchFiles]({ rootId, query, limit }),
  )
}

export interface SearchContentOptions {
  rootId: string
  query: string
  scopePath?: string
  regex: boolean
  caseSensitive: boolean
  limit?: number
}

export function searchContent({
  rootId,
  query,
  scopePath,
  regex,
  caseSensitive,
  limit = 500,
}: SearchContentOptions): Promise<ExplorerSearchContentResult> {
  return getTransport().request((client) =>
    (client as PanRpcProtocolClient)[WS_METHODS.explorerSearchContent]({
      rootId,
      query,
      ...(scopePath ? { scopePath } : {}),
      regex,
      caseSensitive,
      limit,
    }),
  )
}

/**
 * Open the server watch stream for a root. `onReconnect` fires when the
 * subscription recovers after a failure; callers treat it like `overflow`.
 * Returns the unsubscribe function.
 */
export function subscribeWatchStream(
  rootId: string,
  onBatch: (batch: ExplorerWatchBatch) => void,
  onReconnect: () => void,
): () => void {
  return getTransport().subscribe(
    (client) => (client as PanRpcProtocolClient)[WS_METHODS.explorerWatch]({ rootId }),
    onBatch,
    { onReconnect },
  )
}

/** The PanRpcError code of an explorer failure, or undefined for any other error. */
export function explorerErrorCode(error: unknown): string | undefined {
  return error instanceof PanRpcError ? error.code : undefined
}

/** A readable message for any explorer failure. */
export function explorerErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return String(error)
}

export type ExplorerRootKind = 'project' | 'issue' | 'workspace'

/** Split a root id on its first ':'. Returns null for an unknown kind or an empty key. */
export function parseRootId(rootId: string): { kind: ExplorerRootKind; key: string } | null {
  const at = rootId.indexOf(':')
  if (at <= 0) return null
  const kind = rootId.slice(0, at)
  const key = rootId.slice(at + 1)
  if (!key) return null
  if (kind !== 'project' && kind !== 'issue' && kind !== 'workspace') return null
  return { kind, key }
}

/** The header label of a root: the project key, the issue id, or "workspace <id>". */
export function rootLabel(rootId: string): string {
  const parsed = parseRootId(rootId)
  if (!parsed) return rootId
  return parsed.kind === 'workspace' ? `workspace ${parsed.key}` : parsed.key
}

/** The download route of PAN-5188 (parent WI-12), as an attachment. */
export function explorerDownloadUrl(rootId: string, path: string): string {
  return `/api/explorer/download?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(path)}&inline=0`
}
