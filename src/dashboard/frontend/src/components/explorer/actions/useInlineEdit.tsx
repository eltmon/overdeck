/**
 * The explorer pane's inline create and rename state (PAN-5190, FR-E2, FR-E3,
 * D-E10).
 *
 * Holds the one open inline edit, resolves where a create lands, projects the
 * create row into the tree's rows, and renders the InlineNameRow that the tree
 * asks for. Kept out of ExplorerPane so the pane stays a thin composition.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement, type RefObject } from 'react'

import { explorerErrorCode, explorerErrorMessage } from '../explorer-rpc'
import { useExplorerStore, type RootState } from '../explorerStore'
import type { InlineRenderProps } from '../tree/ExplorerTree'
import { baseName, isTruncatedRow, parentPath, type ExplorerTreeItem } from '../tree/explorer-tree-model'
import { InlineNameRow } from './InlineNameRow'
import { withInlineRow, type InlineEdit, type InlineRow } from './inline-edit'
import type { ExplorerActions } from './useExplorerActions'

export interface UseInlineEditOptions {
  rootId: string
  root: RootState | undefined
  rows: readonly ExplorerTreeItem[]
  actions: ExplorerActions
  /** The tree element; focus returns to it after a commit or cancel. */
  treeRef: RefObject<HTMLElement | null>
}

export interface InlineEditController {
  inlineEdit: InlineEdit | null
  rows: (ExplorerTreeItem | InlineRow)[]
  startCreate(kind: 'file' | 'dir'): void
  startRename(path: string): void
  renderInline(props: InlineRenderProps): ReactElement
}

/**
 * D-E10: the folder a create lands in. A single selected folder; the parent of
 * a single selected file; otherwise the root.
 */
export function createTargetDir(selection: readonly string[], kindOf: (path: string) => string | undefined): string {
  if (selection.length !== 1) return ''
  const [path] = selection
  return kindOf(path) === 'dir' ? path : parentPath(path)
}

function commitError(error: unknown, name: string): string {
  return explorerErrorCode(error) === 'ALREADY_EXISTS' ? `${name} already exists here.` : explorerErrorMessage(error)
}

export function useInlineEdit({ rootId, root, rows, actions, treeRef }: UseInlineEditOptions): InlineEditController {
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null)

  const kindByPath = useMemo(
    () => new Map(rows.filter((row) => !isTruncatedRow(row)).map((row) => [row.path, row.kind as string])),
    [rows],
  )

  // Close the edit when the tree stops being writable, or when its row left
  // the tree (deleted on disk while the input was open).
  const { writable } = actions
  useEffect(() => {
    if (!inlineEdit) return
    const anchor = inlineEdit.mode === 'rename' ? inlineEdit.path : inlineEdit.parentDir
    if (!writable || (anchor !== '' && !kindByPath.has(anchor))) setInlineEdit(null)
  }, [inlineEdit, writable, kindByPath])

  const restoreFocus = useCallback(() => {
    const tree = treeRef.current
    const active = document.activeElement
    // A blur commit happens because the user clicked elsewhere: keep that focus.
    if (tree && (!active || active === document.body || tree.contains(active))) tree.focus()
  }, [treeRef])

  const close = useCallback(() => {
    setInlineEdit(null)
    restoreFocus()
  }, [restoreFocus])

  const startCreate = useCallback(
    (kind: 'file' | 'dir') => {
      if (!actions.writable) return
      const store = useExplorerStore.getState()
      const current = store.roots[rootId]
      const parentDir = createTargetDir(current?.selection ?? [], (path) => kindByPath.get(path))
      if (current?.changedOnly) store.setChangedOnly(rootId, false)
      if (parentDir !== '') store.setExpanded(rootId, parentDir, true)
      setInlineEdit({ mode: 'create', kind, parentDir })
    },
    [actions.writable, kindByPath, rootId],
  )

  const startRename = useCallback(
    (path: string) => {
      if (actions.writable) setInlineEdit({ mode: 'rename', path })
    },
    [actions.writable],
  )

  const siblingsOf = useCallback(
    (dir: string): string[] => (root?.dirs[dir]?.entries ?? []).map((entry) => entry.name),
    [root],
  )

  const renderInline = useCallback(
    ({ depth, kind, renamePath }: InlineRenderProps): ReactElement => {
      if (renamePath !== undefined) {
        const name = baseName(renamePath)
        return (
          <InlineNameRow
            key={`rename:${renamePath}`}
            depth={depth}
            kind={kind}
            initialValue={name}
            current={name}
            siblings={siblingsOf(parentPath(renamePath))}
            onCommit={async (next) => {
              try {
                await actions.rename(renamePath, next)
              } catch (error) {
                return commitError(error, next)
              }
              close()
              return null
            }}
            onCancel={close}
          />
        )
      }
      const parentDir = inlineEdit?.mode === 'create' ? inlineEdit.parentDir : ''
      return (
        <InlineNameRow
          key={`create:${parentDir}:${kind}`}
          depth={depth}
          kind={kind}
          initialValue=""
          siblings={siblingsOf(parentDir)}
          onCommit={async (name) => {
            try {
              await actions.create(parentDir, name, kind)
            } catch (error) {
              return commitError(error, name)
            }
            close()
            return null
          }}
          onCancel={close}
        />
      )
    },
    [actions, close, inlineEdit, siblingsOf],
  )

  const projected = useMemo(() => withInlineRow(rows, inlineEdit), [rows, inlineEdit])

  return { inlineEdit, rows: projected, startCreate, startRename, renderInline }
}
