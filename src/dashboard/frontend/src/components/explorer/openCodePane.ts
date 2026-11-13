// Open a file from the explorer as a Stage 'code' pane (PAN-5186, FR-22).
//
// The code pane spec carries the explorer root and the root-relative path.
// A content-search hit also carries a reveal target: line, column and a fresh
// nonce, the same pattern agent panes use for targetMessageId/targetMessageNonce.
// The code pane renderer is PAN-5187's; this module only writes the spec.
//
// Preview panes (PAN-5187, D-C14): a `preview` open reuses the root's one
// preview pane (italic tab) instead of adding a tab per file. Opening the
// same file without `preview` makes that pane permanent.

import { usePanesStore, type PaneId, type WorkspacePane } from '../../lib/panesStore'

export interface CodePaneTarget {
  rootId: string
  path: string
  line?: number
  column?: number
  /** Open in the root's reusable preview pane (a single click in the tree). */
  preview?: boolean
}

// Module counter: each reveal gets a strictly larger nonce, so the code pane
// re-runs its reveal even when the same line is opened twice.
let revealSeq = 0

/** The tab label for a code pane: the basename of the path ('' → the path). */
export function codePaneLabel(path: string): string {
  const base = path.split('/').filter(Boolean).pop()
  return base || path
}

/**
 * Open `target` in deck `deckKey`, in this order:
 * - a code pane for the same (root, path) is focused and gets the reveal
 *   patch; a non-preview open also makes a preview pane permanent;
 * - a preview open retargets the root's preview pane, if it has one;
 * - otherwise a new pane is added (a preview pane for a preview open).
 * Returns the pane id.
 */
export function openCodePane(deckKey: string, target: CodePaneTarget): PaneId {
  const store = usePanesStore.getState()
  const preview = target.preview === true
  const patch: Partial<WorkspacePane> =
    target.line !== undefined
      ? {
          explorerRevealLine: target.line,
          explorerRevealColumn: target.column ?? 1,
          explorerRevealNonce: ++revealSeq,
        }
      : {}
  const panes = store.panesByWorkspace[deckKey] ?? []
  const existing = panes.find(
    (p) => p.paneType === 'code' && p.explorerRootId === target.rootId && p.explorerPath === target.path,
  )
  if (existing) {
    const pin: Partial<WorkspacePane> = !preview && existing.explorerPreview ? { explorerPreview: false } : {}
    if (Object.keys(patch).length > 0 || Object.keys(pin).length > 0) {
      store.updatePane(deckKey, existing.paneId, { ...patch, ...pin })
    }
    store.setActivePane(deckKey, existing.paneId)
    return existing.paneId
  }
  if (preview) {
    const previewPane = panes.find(
      (p) => p.paneType === 'code' && p.explorerRootId === target.rootId && p.explorerPreview === true,
    )
    if (previewPane) {
      store.updatePane(deckKey, previewPane.paneId, {
        explorerPath: target.path,
        label: codePaneLabel(target.path),
        ...patch,
      })
      store.setActivePane(deckKey, previewPane.paneId)
      return previewPane.paneId
    }
  }
  return store.addPane(deckKey, {
    paneType: 'code',
    label: codePaneLabel(target.path),
    explorerRootId: target.rootId,
    explorerPath: target.path,
    explorerPreview: preview,
    ...patch,
  })
}
