// Markdown Preview source for one dock diff target (PAN-5341 D-1, D-3, D-7).

import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs'

import { isMarkdownPath } from '../../explorer/code/CodePaneHeader'
import {
  isDeletedDiffFile,
  markdownPreviewSource,
  type PreviewScope,
  type PreviewSource,
} from '../../diff/markdownPreviewSource'
import type { DockDiffTarget } from '../workDockStore'

/** What DockDiffView's query resolves to. `deleted`: the working-tree read was NOT_FOUND. */
export type DockDiffBody =
  | { kind: 'patch'; patch: string }
  | { kind: 'files'; files: FileDiffMetadata[]; deleted: boolean }
  | { kind: 'message'; text: string }

/** D-1: the PAN-5338 scope that matches a target's source. */
export function dockPreviewScope(target: DockDiffTarget): PreviewScope {
  if (target.sha) return { kind: 'compare' }
  if (target.committedVsMain) return { kind: 'vs-main' }
  return { kind: 'full' }
}

/** The single file of a one-file patch; undefined when empty or unparseable. */
export function patchFileOf(patch: string): FileDiffMetadata | undefined {
  const text = patch.trim()
  if (text.length === 0) return undefined
  try {
    return parsePatchFiles(text).flatMap((p) => p.files)[0]
  } catch {
    return undefined
  }
}

/** D-1/D-3/D-4: the preview source, or null when the target gets no Diff | Preview switch. */
export function dockMarkdownPreview(input: {
  target: DockDiffTarget
  body: DockDiffBody
  rootId: string | null
}): PreviewSource | null {
  const { target, body, rootId } = input
  if (!isMarkdownPath(target.path)) return null
  if (body.kind === 'message') return null
  if (body.kind === 'files' && body.deleted) return null
  const file = body.kind === 'patch' ? patchFileOf(body.patch) : undefined
  if (isDeletedDiffFile(file, undefined)) return null
  return markdownPreviewSource({
    file,
    scope: dockPreviewScope(target),
    agentRoute: false,
    rootId,
    rootPath: target.outsideRoot ? null : target.path,
  })
}
