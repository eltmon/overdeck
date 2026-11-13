// The explorer pane: the Stage 'files' pane (PAN-5186, WI-B12; FR-1 to FR-5,
// FR-19, FR-20).
//
// One pane shows one explorer root (`pane.explorerRootId`): a project
// checkout, an issue workspace or a workspace. It lists directories lazily,
// follows the watch stream, colors rows from git status, and opens files as
// 'code' panes (rendered by PAN-5187). The Changed filter replaces the old
// changed-files list: it shows a tree synthesized from git status (D-B8).

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ChevronsDownUp, ChevronsUpDown, Eye, EyeOff, FilePlus, FolderPlus, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { useStageDeck } from '../Stage/StageDeckContext'
import type { PaneWrapperProps } from '../Stage/types'
import { useDeleteFlow } from './actions/useDeleteFlow'
import { useExplorerActions } from './actions/useExplorerActions'
import { useInlineEdit } from './actions/useInlineEdit'
import { snapshotDroppedItems, uploadDroppedItems } from './actions/useOsFileDrop'
import { useTreeActionKeys } from './actions/useTreeActionKeys'
import { startRowDrag, useTreeDropZone } from './actions/useTreeDragMove'
import { explorerErrorMessage, listDir, parseRootId, rootLabel } from './explorer-rpc'
import { useExplorerStore, type RootState, type SelectMode } from './explorerStore'
import { useExplorerGitStatus } from './git/useExplorerGitStatus'
import { ExplorerContextMenu, type ExplorerMenuTarget } from './menu/ExplorerContextMenu'
import { openCodePane, type CodePaneTarget } from './openCodePane'
import { ContentSearch, type ContentSearchTarget } from './search/ContentSearch'
import { QuickOpen } from './search/QuickOpen'
import { useExplorerShortcuts } from './search/useExplorerShortcuts'
import { createDirectoryLoader, expandAll, type DirectoryLoader } from './tree/directory-loader'
import { ExplorerTree } from './tree/ExplorerTree'
import {
  baseName,
  isTruncatedRow,
  parentPath,
  projectChangedRows,
  projectRows,
  type ExplorerTreeItem,
  type TreeRow,
} from './tree/explorer-tree-model'
import { useExplorerWatch } from './watch/useExplorerWatch'

const EXPAND_ALL_CAP = 2000
const NO_ROOT_MESSAGE = 'This Files pane has no root. Close it and open Files again.'

/** How long a single click waits before opening the preview tab, so a double click can win. */
export const PREVIEW_OPEN_DELAY_MS = 250

/** True when every ancestor folder of `path` is in `expanded`. */
function ancestorsExpanded(path: string, expanded: ReadonlySet<string>): boolean {
  for (let p = parentPath(path); p !== ''; p = parentPath(p)) {
    if (!expanded.has(p)) return false
  }
  return true
}

function PaneMessage({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">{children}</div>
}

function HeaderButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick(): void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}

export function ExplorerPane({ pane, ctx }: PaneWrapperProps) {
  const rootId = pane.explorerRootId
  if (!rootId) {
    return (
      <div className="flex h-full flex-col">
        <PaneMessage>{NO_ROOT_MESSAGE}</PaneMessage>
      </div>
    )
  }
  return <ExplorerPaneBody key={rootId} rootId={rootId} deckKey={ctx.workspaceId} paneId={pane.paneId} />
}

function ExplorerPaneBody({ rootId, deckKey, paneId }: { rootId: string; deckKey: string; paneId: string }) {
  const parsed = parseRootId(rootId)
  const rootKind = parsed?.kind ?? 'workspace'
  const root: RootState | undefined = useExplorerStore((s) => s.roots[rootId])
  const loaderRef = useRef<DirectoryLoader | null>(null)
  const treeRef = useRef<HTMLDivElement | null>(null)
  const git = useExplorerGitStatus(rootId)
  const deck = useStageDeck()
  const [expanding, setExpanding] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  // null = closed; otherwise the folder scope ('' = the whole root).
  const [contentSearchScope, setContentSearchScope] = useState<string | null>(null)

  // Create the loader, list the root, and re-list every persisted expanded
  // folder whose ancestors are open (a remount refreshes stale listings).
  useEffect(() => {
    const store = useExplorerStore.getState()
    store.ensureRoot(rootId)
    const loader = createDirectoryLoader({
      rootId,
      listDir,
      onLoading: (path) => {
        const current = useExplorerStore.getState().roots[rootId]?.dirs[path]
        // Keep a ready listing on screen while it is re-listed.
        if (!current || current.status === 'error') {
          useExplorerStore.getState().setDir(rootId, path, { status: 'loading', entries: [], truncated: false, absPath: null })
        }
      },
      onResult: (path, result) => {
        useExplorerStore.getState().setDir(rootId, path, {
          status: 'ready',
          entries: result.entries,
          truncated: result.truncated,
          absPath: result.absPath,
        })
      },
      onError: (path, code, message) => {
        const s = useExplorerStore.getState()
        if (code === 'NOT_FOUND' && path !== '') {
          // A folder that is gone leaves the tree and the expanded set.
          s.removeDir(rootId, path)
          s.setExpanded(rootId, path, false)
          loader.forget(path)
          return
        }
        s.setDir(rootId, path, { status: 'error', entries: [], truncated: false, absPath: null, errorCode: code, errorMessage: message })
      },
    })
    loaderRef.current = loader
    loader.ensure('')
    const current = useExplorerStore.getState().roots[rootId]
    const expanded = current?.expanded ?? []
    const open = new Set(expanded)
    const reachable = new Set([''])
    for (const path of expanded) {
      if (!ancestorsExpanded(path, open)) continue
      reachable.add(path)
      loader.ensure(path)
    }
    // While the pane was unmounted no watch events arrived, so a cached
    // listing of a collapsed folder may be stale: drop it, and it re-lists
    // when the folder opens again.
    for (const path of Object.keys(current?.dirs ?? {})) {
      if (!reachable.has(path)) useExplorerStore.getState().removeDir(rootId, path)
    }
    return () => {
      loader.dispose()
      if (loaderRef.current === loader) loaderRef.current = null
    }
  }, [rootId])

  // A folder that opens (a click, Expand all) loads when it has no listing.
  const expanded = root?.expanded
  useEffect(() => {
    if (!expanded) return
    const dirs = useExplorerStore.getState().roots[rootId]?.dirs ?? {}
    const open = new Set(expanded)
    for (const path of expanded) {
      if (dirs[path]?.status !== 'ready' && ancestorsExpanded(path, open)) loaderRef.current?.ensure(path)
    }
  }, [expanded, rootId])

  const reloadLoaded = useCallback(
    (only?: readonly string[]) => {
      const dirs = useExplorerStore.getState().roots[rootId]?.dirs ?? {}
      const paths = only ? only.filter((p) => p in dirs) : Object.keys(dirs)
      loaderRef.current?.reload(paths)
    },
    [rootId],
  )

  useExplorerWatch(rootId, {
    onDirsChanged: (dirs) => reloadLoaded(dirs),
    onResync: () => reloadLoaded(),
  })

  const showDotfiles = root?.showDotfiles ?? true
  const changedOnly = root?.changedOnly ?? false
  const notGit = git.errorCode === 'NOT_A_GIT_REPO'

  const rows: ExplorerTreeItem[] = useMemo(() => {
    if (!root) return []
    if (changedOnly) {
      const changed = [...git.decorations.files].map(([path, d]) => ({ path, isDeleted: d.status === 'deleted' }))
      return projectChangedRows(changed, showDotfiles)
    }
    return projectRows({ dirs: root.dirs, expanded: new Set(root.expanded), showDotfiles })
  }, [root, changedOnly, git.decorations, showDotfiles])

  const treeRows = useMemo(() => rows.filter((r): r is TreeRow => !isTruncatedRow(r)), [rows])
  const visibleOrder = useMemo(() => treeRows.map((r) => r.path), [treeRows])
  const rowByPath = useMemo(() => new Map(treeRows.map((r) => [r.path, r])), [treeRows])

  // Open a file and, while the deck is split, put it in a region beside this
  // explorer rather than only activating its tab.
  const openFile = useCallback(
    (target: CodePaneTarget) => {
      const id = openCodePane(deckKey, target)
      deck?.revealPane?.(id, paneId)
    },
    [deck, deckKey, paneId],
  )
  // D-B2 seam: a double click, Enter or quick open opens a permanent pane; a
  // single click opens the root's preview pane (PAN-5187, D-C22). The preview
  // waits out the double-click interval: in an unsplit deck opening it
  // activates the code tab, which would hide the tree before the second click
  // of a double click could land and pin the file.
  const pendingPreview = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelPreview = useCallback(() => {
    if (pendingPreview.current !== null) clearTimeout(pendingPreview.current)
    pendingPreview.current = null
  }, [])
  useEffect(() => cancelPreview, [cancelPreview])
  const openFileFromTree = useCallback(
    (path: string) => {
      cancelPreview()
      openFile({ rootId, path })
    },
    [cancelPreview, openFile, rootId],
  )
  const previewFileFromTree = useCallback(
    (path: string) => {
      cancelPreview()
      pendingPreview.current = setTimeout(() => {
        pendingPreview.current = null
        openFile({ rootId, path, preview: true })
      }, PREVIEW_OPEN_DELAY_MS)
    },
    [cancelPreview, openFile, rootId],
  )

  // PAN-5190 D-E1, D-E2: write actions only on issue/workspace roots with the Changed filter off.
  const writable = rootKind !== 'project' && !changedOnly
  const actions = useExplorerActions({ rootId, writable, reloadDirs: reloadLoaded, refreshGit: git.refresh, openFile: openFileFromTree })
  const inline = useInlineEdit({ rootId, root, rows, actions, treeRef })
  const clearSelection = useCallback(() => useExplorerStore.getState().clearSelection(rootId), [rootId])
  const requestDelete = useDeleteFlow(actions, rootId)
  const onDuplicate = useCallback(
    (path: string) => {
      const siblings = useExplorerStore.getState().roots[rootId]?.dirs[parentPath(path)]?.entries ?? []
      void actions.duplicate(path, siblings.map((e) => e.name))
    },
    [actions, rootId],
  )
  const dropZone = useTreeDropZone({
    rootId,
    writable,
    changedOnly,
    getRow: (path) => rowByPath.get(path),
    expand: (path) => useExplorerStore.getState().setExpanded(rootId, path, true),
    onMove: (paths, dir) => void actions.move(paths, dir),
    onFiles: (dt, dir) => {
      if (rootKind === 'project') toast.error("The main checkout is read-only, so files can't be added here.")
      else if (changedOnly) toast.error('Turn off the Changed filter to add files.')
      else void uploadDroppedItems(snapshotDroppedItems(dt), dir, actions)
    },
  })
  const onRowDragStart = useCallback(
    (event: DragEvent, row: TreeRow) =>
      startRowDrag(event.dataTransfer, rootId, row.path, useExplorerStore.getState().roots[rootId]?.selection ?? []),
    [rootId],
  )
  const onTreeKeyDown = useTreeActionKeys({
    writable,
    isProjectRoot: rootKind === 'project',
    getSelection: useCallback(() => useExplorerStore.getState().roots[rootId]?.selection ?? [], [rootId]),
    startRename: inline.startRename,
    requestDelete: useCallback((paths: readonly string[]) => void requestDelete(paths), [requestDelete]),
    undo: actions.undo,
    redo: actions.redo,
  })

  const onQuickOpen = useCallback(() => setQuickOpen(true), [])
  const onContentSearch = useCallback(() => setContentSearchScope(''), [])
  const onKeyDown = useExplorerShortcuts({ onQuickOpen, onContentSearch })
  const onPickMatch = useCallback((target: ContentSearchTarget) => openFile({ rootId, ...target }), [openFile, rootId])

  const onToggle = useCallback(
    (path: string) => {
      const s = useExplorerStore.getState()
      const current = s.roots[rootId]
      if (!current || current.changedOnly) return
      s.setExpanded(rootId, path, !current.expanded.includes(path))
    },
    [rootId],
  )
  const onSelect = useCallback(
    (path: string, mode: SelectMode) => useExplorerStore.getState().select(rootId, path, mode, visibleOrder),
    [rootId, visibleOrder],
  )
  const onFocus = useCallback((path: string) => useExplorerStore.getState().setFocused(rootId, path), [rootId])
  const onContextMenuRow = useCallback(
    (path: string) => {
      const current = useExplorerStore.getState().roots[rootId]
      if (!current?.selection.includes(path)) useExplorerStore.getState().select(rootId, path, 'replace', visibleOrder)
    },
    [rootId, visibleOrder],
  )

  const targets: ExplorerMenuTarget[] = useMemo(() => {
    if (!root) return []
    const rootAbs = root.dirs['']?.absPath ?? null
    return root.selection.map((path) => {
      const parentAbs = root.dirs[parentPath(path)]?.absPath ?? null
      const absPath = parentAbs ? `${parentAbs}/${baseName(path)}` : rootAbs ? `${rootAbs}/${path}` : null
      return { path, kind: rowByPath.get(path)?.kind ?? 'file', absPath }
    })
  }, [root, rowByPath])

  const onRefresh = () => {
    reloadLoaded()
    git.refresh()
  }

  const onExpandAll = async () => {
    // The run belongs to this mount's loader: listings share its 4-call queue
    // and its writes, and after an unmount (dispose) nothing more is written.
    const loader = loaderRef.current
    if (!loader) return
    setExpanding(true)
    try {
      const result = await expandAll({
        start: '',
        showDotfiles,
        cap: EXPAND_ALL_CAP,
        load: async (path) => {
          const existing = useExplorerStore.getState().roots[rootId]?.dirs[path]
          if (existing?.status === 'ready') return existing.entries
          return (await loader.load(path)).entries
        },
      })
      if (loaderRef.current !== loader) return
      useExplorerStore.getState().setExpandedMany(rootId, result.expanded)
      if (result.capped) toast('Expanded the first 2,000 folders.')
    } catch (e) {
      if (loaderRef.current === loader) toast.error(`Couldn't expand all: ${explorerErrorMessage(e)}`)
    } finally {
      if (loaderRef.current === loader) setExpanding(false)
    }
  }

  const rootDir = root?.dirs['']
  let body: ReactNode
  if (rootDir?.status === 'error') {
    if (rootDir.errorCode === 'ROOT_NOT_FOUND') {
      body = (
        <PaneMessage>
          {parsed?.kind === 'issue' ? `No workspace on disk for ${parsed.key}. Start the issue to create one.` : 'This root no longer exists.'}
        </PaneMessage>
      )
    } else {
      body = (
        <PaneMessage>
          <span>Couldn't list files: {rootDir.errorMessage ?? rootDir.errorCode ?? 'unknown error'}</span>
          <button
            type="button"
            onClick={() => loaderRef.current?.reload([''])}
            className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
          >
            Retry
          </button>
        </PaneMessage>
      )
    }
  } else if (!changedOnly && rootDir?.status !== 'ready') {
    body = <PaneMessage>Loading files…</PaneMessage>
  } else if (inline.rows.length === 0 && changedOnly) {
    body = <PaneMessage>No changes.</PaneMessage>
  } else {
    body = (
      <ExplorerContextMenu
        rootId={rootId}
        rootKind={rootKind}
        targets={targets}
        decorations={git.decorations}
        onOpen={openFileFromTree}
        onFindInFolder={(dirPath) => setContentSearchScope(dirPath)}
        onGitChanged={git.refresh}
        writable={writable}
        onNewFile={() => inline.startCreate('file')}
        onNewFolder={() => inline.startCreate('dir')}
        onRename={inline.startRename}
        onDuplicate={onDuplicate}
        onDelete={(paths) => void requestDelete(paths)}
      >
        {inline.rows.length === 0 ? (
          // An empty root still opens the menu, so New file and New folder are reachable.
          <div
            tabIndex={-1}
            onContextMenu={clearSelection}
            className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground outline-none"
          >
            This folder is empty.
          </div>
        ) : (
          <ExplorerTree
            ref={treeRef}
            aria-label={`Files in ${rootLabel(rootId)}`}
            rows={inline.rows}
            inlineEdit={inline.inlineEdit}
            renderInline={inline.renderInline}
            onContextMenuBlank={clearSelection}
            onKeyDown={onTreeKeyDown}
            onRowDragStart={onRowDragStart}
            dropDir={dropZone.dropDir}
            decorations={git.decorations}
            selection={root?.selection ?? []}
            focused={root?.focused ?? null}
            onToggle={onToggle}
            onSelect={onSelect}
            onOpen={openFileFromTree}
            onPreview={previewFileFromTree}
            onFocus={onFocus}
            onContextMenuRow={onContextMenuRow}
          />
        )}
      </ExplorerContextMenu>
    )
  }

  // The drop zone wraps the tree body and the empty-folder message (D-E10, D-E14).
  const zonedBody = (
    <div
      {...dropZone.zoneProps}
      className={`flex min-h-0 flex-1 flex-col ${dropZone.dropDir === '' ? 'ring-1 ring-inset ring-ring' : ''}`}
    >
      {body}
    </div>
  )

  const branch = git.result?.branch

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="explorer-pane" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="truncate font-mono text-foreground">{rootLabel(rootId)}</span>
        {branch && <span className="min-w-0 truncate font-mono text-muted-foreground">{branch}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <HeaderButton
            label={showDotfiles ? 'Hide dotfiles' : 'Show dotfiles'}
            onClick={() => useExplorerStore.getState().setShowDotfiles(rootId, !showDotfiles)}
          >
            {showDotfiles ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </HeaderButton>
          <button
            type="button"
            aria-pressed={changedOnly}
            disabled={notGit}
            title={notGit ? 'Not a git repository' : 'Show only changed files'}
            onClick={() => useExplorerStore.getState().setChangedOnly(rootId, !changedOnly)}
            className={`h-6 rounded px-2 transition-colors disabled:pointer-events-none disabled:opacity-40 ${
              changedOnly ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            Changed
          </button>
          {writable && (
            <>
              <HeaderButton label="New file" onClick={() => inline.startCreate('file')}>
                <FilePlus className="h-3.5 w-3.5" />
              </HeaderButton>
              <HeaderButton label="New folder" onClick={() => inline.startCreate('dir')}>
                <FolderPlus className="h-3.5 w-3.5" />
              </HeaderButton>
            </>
          )}
          <HeaderButton label="Refresh" onClick={onRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />
          </HeaderButton>
          <HeaderButton label="Expand all" onClick={() => void onExpandAll()} disabled={expanding || changedOnly}>
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </HeaderButton>
          <HeaderButton label="Collapse all" onClick={() => useExplorerStore.getState().collapseAll(rootId)} disabled={changedOnly}>
            <ChevronsDownUp className="h-3.5 w-3.5" />
          </HeaderButton>
        </div>
      </div>
      {notGit && <div className="border-b border-border px-3 py-1 text-[11px] text-muted-foreground">Not a git repository, so files show no git colors.</div>}
      {git.result?.truncated && (
        <div className="border-b border-border px-3 py-1 text-[11px] text-muted-foreground">Git status shows the first 20,000 changes.</div>
      )}
      {/* PAN-5191 edit-workspace banner slot */}
      {contentSearchScope === null ? (
        zonedBody
      ) : (
        <>
          {/* The tree keeps the upper half; search takes the lower half. */}
          <div className="flex min-h-0 flex-1 flex-col">{zonedBody}</div>
          <ContentSearch
            rootId={rootId}
            scopePath={contentSearchScope || undefined}
            onScopeClear={() => setContentSearchScope('')}
            onClose={() => setContentSearchScope(null)}
            onPick={onPickMatch}
          />
        </>
      )}
      <QuickOpen rootId={rootId} open={quickOpen} onClose={() => setQuickOpen(false)} onPick={openFileFromTree} />
    </div>
  )
}
