// Pure Markdown preview source rules for the diff panel (PAN-5338 D-1, D-8).

import type { FileDiffMetadata } from '@pierre/diffs'

import { toRootPath } from '../dock/changes-model'

export const SHOWING_CURRENT_FILE = 'Showing the current file'
export const NO_ROOT_PREVIEW = "Open this conversation's folder on this machine to preview this file."
export const OUTSIDE_ROOT_PREVIEW = "This file is outside the conversation's folder."

/** The new file's full text, from a patch file of type 'new'; null otherwise. */
export function addedFileText(file: FileDiffMetadata): string | null {
  if (file.type !== 'new') return null
  return file.additionLines.map((line) => (line.endsWith('\n') ? line : `${line}\n`)).join('')
}

export function isDeletedDiffFile(
  file: FileDiffMetadata | undefined,
  listKind: string | undefined,
): boolean {
  return file?.type === 'deleted' || (listKind ?? '').toUpperCase().startsWith('D')
}

export type PreviewScope =
  | { kind: 'full' }
  | { kind: 'turn'; newest: boolean }
  | { kind: 'vs-main' }
  | { kind: 'compare' }

export type PreviewSource =
  | { kind: 'patch'; text: string }
  | { kind: 'read'; rootId: string; path: string; ref?: 'HEAD'; note: boolean }
  | { kind: 'unavailable'; message: string }

/** D-1: the preview source order — added file, missing root, outside root, then the per-scope read. */
export function markdownPreviewSource(input: {
  file: FileDiffMetadata | undefined
  scope: PreviewScope
  agentRoute: boolean
  rootId: string | null
  rootPath: string | null
}): PreviewSource {
  const addedText = input.file ? addedFileText(input.file) : null
  if (addedText !== null) return { kind: 'patch', text: addedText }

  if (input.rootId === null) return { kind: 'unavailable', message: NO_ROOT_PREVIEW }
  if (input.rootPath === null) return { kind: 'unavailable', message: OUTSIDE_ROOT_PREVIEW }
  const rootId = input.rootId
  const path = input.rootPath

  if (input.scope.kind === 'vs-main') return { kind: 'read', rootId, path, ref: 'HEAD', note: false }
  if (input.scope.kind === 'compare') return { kind: 'read', rootId, path, note: true }
  if (input.scope.kind === 'turn' && input.agentRoute && !input.scope.newest) {
    return { kind: 'read', rootId, path, note: true }
  }
  return { kind: 'read', rootId, path, note: false }
}

function isCwdWithinRoot(cwd: string, rootAbs: string): boolean {
  if (cwd === rootAbs) return true
  return cwd.startsWith(rootAbs.endsWith('/') ? rootAbs : `${rootAbs}/`)
}

/** D-8: repo path → explorer root path; null when the conversation's cwd sits outside the root. */
export function diffPathToRootPath(
  repoPath: string,
  ctx: { repoRoot: string | null; rootAbs: string | null; cwd: string | null },
): string | null {
  const { repoRoot, rootAbs, cwd } = ctx
  if (cwd !== null && rootAbs !== null && !isCwdWithinRoot(cwd, rootAbs)) return null
  if (repoRoot === null || rootAbs === null) return repoPath
  return toRootPath(repoRoot, rootAbs, repoPath)
}
