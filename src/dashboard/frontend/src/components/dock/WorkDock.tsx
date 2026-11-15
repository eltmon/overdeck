// The work dock beside the Stage pane area (PAN-5289 §6.3, B-D2).
//
// One dock per deck, full Stage height, with Files, Changes, Search and Live
// tabs. Its root follows the active Stage pane through deriveDockScope (§6.2);
// a root override applies only while its anchor pane is active (B-D17), and
// nothing here clears one on a tab change. While mounted the dock registers the
// four global shortcuts (B-D4) and publishes itself in activeDock for the
// Ctrl K palette (B-D5). Closed, it renders a 0-width element so the shortcuts
// and Go to file still work. It must not import Stage/index.tsx; it reaches
// the deck through useStageDeck().

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { FolderTree, GitCompare, Home, MessageSquare, Pencil, Radio, Search, CircleDot, X, type LucideIcon } from 'lucide-react'

import type { WorkspacePane } from '../../lib/panesStore'
import type { Conversation } from '../CommandDeck/ConversationList'
import { useRootContext, useRootLabel } from '../explorer/rootForConversation'
import { useExplorerShortcuts } from '../explorer/search/useExplorerShortcuts'
import { useStageDeck } from '../Stage/StageDeckContext'
import { useActiveDock } from './activeDock'
import { ChangesTab, useChangesCount } from './ChangesTab'
import { DockQuickOpen } from './DockQuickOpen'
import { deriveDockScope, type DockHeader, type DockScope } from './dockScope'
import { FilesTab } from './FilesTab'
import { LiveTab, useLiveTab } from './LiveTab'
import { SearchTab } from './SearchTab'
import { useScopeChangedPaths } from './useConversationChanges'
import { DOCK_MAX_WIDTH, DOCK_MIN_WIDTH, useWorkDockStore, type DockTab } from './workDockStore'

export interface WorkDockProps {
  deckKey: string
  activePane: WorkspacePane | null
  layoutLeafIds: readonly string[]
  panesById: ReadonlyMap<string, WorkspacePane>
  conversations: readonly Conversation[]
}

const NULL_ROOT_MESSAGE = {
  linked: "This conversation's files are not on this machine",
  outside: "This conversation's folder is outside the project",
  'no-project': 'No project is selected, so there are no files to show.',
} as const

function clampWidth(width: number): number {
  return Math.round(Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, width)))
}

const HEADER_ICON: Record<DockHeader['kind'], LucideIcon> = {
  conversation: MessageSquare,
  issue: CircleDot,
  workspace: Pencil,
  project: Home,
  none: FolderTree,
}

function ScopeText({ header, rootLabel }: { header: DockHeader; rootLabel: string | null }): ReactNode {
  const label = rootLabel ?? ''
  switch (header.kind) {
    case 'conversation':
      return (
        <>
          For <b className="font-medium text-foreground">{header.title}</b>
          {rootLabel ? ` · ${rootLabel}` : ''}
          {header.branch ? ` · ${header.branch}` : ''}
        </>
      )
    case 'issue':
      return (
        <>
          Issue <b className="font-medium text-foreground">{label}</b>
        </>
      )
    case 'workspace':
      return (
        <>
          Edit workspace <b className="font-medium text-foreground">{label}</b>
        </>
      )
    case 'project':
      return (
        <>
          Project <b className="font-medium text-foreground">{label}</b> · main checkout
        </>
      )
    default:
      return 'No project'
  }
}

export function WorkDock({ deckKey, activePane, layoutLeafIds, panesById, conversations }: WorkDockProps) {
  const deck = useStageDeck()
  const state = useWorkDockStore((s) => s.byDeck[deckKey])
  useEffect(() => {
    useWorkDockStore.getState().ensureDeck(deckKey)
  }, [deckKey])

  const rootContext = useRootContext()
  const rootOverride = state?.rootOverride
  const rootOverrideAnchor = state?.rootOverrideAnchor
  const scope: DockScope = useMemo(
    () => deriveDockScope({ activePane, layoutLeafIds, panesById, deckKey, conversations, rootContext, rootOverride, rootOverrideAnchor }),
    [activePane, layoutLeafIds, panesById, deckKey, conversations, rootContext, rootOverride, rootOverrideAnchor],
  )
  const rootLabel = useRootLabel(scope.rootId)

  // A diff or a Search folder belongs to the scope it was opened in: drop it when the scope changes.
  const changesKey =
    scope.changes.kind === 'conversation'
      ? `conversation:${scope.changes.conversation.name}`
      : scope.changes.kind === 'root'
        ? `root:${scope.changes.rootId}`
        : scope.changes.kind === 'project-main'
          ? `project:${scope.changes.projectKey}`
          : 'none'
  const scopeKey = `${scope.rootId ?? ''}|${changesKey}`
  const lastScopeKey = useRef(scopeKey)
  useEffect(() => {
    if (lastScopeKey.current === scopeKey) return
    lastScopeKey.current = scopeKey
    useWorkDockStore.getState().clearScopedState(deckKey)
  }, [deckKey, scopeKey])
  const live = useLiveTab(deckKey)

  const open = state?.open ?? false
  const changedPaths = useScopeChangedPaths(scope, { open })
  const changesCount = useChangesCount(scope, { open })
  // A persisted 'live' tab with nothing to watch shows Files (B-D9).
  const tab: DockTab = state?.tab === 'live' && !live.visible ? 'files' : (state?.tab ?? 'files')

  // ─── Shortcuts (B-D4) ─────────────────────────────────────────────────────
  // Compare against the tab on screen, so Ctrl+Shift+E closes a dock that shows Files.
  const shownRef = useRef({ open, tab })
  shownRef.current = { open, tab }
  const toggleShown = useCallback(
    (target: DockTab) => {
      const store = useWorkDockStore.getState()
      if (shownRef.current.open && shownRef.current.tab === target) store.closeDock(deckKey)
      else store.openDock(deckKey, { tab: target })
    },
    [deckKey],
  )
  const setQuickOpen = useCallback((value: boolean) => useWorkDockStore.getState().setQuickOpen(deckKey, value), [deckKey])
  const closeQuickOpen = useCallback(() => setQuickOpen(false), [setQuickOpen])
  const shortcuts = useMemo(
    () => ({
      onFiles: () => toggleShown('files'),
      onChanges: () => toggleShown('changes'),
      onSearch: () => useWorkDockStore.getState().openDock(deckKey, { tab: 'search' }),
      onQuickOpen: () => setQuickOpen(true),
    }),
    [deckKey, toggleShown, setQuickOpen],
  )
  useExplorerShortcuts(shortcuts)

  // ─── activeDock registration (B-D5) ───────────────────────────────────────
  const fileRootRef = useRef<string | null>(null)
  fileRootRef.current = scope.rootId ?? scope.deckRootId
  const openBesideRef = useRef(deck?.openBeside)
  openBesideRef.current = deck?.openBeside
  const activePaneId = activePane?.paneId ?? null
  useEffect(() => {
    useActiveDock.getState().set({
      deckKey,
      activePaneId,
      rootId: scope.rootId,
      changedPaths,
      openFile: (path) => {
        const rootId = fileRootRef.current
        if (rootId) openBesideRef.current?.({ rootId, path })
      },
      revealFile: (path) => {
        const rootId = fileRootRef.current
        if (rootId) useWorkDockStore.getState().openDock(deckKey, { tab: 'files', reveal: { rootId, path } })
      },
    })
  }, [deckKey, activePaneId, scope.rootId, changedPaths])
  useEffect(() => () => useActiveDock.getState().clear(deckKey), [deckKey])

  // ─── Resize ───────────────────────────────────────────────────────────────
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const onResizeStart = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = useWorkDockStore.getState().byDeck[deckKey]?.width ?? DOCK_MIN_WIDTH
      let latest = startWidth
      const onMove = (e: MouseEvent) => {
        // The handle is on the left edge: moving left widens the dock.
        latest = clampWidth(startWidth + (startX - e.clientX))
        setDragWidth(latest)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        useWorkDockStore.getState().setWidth(deckKey, latest)
        setDragWidth(null)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [deckKey],
  )

  const quickOpen = <DockQuickOpen deckKey={deckKey} scope={scope} open={state?.quickOpen ?? false} onClose={closeQuickOpen} />

  if (!state || !open) {
    return (
      <div className="w-0 shrink-0" data-testid="work-dock-closed">
        {quickOpen}
      </div>
    )
  }

  const width = dragWidth ?? state.width
  const store = useWorkDockStore.getState()
  const HeaderIcon = HEADER_ICON[scope.header.kind]

  const tabs: { id: DockTab; label: string; icon: LucideIcon; extra?: ReactNode }[] = [
    { id: 'files', label: 'Files', icon: FolderTree },
    {
      id: 'changes',
      label: 'Changes',
      icon: GitCompare,
      extra: changesCount !== null && changesCount > 0 ? <span className="rounded-sm bg-accent px-1 font-mono text-[11px]">{changesCount}</span> : null,
    },
    { id: 'search', label: 'Search', icon: Search },
  ]
  if (live.visible) {
    tabs.push({
      id: 'live',
      label: 'Live',
      icon: Radio,
      extra: (
        <>
          {live.needsYou && <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-label="Needs you" />}
          <span className="rounded-sm bg-accent px-1 font-mono text-[11px]">{live.count}</span>
        </>
      ),
    })
  }

  const needsRoot = (tab === 'files' || tab === 'search') && scope.rootId === null
  let body: ReactNode
  if (needsRoot) {
    const reason = scope.nullReason ?? 'no-project'
    const deckRootId = scope.deckRootId
    body = (
      <div className="flex flex-col items-start gap-2 px-3 py-4 text-xs text-muted-foreground">
        <p>{NULL_ROOT_MESSAGE[reason]}</p>
        {reason !== 'no-project' && deckRootId && (
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-foreground hover:bg-accent"
            onClick={() => store.setRootOverride(deckKey, deckRootId, activePane?.paneId)}
          >
            Open project files
          </button>
        )}
      </div>
    )
  } else if (tab === 'files') body = <FilesTab deckKey={deckKey} scope={scope} />
  else if (tab === 'changes') body = <ChangesTab deckKey={deckKey} scope={scope} />
  else if (tab === 'search') body = <SearchTab deckKey={deckKey} scope={scope} />
  else body = <LiveTab deckKey={deckKey} />

  return (
    <aside
      data-testid="work-dock"
      aria-label="Work dock"
      className="relative flex h-full min-h-0 shrink-0 flex-col border-l border-border bg-card"
      style={{ width }}
    >
      <div
        data-testid="work-dock-resize"
        className="absolute inset-y-0 -left-[3px] z-10 w-1.5 cursor-col-resize hover:bg-primary"
        onMouseDown={onResizeStart}
      />
      <div className="flex h-[38px] shrink-0 items-center border-b border-border px-1">
        <div role="tablist" aria-label="Work dock tabs" className="flex min-w-0 items-center">
          {tabs.map(({ id, label, icon: Icon, extra }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`flex h-[38px] items-center gap-1.5 border-b-2 px-2.5 text-[12.5px] ${
                tab === id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => store.setTab(deckKey, id)}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
              {extra}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Hide panel"
          title="Hide panel (Ctrl Shift E)"
          className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => store.closeDock(deckKey)}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div data-testid="work-dock-scope" className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-[7px] text-xs text-muted-foreground">
        <HeaderIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <ScopeText header={scope.header} rootLabel={rootLabel} />
        </span>
        {scope.overridden && (
          <button
            type="button"
            aria-label="Follow the active tab"
            className="shrink-0 rounded-md px-1.5 py-0.5 text-foreground hover:bg-accent"
            onClick={() => store.setRootOverride(deckKey, undefined)}
          >
            Follow tab
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
      {quickOpen}
    </aside>
  )
}
