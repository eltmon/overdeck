// Open a file from the explorer as a Stage 'code' pane (PAN-5186, FR-22).
//
// The code pane spec carries the explorer root and the root-relative path.
// A content-search hit also carries a reveal target: line, column and a fresh
// nonce, the same pattern agent panes use for targetMessageId/targetMessageNonce.
// The code pane renderer is PAN-5187's; this module only writes the spec.

import { usePanesStore, type PaneId, type WorkspacePane } from '../../lib/panesStore'

export interface CodePaneTarget {
  rootId: string
  path: string
  line?: number
  column?: number
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
 * Open `target` in deck `deckKey`. An existing code pane for the same
 * (root, path) is focused and gets the reveal patch; otherwise a new one is
 * added. Returns the pane id.
 */
export function openCodePane(deckKey: string, target: CodePaneTarget): PaneId {
  const store = usePanesStore.getState()
  const patch: Partial<WorkspacePane> =
    target.line !== undefined
      ? {
          explorerRevealLine: target.line,
          explorerRevealColumn: target.column ?? 1,
          explorerRevealNonce: ++revealSeq,
        }
      : {}
  const existing = (store.panesByWorkspace[deckKey] ?? []).find(
    (p) => p.paneType === 'code' && p.explorerRootId === target.rootId && p.explorerPath === target.path,
  )
  if (existing) {
    if (Object.keys(patch).length > 0) store.updatePane(deckKey, existing.paneId, patch)
    store.setActivePane(deckKey, existing.paneId)
    return existing.paneId
  }
  return store.addPane(deckKey, {
    paneType: 'code',
    label: codePaneLabel(target.path),
    explorerRootId: target.rootId,
    explorerPath: target.path,
    ...patch,
  })
}
