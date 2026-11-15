// The explorer body of the work dock's Files tab (PAN-5186, WI-B12; FR-1 to
// FR-5, FR-19, FR-20; PAN-5289 §6.8).
//
// `ExplorerFiles` shows one explorer root: a project checkout, an issue
// workspace or a workspace. It lists directories lazily, follows the watch
// stream, colors rows from git status, and opens files as 'code' panes beside
// the chat through the deck's openBeside (B-D3). The Changed filter replaces
// the old changed-files list: it shows a tree synthesized from git status
// (D-B8). Go to file and content search belong to the dock.

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronsDownUp, FilePlus, MoreHorizontal } from 'lucide-react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'

import { MenuItemButton, MenuOverlay, MenuSeparator, MenuSurface } from '../shared/ContextMenu'
import { useStageDeck } from '../Stage/StageDeckContext'
import { findRegisteredProject } from '../CommandDeck/UnknownProjectState'
import { useActiveDock } from '../dock/activeDock'
import { useWorkDockStore } from '../dock/workDockStore'
import { useDeleteFlow } from './actions/useDeleteFlow'
import { useExplorerActions } from './actions/useExplorerActions'
import { useInlineEdit } from './actions/useInlineEdit'
import { snapshotDroppedItems, uploadDroppedItems } from './actions/useOsFileDrop'
import { useTreeActionKeys } from './actions/useTreeActionKeys'
import { startRowDrag, useTreeDropZone } from './actions/useTreeDragMove'
import { explorerErrorMessage, listDir, parseRootId } from './explorer-rpc'
import { useExplorerStore, type RootState, type SelectMode } from './explorerStore'
import { useExplorerGitStatus } from './git/useExplorerGitStatus'
import { ExplorerContextMenu, type ExplorerMenuTarget } from './menu/ExplorerContextMenu'
import { EditWorkspaceBanner } from './edit/EditWorkspaceBanner'
import { useEditWorkspaceStore } from './edit/edit-workspace-store'
import { openCodePane, type CodePaneTarget } from './openCodePane'
import { useRootContext, useRootLabel } from './rootForConversation'
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

const HeaderButton = forwardRef<HTMLButtonElement, { label: string; onClick(): void; disabled?: boolean; children: ReactNode }>(function HeaderButton(
  { label, onClick, disabled, children },
  ref,
) {
  return (
    <button
      ref={ref}
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
})

/** The tree filter (B-D12): every file, the git-status tree, or what the scoped conversation changed. */
type FilesFilter = 'all' | 'changed' | 'mine'

const FILTER_LINE: Record<Exclude<FilesFilter, 'all'>, string> = {
  changed: 'Showing changed files',
  mine: 'Showing files this conversation changed',
}

function CheckMark({ on }: { on: boolean }) {
  return <Check className={`h-3.5 w-3.5 shrink-0 ${on ? '' : 'invisible'}`} aria-hidden />
}

interface ViewOptionsProps {
  filter: FilesFilter
  conversationScope: boolean
  notGit: boolean
  showIgnored: boolean
  showDotfiles: boolean
  writable: boolean
  expanding: boolean
  onFilter(filter: FilesFilter): void
  onShowIgnored(show: boolean): void
  onShowDotfiles(show: boolean): void
  onNewFolder(): void
  onExpandAll(): void
  onRefresh(): void
}

/** The ⋯ View options menu of the Files header (B-D12, §6.9). */
function ViewOptionsMenu(props: ViewOptionsProps) {
  const { filter, conversationScope, notGit, showIgnored, showDotfiles, writable, expanding } = props
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null)
  const close = () => setPosition(null)
  const run = (action: () => void) => () => {
    close()
    action()
  }
  const toggleOpen = () => {
    if (position) return close()
    const rect = buttonRef.current?.getBoundingClientRect()
    setPosition({ top: (rect?.bottom ?? 0) + 4, right: Math.max(8, window.innerWidth - (rect?.right ?? 0)) })
  }
  const radio = (value: FilesFilter, label: string, disabledReason?: string) => (
    <MenuItemButton
      role="menuitemradio"
      aria-checked={filter === value}
      disabled={disabledReason !== undefined}
      title={disabledReason}
      onClick={run(() => props.onFilter(value))}
    >
      <CheckMark on={filter === value} />
      {label}
    </MenuItemButton>
  )
  return (
    <>
      <HeaderButton ref={buttonRef} label="View options" onClick={toggleOpen}>
        <MoreHorizontal className="h-3.5 w-3.5" />
      </HeaderButton>
      {position &&
        createPortal(
          <>
            <MenuOverlay onClick={close} />
            <MenuSurface
              aria-label="View options"
              onClose={close}
              returnFocusRef={buttonRef}
              className="fixed z-[1000] min-w-[230px]"
              style={{ position: 'fixed', top: position.top, right: position.right }}
            >
              {radio('all', 'Show all files')}
              {radio('changed', 'Only changed files', notGit ? 'Not a git repository' : undefined)}
              {conversationScope && radio('mine', 'Only what this conversation changed')}
              <MenuSeparator />
              <MenuItemButton role="menuitemcheckbox" aria-checked={showIgnored} onClick={run(() => props.onShowIgnored(!showIgnored))}>
                <CheckMark on={showIgnored} />
                Show git-ignored files
              </MenuItemButton>
              <MenuItemButton role="menuitemcheckbox" aria-checked={showDotfiles} onClick={run(() => props.onShowDotfiles(!showDotfiles))}>
                <CheckMark on={showDotfiles} />
                Show dotfiles
              </MenuItemButton>
              <MenuSeparator />
              {writable && (
                <MenuItemButton onClick={run(props.onNewFolder)}>
                  <CheckMark on={false} />
                  New folder
                </MenuItemButton>
              )}
              <MenuItemButton disabled={expanding || filter !== 'all'} onClick={run(props.onExpandAll)}>
                <CheckMark on={false} />
                Expand all folders
              </MenuItemButton>
              <MenuItemButton onClick={run(props.onRefresh)}>
                <CheckMark on={false} />
                Refresh
              </MenuItemButton>
            </MenuSurface>
          </>,
          document.body,
        )}
    </>
  )
}

/** The Files header root name: a menu that pins the dock to a root or follows the active tab (§6.9, FR-2). */
function RootMenu({ deckKey, label }: { deckKey: string; label: string }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const rootContext = useRootContext()
  const override = useWorkDockStore((s) => s.byDeck[deckKey]?.rootOverride)
  const deckProject = findRegisteredProject(rootContext.projects, deckKey)
  const workspaces = deckProject ? rootContext.workspaces.filter((w) => w.kind === 'scratch' && w.projectId === deckProject.key) : []
  const close = () => setPosition(null)
  const pick = (rootId: string | undefined) => {
    close()
    // B-D17: an override belongs to the tab that was active when it was set.
    const anchor = useActiveDock.getState().current?.activePaneId ?? undefined
    useWorkDockStore.getState().setRootOverride(deckKey, rootId, rootId === undefined ? undefined : anchor)
  }
  const toggleOpen = () => {
    if (position) return close()
    const rect = buttonRef.current?.getBoundingClientRect()
    setPosition({ top: (rect?.bottom ?? 0) + 4, left: rect?.left ?? 0 })
  }
  const item = (rootId: string | undefined, text: string) => (
    <MenuItemButton role="menuitemradio" aria-checked={override === rootId} onClick={() => pick(rootId)}>
      <CheckMark on={override === rootId} />
      {text}
    </MenuItemButton>
  )
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={position !== null}
        title="Choose which files the panel shows"
        onClick={toggleOpen}
        className="flex min-w-0 items-center gap-1 rounded px-1 font-mono text-foreground hover:bg-accent"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {position &&
        createPortal(
          <>
            <MenuOverlay onClick={close} />
            <MenuSurface
              aria-label="Files root"
              onClose={close}
              returnFocusRef={buttonRef}
              className="fixed z-[1000] min-w-[220px]"
              style={{ position: 'fixed', top: position.top, left: position.left }}
            >
              {item(undefined, 'Follow the active tab')}
              {deckProject && item(`project:${deckProject.key}`, 'Main checkout')}
              {workspaces.map((w) => {
                const rootId = `workspace:${w.id}`
                return (
                  <MenuItemButton key={w.id} role="menuitemradio" aria-checked={override === rootId} onClick={() => pick(rootId)}>
                    <CheckMark on={override === rootId} />
                    {w.name}
                  </MenuItemButton>
                )
              })}
            </MenuSurface>
          </>,
          document.body,
        )}
    </>
  )
}

export interface ExplorerFilesProps {
  rootId: string
  deckKey: string
  /** Root paths the scoped conversation changed (dot, "Only what this conversation changed"). */
  changedPaths: ReadonlySet<string>
  /** True when the scope is a conversation: offers the "Only what this conversation changed" item. */
  conversationScope: boolean
  /** Root path to reveal and select (active code pane). */
  revealPath?: string
  onFindInFolder(dirPath: string): void
}

export function ExplorerFiles({ rootId, deckKey, changedPaths: scopeChangedPaths, conversationScope, revealPath, onFindInFolder }: ExplorerFilesProps) {
  const parsed = parseRootId(rootId)
  const rootKind = parsed?.kind ?? 'workspace'
  const root: RootState | undefined = useExplorerStore((s) => s.roots[rootId])
  const loaderRef = useRef<DirectoryLoader | null>(null)
  const treeRef = useRef<HTMLDivElement | null>(null)
  const git = useExplorerGitStatus(rootId)
  const deck = useStageDeck()
  const [expanding, setExpanding] = useState(false)
  const label = useRootLabel(rootId) ?? rootId

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
  const showIgnored = root?.showIgnored ?? false
  const notGit = git.errorCode === 'NOT_A_GIT_REPO'
  // 'changed' is the store's changedOnly; 'mine' needs a conversation scope.
  const [filterChoice, setFilterChoice] = useState<FilesFilter>(() => (root?.changedOnly ? 'changed' : 'all'))
  const filter: FilesFilter = filterChoice === 'mine' && !conversationScope ? 'all' : filterChoice
  const changedOnly = filter !== 'all'
  const setFilter = useCallback(
    (next: FilesFilter) => {
      setFilterChoice(next)
      useExplorerStore.getState().setChangedOnly(rootId, next === 'changed')
    },
    [rootId],
  )

  const rows: ExplorerTreeItem[] = useMemo(() => {
    if (!root) return []
    if (filter === 'changed') {
      const changed = [...git.decorations.files].map(([path, d]) => ({ path, isDeleted: d.status === 'deleted' }))
      return projectChangedRows(changed, showDotfiles)
    }
    if (filter === 'mine') return projectChangedRows([...scopeChangedPaths].map((path) => ({ path, isDeleted: false })), showDotfiles)
    return projectRows({ dirs: root.dirs, expanded: new Set(root.expanded), showDotfiles, showIgnored })
  }, [root, filter, git.decorations, scopeChangedPaths, showDotfiles, showIgnored])

  // The active code pane's file: open its folders and select it.
  useEffect(() => {
    if (revealPath) useExplorerStore.getState().revealPath(rootId, revealPath)
  }, [rootId, revealPath])

  const treeRows = useMemo(() => rows.filter((r): r is TreeRow => !isTruncatedRow(r)), [rows])
  const visibleOrder = useMemo(() => treeRows.map((r) => r.path), [treeRows])
  const rowByPath = useMemo(() => new Map(treeRows.map((r) => [r.path, r])), [treeRows])

  // Open a file beside the chat (B-D3); with no deck, open it as a code pane.
  const openFile = useCallback(
    (target: CodePaneTarget) => {
      if (deck?.openBeside) deck.openBeside({ rootId: target.rootId, path: target.path, line: target.line, preview: target.preview })
      else openCodePane(deckKey, target)
    },
    [deck, deckKey],
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
  // PAN-5191: a write on a project root lands on the edit root, so actions open files on the root they wrote.
  const openFileOnRoot = useCallback(
    (path: string, id: string) => {
      cancelPreview()
      openFile({ rootId: id, path })
    },
    [cancelPreview, openFile],
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

  // PAN-5191: the edit-workspace banner's inputs, from this root's git status.
  const uncommittedPaths = useMemo(() => (git.result?.entries ?? []).map((e) => e.path), [git.result])
  const changedPaths = useMemo(
    () => [...new Set([...uncommittedPaths, ...(git.result?.committed ?? []).map((e) => e.path)])],
    [uncommittedPaths, git.result],
  )
  const creatingEdit = useEditWorkspaceStore((s) => (parsed?.kind === 'project' ? s.creating[parsed.key] === true : false))
  // PAN-5191: project roots are writable through an edit workspace; the Changed filter still hides write actions.
  const writable = !changedOnly
  const actions = useExplorerActions({ rootId, writable, reloadDirs: reloadLoaded, refreshGit: git.refresh, openFile: openFileOnRoot })
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
      if (changedOnly) toast.error('Show all files to add files here.')
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
        onFindInFolder={onFindInFolder}
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
            aria-label={`Files in ${label}`}
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
    <div className="flex h-full min-h-0 flex-col" data-testid="explorer-pane">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <RootMenu deckKey={deckKey} label={label} />
        {branch && <span className="min-w-0 truncate font-mono text-muted-foreground">{branch}</span>}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {writable && (
            <HeaderButton label="New file" onClick={() => inline.startCreate('file')}>
              <FilePlus className="h-3.5 w-3.5" />
            </HeaderButton>
          )}
          <HeaderButton label="Collapse all" onClick={() => useExplorerStore.getState().collapseAll(rootId)} disabled={changedOnly}>
            <ChevronsDownUp className="h-3.5 w-3.5" />
          </HeaderButton>
          <ViewOptionsMenu
            filter={filter}
            conversationScope={conversationScope}
            notGit={notGit}
            showIgnored={showIgnored}
            showDotfiles={showDotfiles}
            writable={writable}
            expanding={expanding}
            onFilter={setFilter}
            onShowIgnored={(show) => useExplorerStore.getState().setShowIgnored(rootId, show)}
            onShowDotfiles={(show) => useExplorerStore.getState().setShowDotfiles(rootId, show)}
            onNewFolder={() => inline.startCreate('dir')}
            onExpandAll={() => void onExpandAll()}
            onRefresh={onRefresh}
          />
        </div>
      </div>
      {filter !== 'all' && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1 text-[11px] text-muted-foreground" data-testid="explorer-filter-line">
          <span>{FILTER_LINE[filter]}</span>
          <button type="button" className="ml-auto rounded px-1.5 text-foreground hover:bg-accent" onClick={() => setFilter('all')}>
            Show all
          </button>
        </div>
      )}
      {notGit && <div className="border-b border-border px-3 py-1 text-[11px] text-muted-foreground">Not a git repository, so files show no git colors.</div>}
      {git.result?.truncated && (
        <div className="border-b border-border px-3 py-1 text-[11px] text-muted-foreground">Git status shows the first 20,000 changes.</div>
      )}
      {parsed?.kind === 'workspace' && (
        <EditWorkspaceBanner
          rootId={rootId}
          deckKey={deckKey}
          changedPaths={changedPaths}
          hasChanges={uncommittedPaths.length > 0}
          uncommittedPaths={uncommittedPaths}
          onGitChanged={git.refresh}
        />
      )}
      {rootKind === 'project' && creatingEdit && (
        <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground" data-testid="explorer-creating-edit">
          Creating edit workspace…
        </div>
      )}
      {zonedBody}
    </div>
  )
}
