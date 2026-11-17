import { useEffect, useMemo, useCallback, useState, type ReactNode } from 'react'
import {
  usePanesStore,
  selectPanesForWorkspace,
  selectActivePaneId,
  type WorkspacePane,
  type PaneType,
  type PaneSpec,
} from '../../lib/panesStore'
import type { Conversation } from '../CommandDeck/ConversationList'
import type { SessionNode as SessionNodeType } from '@overdeck/contracts'
import { useConversationMutations } from '../CommandDeck/useConversationMutations'
import { ConversationActionMenu } from '../CommandDeck/ConversationActionMenu'
import { PaneTabMenu } from './PaneTabMenu'
import { PaneLayoutView, type DropZone } from './PaneLayoutView'
import {
  leaf,
  isSplit,
  leafCount,
  collectLeafIds,
  hasLeaf,
  splitAtLeaf,
  removeLeaf,
  pruneToValid,
  replaceLeaf,
  updateRatio,
  type PaneLayout,
  type SplitPath,
} from '../../lib/paneLayout'
import { selectDeckLayout, useDeckLayoutStore } from '../../lib/deckLayoutStore'
import { ALL_PROJECTS_KEY } from '../../lib/deckKeys'
import { LayoutPresetBar } from './LayoutPresetBar'
import { useConversationDragStore } from './conversationDragStore'
import { openConversationBeside, showConversation } from './openConversationInDeck'
import { ForkModal } from '../CommandDeck/ForkModal'
import { AddSkillsModal } from '../CommandDeck/AddSkillsModal'
import { Bot, Terminal as TerminalIcon, Globe, FolderTree, GitCompare, Search } from 'lucide-react'
import { PaneBar, type NewPaneAction } from './PaneBar'
import { useStageShortcuts } from './useStageShortcuts'
import { TerminalDrawer } from '../terminal/TerminalDrawer'
import { useTerminalStateStore, selectThreadTerminalState } from '../terminal/terminalStateStore'
import { PENDING_TERMINAL_EVENT, peekPendingTerminal } from '../home/pendingTerminal'
import { TerminalPane } from './panes/TerminalPane'
import { CommitsPane } from './panes/CommitsPane'
import { PlanPane } from './panes/PlanPane'
import { DocsPane } from './panes/DocsPane'
import { AgentPane } from './panes/AgentPane'
import { BrowserPane } from './panes/BrowserPane'
import { EditorPane } from './panes/EditorPane'
import { CodePaneSlot } from '../explorer/code/CodePaneSlot'
import type { StageContext, PaneWrapperProps, StageApi } from './types'
import { StageDeckProvider, type StageDeckContextValue, type OpenBesideInput, type OpenDockInput } from './StageDeckContext'
import { openCodePane } from '../explorer/openCodePane'
import { useWorkDockStore } from '../dock/workDockStore'
import { WorkDock } from '../dock/WorkDock'
import { useRootContext } from '../explorer/rootForConversation'
import { findRegisteredProject } from '../CommandDeck/UnknownProjectState'
import { NO_PROJECT_LABEL, resolveEffectiveProjectKey } from '../CommandDeck/projectsData'
import { ProjectMark } from '../frame/ProjectMark'
import { currentPlatform } from '../../lib/shortcuts/keys'
import styles from './stage.module.css'

export type { StageContext, PaneWrapperProps, StageApi } from './types'

export interface StageProps {
  /** Pane-store key for this deck (PAN-1561: the project key). */
  deckKey: string
  /** All conversations; used to resolve agent panes. */
  conversations?: Conversation[]
  /** Resolve a session id → its SessionNode, so an `agent` pane can be backed by
   * a pipeline session (Work/Review/reviewer/…), not just a conversation. */
  resolveSession?: (sessionId: string) => SessionNodeType | undefined
  /** Working directory for new drawer terminals (the project path). */
  terminalCwd?: string
  /** Create a conversation for the deck's project (for the "+" New conversation
   * action); returns the new conversation name or creation error. */
  onCreateConversation?: (agentId: string, message?: string) => Promise<{ name: string } | { error: string }>
  /** Render the permanent HOME tab (project-scoped). */
  renderHome: (api: StageApi) => ReactNode
  /** Render an `issue` tab's body for the given issue id. */
  renderIssue: (issueId: string, api: StageApi) => ReactNode
  /** Fired when the active tab is a conversation, so the rail can highlight it. */
  onActiveConversationChange?: (conversationId: string) => void
  /** Fired when the active tab is an issue, so upstream selection (and the
   * /command-deck/<project>/<issue> URL) follows the visible view. */
  onActiveIssueChange?: (issueId: string) => void
}

const PANE_LABELS: Record<PaneType, string> = {
  home: 'Home',
  issue: 'Issue',
  agent: 'Agent',
  terminal: 'Terminal',
  files: 'Files',
  commits: 'Commits',
  plan: 'Plan',
  docs: 'Docs',
  browser: 'Web',
  editor: 'Editor',
  code: 'File',
}

/** Safe fallback for pane types whose wrapper has not been built yet. */
function PanePlaceholder({ pane }: PaneWrapperProps) {
  return (
    <div className={styles.placeholder} data-pane-type={pane.paneType}>
      <div className={styles.placeholderTitle}>{pane.label}</div>
      <div className={styles.placeholderHint}>
        This {pane.paneType} pane is not implemented yet.
      </div>
    </div>
  )
}

/** Dispatch a non-home/non-issue pane to its wrapper. The home and issue panes
 * are composed by the caller's render props (they need project/issue data), so
 * they are handled before this. */
function renderPane(pane: WorkspacePane, ctx: StageContext) {
  switch (pane.paneType) {
    case 'terminal':
      return <TerminalPane pane={pane} ctx={ctx} />
    case 'commits':
      return <CommitsPane pane={pane} ctx={ctx} />
    case 'plan':
      return <PlanPane pane={pane} ctx={ctx} />
    case 'docs':
      return <DocsPane pane={pane} ctx={ctx} />
    case 'agent':
      return <AgentPane pane={pane} ctx={ctx} />
    case 'browser':
      return <BrowserPane pane={pane} ctx={ctx} />
    case 'editor':
      return <EditorPane pane={pane} ctx={ctx} />
    case 'code':
      return <CodePaneSlot pane={pane} ctx={ctx} />
    default:
      return <PanePlaceholder pane={pane} ctx={ctx} />
  }
}

/** A bare Claude Code session UUID, the `<session-id>.jsonl` file stem. */
const CLAUDE_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A read-only stand-in for a Claude session that conversation search indexed but
 * Overdeck never registered — a work-agent or plain terminal session, which is
 * most of what search can find. The palette opens such a hit by session id, so
 * without this the pane resolves nothing and spins on "Starting…" forever.
 *
 * `id < 0` is the established synthetic marker (SessionPanel uses it too) and
 * suppresses the row-keyed polls. The timestamps are structural — they exist so
 * ConversationPanel takes its ended/history branch rather than reading a null
 * `endedAt` as "still spawning" — and are deliberately the epoch rather than a
 * plausible-looking `Date.now()`: nothing renders them today, and if some future
 * surface starts to, an obviously wrong 1970 is a bug report instead of a
 * quietly fabricated date.
 */
function unregisteredSessionConversation(sessionId: string): Conversation {
  const structuralTimestamp = new Date(0).toISOString()
  return {
    id: -1,
    name: sessionId,
    tmuxSession: sessionId,
    status: 'ended',
    cwd: '',
    issueId: null,
    createdAt: structuralTimestamp,
    endedAt: structuralTimestamp,
    lastAttachedAt: null,
    sessionAlive: false,
    harness: 'claude-code',
  }
}

/**
 * Stage — the project-scoped deck (PAN-1561, evolves PAN-1549). Renders the
 * persistent PaneBar plus the active pane. Pane state lives in `panesStore`,
 * keyed by `deckKey` (the project). The permanent HOME tab and any `issue` tab
 * are composed by the caller via `renderHome` / `renderIssue` (they need the
 * project's / issue's data); every other pane dispatches through `renderPane`.
 */
export function Stage({ deckKey, conversations = [], resolveSession, terminalCwd, onCreateConversation, renderHome, renderIssue, onActiveConversationChange, onActiveIssueChange }: StageProps) {
  const ensureHome = usePanesStore((s) => s.ensureHome)
  const addPane = usePanesStore((s) => s.addPane)
  const closePane = usePanesStore((s) => s.closePane)
  const setActivePane = usePanesStore((s) => s.setActivePane)
  const updatePane = usePanesStore((s) => s.updatePane)
  const panes = usePanesStore(selectPanesForWorkspace(deckKey))
  const activePaneId = usePanesStore(selectActivePaneId(deckKey))
  const activeId = activePaneId ?? ''
  const terminalOpen = useTerminalStateStore(
    (s) => selectThreadTerminalState(s.terminalStateByThreadId, deckKey).terminalOpen,
  )
  const setTerminalOpen = useTerminalStateStore((s) => s.setTerminalOpen)
  const toggleTerminal = useCallback(
    () => setTerminalOpen(deckKey, !terminalOpen),
    [setTerminalOpen, deckKey, terminalOpen],
  )
  const openTerminalDrawer = useCallback(
    () => setTerminalOpen(deckKey, true),
    [setTerminalOpen, deckKey],
  )

  // PAN-4280 (D5a): open the drawer for a terminal hand-off pending for this
  // deck — on mount (a hand-off written just before the hard navigation that
  // mounted this Stage) and on the same-tab event (a hand-off written while
  // this Stage is already live).
  useEffect(() => {
    if (peekPendingTerminal(deckKey)) setTerminalOpen(deckKey, true)
    const onPendingTerminal = (e: Event) => {
      const detail = (e as CustomEvent<{ deckKey: string }>).detail
      if (detail?.deckKey === deckKey) setTerminalOpen(deckKey, true)
    }
    window.addEventListener(PENDING_TERMINAL_EVENT, onPendingTerminal)
    return () => window.removeEventListener(PENDING_TERMINAL_EVENT, onPendingTerminal)
  }, [deckKey, setTerminalOpen])

  useEffect(() => {
    ensureHome(deckKey)
  }, [deckKey, ensureHome])

  // PAN-1561: keep the deck tab bar clean. (a) terminals now live in the drawer,
  // not as deck tabs — drop any `terminal` panes left from before the migration;
  // (b) collapse duplicate agent panes that point at the same conversation
  // (stale accumulation), keeping the first. Creation paths dedupe too, so this
  // self-heals existing decks on load.
  useEffect(() => {
    const current = usePanesStore.getState().panesByWorkspace[deckKey] ?? []
    const seenConversationIds = new Set<string>()
    const ISSUE_SCOPED = new Set<PaneType>(['commits', 'plan', 'docs'])
    let migratedRoot: string | null = null
    for (const p of current) {
      // Terminals are drawer-only now.
      if (p.paneType === 'terminal') {
        closePane(deckKey, p.paneId)
        continue
      }
      // PAN-5289 (PAN-5284 D-3): the explorer is the dock's Files tab. Close every
      // persisted Files pane; the last one with a root becomes the dock's root.
      if (p.paneType === 'files') {
        const root = p.explorerRootId ?? (p.issueId ? `issue:${p.issueId}` : null)
        closePane(deckKey, p.paneId)
        if (root) migratedRoot = root
        continue
      }
      // Issue-scoped panes created at project scope (no issueId) were broken —
      // they queried the project key as an issue. Drop them.
      if (ISSUE_SCOPED.has(p.paneType) && !p.issueId) {
        closePane(deckKey, p.paneId)
        continue
      }
      // Collapse duplicate agent panes pointing at the same conversation.
      if (p.paneType === 'agent' && p.conversationId) {
        if (seenConversationIds.has(p.conversationId)) closePane(deckKey, p.paneId)
        else seenConversationIds.add(p.conversationId)
      }
    }
    // The override belongs to the pane that is active after the closes (B-D17).
    if (migratedRoot) {
      const anchor = selectActivePaneId(deckKey)(usePanesStore.getState()) ?? undefined
      useWorkDockStore.getState().setRootOverride(deckKey, migratedRoot, anchor)
      useWorkDockStore.getState().openDock(deckKey, { tab: 'files' })
    }
  }, [deckKey, closePane])

  useStageShortcuts(deckKey)

  const openPane = useCallback(
    (spec: PaneSpec) => addPane(deckKey, spec),
    [addPane, deckKey],
  )
  const openTypedPane = useCallback(
    (paneType: PaneType, opts?: { terminalId?: string | null }) =>
      addPane(deckKey, {
        paneType,
        label: PANE_LABELS[paneType],
        ...(paneType === 'terminal' ? { terminalId: opts?.terminalId ?? null } : {}),
      }),
    [addPane, deckKey],
  )
  const openOrFocusAgentPane = useCallback(
    (conversationId: string, label: string) => {
      const current = usePanesStore.getState().panesByWorkspace[deckKey] ?? []
      const existing = current.find(
        (p) => p.paneType === 'agent' && p.conversationId === conversationId,
      )
      if (existing) setActivePane(deckKey, existing.paneId)
      else addPane(deckKey, { paneType: 'agent', label, conversationId })
    },
    [deckKey, setActivePane, addPane],
  )
  const openIssue = useCallback(
    (issueId: string, label: string) => {
      const current = usePanesStore.getState().panesByWorkspace[deckKey] ?? []
      const existing = current.find((p) => p.paneType === 'issue' && p.issueId === issueId)
      if (existing) setActivePane(deckKey, existing.paneId)
      else addPane(deckKey, { paneType: 'issue', label, issueId })
    },
    [deckKey, setActivePane, addPane],
  )
  // PAN-3260: opened by markdown file chips via StageDeckContext, so nested
  // chat content (AgentPane → ConversationPanel → ChatMarkdown → MarkdownFileLink)
  // can reach the deck without prop-threading StageApi/StageContext.
  const openOrFocusEditorPane = useCallback(
    (filePath: string, label: string, citeConversationName?: string | null) => {
      const current = usePanesStore.getState().panesByWorkspace[deckKey] ?? []
      const existing = current.find((p) => p.paneType === 'editor' && p.editorFilePath === filePath)
      if (existing) {
        if (citeConversationName && existing.citeConversationName !== citeConversationName) {
          updatePane(deckKey, existing.paneId, { citeConversationName })
        }
        setActivePane(deckKey, existing.paneId)
      } else {
        addPane(deckKey, {
          paneType: 'editor',
          label,
          editorFilePath: filePath,
          ...(citeConversationName ? { citeConversationName } : {}),
        })
      }
    },
    [deckKey, setActivePane, addPane, updatePane],
  )

  // The mounted WorkDock reads the store (PAN-5289).
  const openDock = useCallback((input: OpenDockInput) => {
    useWorkDockStore.getState().openDock(deckKey, input)
  }, [deckKey])
  const api: StageApi = useMemo(
    () => ({ deckKey, openPane, openTypedPane, openIssue, openOrFocusAgentPane, toggleTerminal, openTerminalDrawer, openDock }),
    [deckKey, openPane, openTypedPane, openIssue, openOrFocusAgentPane, toggleTerminal, openTerminalDrawer, openDock],
  )

  const ctx: StageContext = useMemo(
    () => ({
      workspaceId: deckKey,
      openPane,
      resolveAgentPane: (pane) => {
        // Session-backed agent pane (rail tree click) → SessionPanel.
        if (pane.agentId && resolveSession) {
          const session = resolveSession(pane.agentId)
          if (session) return { session }
        }
        if (!pane.conversationId) return undefined
        const conversation = conversations.find((c) => c.name === pane.conversationId)
        if (conversation) return { conversation }
        // A palette search hit on an indexed-but-unregistered Claude session.
        if (CLAUDE_SESSION_UUID.test(pane.conversationId)) {
          return { conversation: unregisteredSessionConversation(pane.conversationId), readOnly: true }
        }
        return undefined
      },
    }),
    [deckKey, openPane, conversations, resolveSession],
  )

  // Pane layout (PAN-1591): a binary split tree arranging the deck's visible
  // panes into arbitrary grids. A null / single-leaf layout means "no split" —
  // the deck renders just the active pane. Persisted per deck across reloads.
  // PAN-5343 H-D14: the layout lives in deckLayoutStore so the list, the crumb
  // and the deck openers can read and change it from outside the Stage. The
  // Stage reads null until its mount effect re-reads storage, exactly as it
  // did when the layout was local state.
  const [hydratedDeck, setHydratedDeck] = useState<string | null>(null)
  useEffect(() => {
    useDeckLayoutStore.getState().hydrateLayout(deckKey)
    setHydratedDeck(deckKey)
  }, [deckKey])
  const storeLayout = useDeckLayoutStore(selectDeckLayout(deckKey))
  const layout = hydratedDeck === deckKey ? storeLayout : null
  const setLayout = useCallback(
    (next: PaneLayout | null) => useDeckLayoutStore.getState().setLayout(deckKey, next),
    [deckKey],
  )
  useEffect(() => {
    if (activeId) useDeckLayoutStore.getState().noteFocus(deckKey, activeId)
  }, [deckKey, activeId])

  // Selecting a tab focuses its pane. While split: if the pane is already a
  // visible region, focus it; otherwise load it into the focused region (the
  // tab "opens" in that group, editor-style).
  const handleSelectPane = useCallback(
    (paneId: string) => {
      if (layout && leafCount(layout) > 1 && !hasLeaf(layout, paneId)) {
        const leaves = collectLeafIds(layout)
        const focus = leaves.includes(activeId) ? activeId : leaves[0]
        if (focus) setLayout(replaceLeaf(layout, focus, paneId))
      }
      setActivePane(deckKey, paneId)
    },
    [layout, activeId, deckKey, setActivePane, setLayout],
  )
  // PAN-5186: panes opened from inside a pane (explorer files) land in the grid
  // too. A pane outside the split replaces a region other than the opener's.
  const revealPane = useCallback(
    (paneId: string, besidePaneId?: string) => {
      if (layout && leafCount(layout) > 1 && !hasLeaf(layout, paneId)) {
        const leaves = collectLeafIds(layout)
        const others = leaves.filter((id) => id !== besidePaneId)
        const target = others.includes(activeId) ? activeId : others[0] ?? leaves[0]
        if (target) setLayout(replaceLeaf(layout, target, paneId))
      }
      setActivePane(deckKey, paneId)
    },
    [layout, activeId, deckKey, setActivePane, setLayout],
  )
  const handleClosePane = useCallback(
    (paneId: string) => closePane(deckKey, paneId),
    [closePane, deckKey],
  )

  // Right-click a conversation tab → the same actions as the conversation ⋮.
  // Hosted here because the Stage already maps a pane to its conversation and
  // can own the mutations + ForkModal. `tabMenu` stores the conversation *name*
  // so the menu re-resolves live state (e.g. favorite toggles) on each render.
  const convMutations = useConversationMutations(null, () => {})
  const [tabMenu, setTabMenu] = useState<{ conversationName: string; paneId: string; top: number; left: number } | null>(null)
  // Generic right-click menu for non-conversation tabs (issue/plan/docs/…).
  const [paneMenu, setPaneMenu] = useState<{ paneId: string; permanent: boolean; top: number; left: number } | null>(null)

  const handlePaneContextMenu = useCallback(
    (pane: WorkspacePane, e: React.MouseEvent) => {
      e.preventDefault()
      if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus()
      const top = Math.max(8, Math.min(e.clientY, window.innerHeight - 360))
      const left = Math.max(8, Math.min(e.clientX, window.innerWidth - 240))
      // Conversation/agent tabs get the rich menu; everything else the generic one.
      if (pane.paneType === 'agent' && pane.conversationId && conversations.some((c) => c.name === pane.conversationId)) {
        setTabMenu({ conversationName: pane.conversationId, paneId: pane.paneId, top, left })
      } else {
        setPaneMenu({ paneId: pane.paneId, permanent: pane.paneType === 'home' || !!pane.isPermanent, top, left })
      }
    },
    [conversations],
  )

  // Detach a conversation tab into its own browser window — same target as
  // the in-pane detach icon and the ⋮ → "Pop out to window" menu item. The
  // PaneBar invokes this when a tab drag ends outside any split drop zone.
  // Lands on /popout/conversation/<id>, a bare conversation view (no sidebar,
  // no awareness rail) so the detached window focuses on the one chat.
  const handleTabDetach = useCallback(
    (_paneId: string, conversationId: string) => {
      const conv = conversations.find((c) => c.name === conversationId)
      // Resolve numeric id; conversation.name is the stable key, .id is the
      // numeric row used by /popout/conversation/<id>.
      const numericId = (conv as unknown as { id?: number } | undefined)?.id
      const targetId = numericId ?? conversationId
      window.open(`/popout/conversation/${targetId}`, '_blank', 'popup=yes,width=920,height=1040')
    },
    [conversations],
  )

  // PAN-1561: the "+" opens a menu of what to create, so it's explicit rather
  // than guessing. Fallback (⌘T / no menu) toggles the terminal drawer.
  const handleAddPane = useCallback(() => toggleTerminal(), [toggleTerminal])
  // B-D11: the deck's project, found by key or name.
  const registeredProjects = useRootContext().projects
  const deckProject = findRegisteredProject(registeredProjects, deckKey)
  // PAN-5343 H-D9: in the All deck, agent tabs and split headers carry their
  // conversation's project mark (muted for No project).
  const renderPaneMark = useMemo(() => {
    if (deckKey !== ALL_PROJECTS_KEY) return undefined
    return (pane: WorkspacePane): ReactNode => {
      if (pane.paneType !== 'agent' || !pane.conversationId) return null
      const conv = conversations.find((c) => c.name === pane.conversationId)
      if (!conv) return null
      const key = resolveEffectiveProjectKey(conv, registeredProjects)
      const project = key ? registeredProjects.find((p) => p.key === key) : undefined
      return project
        ? <ProjectMark size="sm" name={project.name ?? project.key} projectKey={project.key} />
        : <ProjectMark size="sm" name={NO_PROJECT_LABEL} muted />
    }
  }, [deckKey, conversations, registeredProjects])
  // PAN-5295 D2-17: create actions first, then a separator, then the drawers;
  // each shows its registered shortcut's keycap for this platform.
  const newActions = useMemo<NewPaneAction[]>(() => {
    const actions: NewPaneAction[] = []
    if (onCreateConversation) {
      actions.push({
        key: 'conversation',
        label: 'New conversation',
        icon: Bot,
        shortcutId: 'deck.new-conversation',
        onSelect: () => {
          void onCreateConversation('claude-code').then((result) => {
            if ('name' in result) openOrFocusAgentPane(result.name, 'Agent')
          })
        },
      })
    }
    // PAN-5289 (§6.10, FR-3): the work dock's entry points.
    actions.push({ key: 'files', label: 'Files', icon: FolderTree, shortcutId: 'dock.files', onSelect: () => openDock({ tab: 'files' }) })
    if (deckProject) {
      actions.push({
        key: 'changes',
        label: `Changes in ${deckProject.name || deckProject.key}`,
        icon: GitCompare,
        shortcutId: 'dock.changes',
        onSelect: () => {
          useWorkDockStore.getState().setRootOverride(deckKey, `project:${deckProject.key}`, activeId || undefined)
          openDock({ tab: 'changes' })
        },
      })
    }
    actions.push({ key: 'go-to-file', label: 'Go to file…', icon: Search, shortcutId: 'explorer.quick-open', onSelect: () => useWorkDockStore.getState().setQuickOpen(deckKey, true) })
    actions.push({
      key: 'terminal',
      label: 'Terminal',
      icon: TerminalIcon,
      shortcutId: 'stage.toggle-terminal',
      separatorBefore: true,
      onSelect: () => setTerminalOpen(deckKey, true),
    })
    actions.push({
      key: 'web',
      label: 'Web page',
      icon: Globe,
      onSelect: () => openPane({ paneType: 'browser', label: 'Web' }),
    })
    return actions
  }, [onCreateConversation, openOrFocusAgentPane, setTerminalOpen, deckKey, openPane, openDock, deckProject, activeId])

  // Display panes: drop `terminal` panes (drawer-only now) and resolve agent
  // tab labels from the live conversation title so tabs are distinguishable
  // instead of a row of identical "New conversation"s.
  const displayPanes = useMemo(
    () =>
      panes
        .filter((p) => p.paneType !== 'terminal')
        .map((p) => {
          if (p.paneType !== 'agent') return p
          // Session-backed pipeline panes (Work/Review/reviewer sub-roles/…) carry
          // `agentId`, not `conversationId`. Name them by role + issue, resolved
          // live from the session tree — never fall through to "Chat". Computed at
          // render; nothing is persisted (PAN-1591).
          if (p.agentId && !p.conversationId) {
            const role = resolveSession?.(p.agentId)?.role ?? resolveSession?.(p.agentId)?.type
            const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : null
            const label = roleLabel
              ? p.issueId
                ? `${roleLabel} · ${p.issueId.toUpperCase()}`
                : roleLabel
              : p.label // creation label is already role-derived — keep it, don't clobber
            return label === p.label ? p : { ...p, label }
          }
          const conv = conversations.find((c) => c.name === p.conversationId)
          const title = conv?.title?.trim()
          // The server seeds untitled chats with the literal title "New
          // conversation"; an untitled chat's tab reads exactly that (PAN-5295
          // D2-18) — the full label is in the tab's title and the "N tabs" list.
          const isPlaceholder = !title || title.toLowerCase() === 'new conversation'
          const label = isPlaceholder ? 'New conversation' : title
          return label === p.label ? p : { ...p, label }
        }),
    [panes, conversations, resolveSession],
  )

  const activePane = displayPanes.find((p) => p.paneId === activePaneId) ?? displayPanes[0] ?? null

  // Compose any pane to its content. Home/issue need caller data (render props);
  // everything else dispatches through renderPane. Shared by the active pane and
  // the split's secondary pane.
  const renderPaneContent = useCallback(
    (pane: WorkspacePane): ReactNode =>
      pane.paneType === 'home'
        ? renderHome(api)
        : pane.paneType === 'issue'
          ? renderIssue(pane.issueId ?? '', api)
          : renderPane(pane, ctx),
    [renderHome, renderIssue, api, ctx],
  )

  // ─── Pane layout derivations + actions (PAN-1591) ─────────────────────────
  const splitActive = isSplit(layout)
  const panesById = useMemo(() => new Map(displayPanes.map((p) => [p.paneId, p] as const)), [displayPanes])
  const layoutLeafIds = useMemo(() => (layout ? collectLeafIds(layout) : []), [layout])

  // PAN-5287 §6.2: open a file beside a pane (the chat by default). The beside
  // pane is read before openCodePane, which makes the new pane active.
  const openBeside = useCallback(
    (input: OpenBesideInput): string => {
      const beside = input.besidePaneId ?? activeId
      const id = openCodePane(deckKey, { rootId: input.rootId, path: input.path, line: input.line, preview: input.preview })
      if (layout && leafCount(layout) > 1) {
        if (!hasLeaf(layout, id)) {
          const leaves = collectLeafIds(layout)
          const isCode = (leafId: string): boolean => panesById.get(leafId)?.paneType === 'code'
          // A region already showing a code pane is reused before any other, so the chat keeps its region.
          // With no explicit beside pane, an active code pane is that region (the next file replaces it).
          const codeRegion =
            leaves.find((leafId) => leafId !== beside && isCode(leafId)) ??
            (input.besidePaneId === undefined && isCode(beside) ? beside : undefined)
          const target = codeRegion ?? leaves.find((leafId) => leafId !== beside) ?? leaves[0]
          if (target) setLayout(replaceLeaf(layout, target, id))
        }
      } else if (beside && beside !== id) {
        setLayout({ kind: 'split', dir: 'row', a: leaf(beside), b: leaf(id), ratio: 0.5 })
      }
      setActivePane(deckKey, id)
      return id
    },
    [deckKey, activeId, layout, panesById, setActivePane, setLayout],
  )
  // PAN-5290 C-D3: a code pane's scoped conversation is the first other layout leaf bound to a known conversation.
  const conversationBeside = useCallback(
    (paneId: string): Conversation | null => {
      for (const leafId of layoutLeafIds) {
        if (leafId === paneId) continue
        const pane = panesById.get(leafId)
        if (pane?.paneType !== 'agent' || !pane.conversationId) continue
        const conv = conversations.find((c) => c.name === pane.conversationId)
        if (conv) return conv
      }
      return null
    },
    [layoutLeafIds, panesById, conversations],
  )
  const deckContextValue: StageDeckContextValue = useMemo(
    () => ({ deckKey, openOrFocusEditorPane, openOrFocusAgentPane, revealPane, openBeside, openDock, conversationBeside }),
    [deckKey, openOrFocusEditorPane, openOrFocusAgentPane, revealPane, openBeside, openDock, conversationBeside],
  )
  // The focused leaf follows the active tab when it's in the layout.
  const focusedPaneId = splitActive
    ? layoutLeafIds.includes(activeId)
      ? activeId
      : layoutLeafIds[0] ?? null
    : null

  // Heal the layout against the live pane set: a closed tab drops from the grid,
  // collapsing to single-pane mode when ≤1 leaf survives.
  useEffect(() => {
    if (!layout) return
    const valid = new Set(displayPanes.map((p) => p.paneId))
    const pruned = pruneToValid(layout, valid)
    const before = collectLeafIds(layout).join(',')
    const after = pruned ? collectLeafIds(pruned).join(',') : ''
    if (before !== after) setLayout(pruned)
  }, [layout, displayPanes, setLayout])

  // Open `paneId` in a new split beside the focused pane (row = right, col =
  // down). Starts a split from single-pane mode; no-op against an empty deck.
  const openInSplit = useCallback(
    (paneId: string, dir: 'row' | 'col') => {
      if (layout && leafCount(layout) > 1) {
        if (hasLeaf(layout, paneId)) {
          setActivePane(deckKey, paneId)
          return
        }
        const focus = layoutLeafIds.includes(activeId) ? activeId : layoutLeafIds[0]
        if (!focus) return
        setLayout(splitAtLeaf(layout, focus, paneId, dir))
      } else {
        if (!activeId || paneId === activeId) return
        setLayout({ kind: 'split', dir, a: leaf(activeId), b: leaf(paneId), ratio: 0.5 })
      }
      setActivePane(deckKey, paneId)
    },
    [layout, layoutLeafIds, activeId, deckKey, setActivePane, setLayout],
  )

  // Close one region of the split (the tab itself stays open). Collapsing to a
  // single leaf exits split mode and promotes the survivor to active.
  const closeLeaf = useCallback(
    (paneId: string) => {
      if (!layout) return
      const next = removeLeaf(layout, paneId)
      if (next && leafCount(next) > 1) {
        setLayout(next)
        if (activeId === paneId) setActivePane(deckKey, collectLeafIds(next)[0])
      } else {
        const survivor = next ? collectLeafIds(next)[0] : activeId
        setLayout(null)
        if (survivor) setActivePane(deckKey, survivor)
      }
    },
    [layout, activeId, deckKey, setActivePane, setLayout],
  )

  // PAN-5343 H-D8: a conversation row dragged onto a pane. The All deck takes
  // any conversation; a project deck takes only its own. The centre replaces
  // the target leaf; an edge opens the conversation beside it.
  const conversationDrag = useConversationDragStore((s) => s.dragging)
  const draggingConversation = conversationDrag !== null && (deckKey === ALL_PROJECTS_KEY || conversationDrag.deckKey === deckKey)
  const onDropConversation = useCallback(
    (targetPaneId: string, name: string, zone: DropZone) => {
      useConversationDragStore.getState().end()
      setActivePane(deckKey, targetPaneId)
      const label = conversations.find((c) => c.name === name)?.title ?? 'Agent'
      if (zone === 'center') showConversation(deckKey, name, label)
      else openConversationBeside(deckKey, name, label)
    },
    [deckKey, conversations, setActivePane],
  )

  // PAN-5343 H-D19: the split header's ⤢ — show only this pane; the others stay as tabs.
  const makeOnlyPane = useCallback(
    (paneId: string) => {
      setLayout(null)
      setActivePane(deckKey, paneId)
    },
    [deckKey, setActivePane, setLayout],
  )

  const onRatioChange = useCallback(
    (path: SplitPath, ratio: number) => {
      setLayout(layout ? updateRatio(layout, path, ratio) : null)
    },
    [layout, setLayout],
  )

  // Split-by-drag (PAN-1591): which tab is mid-drag (enables drop zones), and
  // where it lands. The base layout is the current grid, or a single leaf of the
  // active pane when not yet split (so a drag creates the first split).
  const [draggingPaneId, setDraggingPaneId] = useState<string | null>(null)
  const onDropTab = useCallback(
    (targetPaneId: string, draggedId: string, zone: 'left' | 'right' | 'top' | 'bottom' | 'center') => {
      const base = layout ?? (activePane ? leaf(activePane.paneId) : null)
      if (!base) return
      if (zone === 'center') {
        if (draggedId === targetPaneId) return
        if (hasLeaf(base, draggedId)) {
          setActivePane(deckKey, draggedId)
          return
        }
        setLayout(replaceLeaf(base, targetPaneId, draggedId))
        setActivePane(deckKey, draggedId)
        return
      }
      if (draggedId === targetPaneId) return // can't split a region against itself
      const dir = zone === 'left' || zone === 'right' ? 'row' : 'col'
      const before = zone === 'left' || zone === 'top'
      // Move semantics: if the dragged pane is already a region elsewhere, lift it
      // out first so it doesn't appear twice.
      const working = hasLeaf(base, draggedId) ? removeLeaf(base, draggedId) ?? base : base
      setLayout(splitAtLeaf(working, targetPaneId, draggedId, dir, before))
      setActivePane(deckKey, draggedId)
    },
    [layout, activePane, deckKey, setActivePane, setLayout],
  )
  const effectiveLayout = layout ?? (activePane ? leaf(activePane.paneId) : null)
  // PAN-5343 H-D7: the Layout presets, in the All projects deck only. Memoized so the memo'd PaneBar keeps equal props.
  const activePaneIdForBar = activePane?.paneId ?? null
  const layoutPresetBar = useMemo(
    () => (deckKey === ALL_PROJECTS_KEY
      ? <LayoutPresetBar deckKey={deckKey} panes={displayPanes} layout={layout} activePaneId={activePaneIdForBar} />
      : undefined),
    [deckKey, displayPanes, layout, activePaneIdForBar],
  )

  // Close every closable tab (HOME/permanent panes stay). Also clears any split.
  const closeAllPanes = useCallback(() => {
    const all = usePanesStore.getState().panesByWorkspace[deckKey] ?? []
    for (const p of all) {
      if (!p.isPermanent && p.paneType !== 'home') closePane(deckKey, p.paneId)
    }
    setLayout(null)
  }, [deckKey, closePane, setLayout])

  // Reverse sync (PAN-1591): when the active tab is a conversation, highlight it
  // in the rail so the deck and the conversation list stay in lockstep.
  useEffect(() => {
    if (activePane?.paneType === 'agent' && activePane.conversationId) {
      onActiveConversationChange?.(activePane.conversationId)
    }
  }, [activePane?.paneId, activePane?.paneType, activePane?.conversationId, onActiveConversationChange])

  // Same reverse sync for issue tabs: clicking an issue pane tab bypasses the
  // rail's selection handler, so notify upstream selection here — that keeps
  // the /command-deck/<project>/<issue> URL following the visible view.
  useEffect(() => {
    if (activePane?.paneType === 'issue' && activePane.issueId) {
      onActiveIssueChange?.(activePane.issueId)
    }
  }, [activePane?.paneId, activePane?.paneType, activePane?.issueId, onActiveIssueChange])

  // Re-resolve the right-clicked tab's conversation from the live list so the
  // menu reflects current state and self-dismisses if the conversation is gone.
  const tabMenuConv = tabMenu ? conversations.find((c) => c.name === tabMenu.conversationName) ?? null : null

  return (
    <StageDeckProvider value={deckContextValue}>
      <div className={styles.stage}>
        <div className={styles.stageMain}>
          <PaneBar
            panes={displayPanes}
            activePaneId={activePane?.paneId ?? activePaneId}
            onSelect={handleSelectPane}
            onClose={handleClosePane}
            onAdd={handleAddPane}
            newActions={newActions}
            onPaneContextMenu={handlePaneContextMenu}
            onTabDragStart={setDraggingPaneId}
            onTabDragEnd={() => setDraggingPaneId(null)}
            onTabDetach={handleTabDetach}
            trailing={layoutPresetBar}
            renderTabPrefix={renderPaneMark}
          />
          <div className={styles.paneArea}>
            {/* PAN-5343 H-D10: the Home-less All deck with nothing open. */}
            {deckKey === ALL_PROJECTS_KEY && displayPanes.length === 0 && (
              <div data-testid="all-projects-empty" className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
                {`Pick conversations on the left. ${currentPlatform() === 'mac' ? 'Cmd' : 'Ctrl'}+Click opens one beside another.`}
              </div>
            )}
            {effectiveLayout && (
              <PaneLayoutView
                node={effectiveLayout}
                path={[]}
                panesById={panesById}
                renderPaneContent={renderPaneContent}
                focusedPaneId={focusedPaneId}
                showHeaders={splitActive}
                draggingPaneId={draggingPaneId}
                onFocus={(id) => setActivePane(deckKey, id)}
                onCloseLeaf={closeLeaf}
                onRatioChange={onRatioChange}
                onDropTab={onDropTab}
                onMakeOnly={makeOnlyPane}
                renderHeaderPrefix={renderPaneMark}
                draggingConversation={draggingConversation}
                onDropConversation={onDropConversation}
              />
            )}
          </div>
          {terminalOpen && <TerminalDrawer threadId={deckKey} cwd={terminalCwd} />}
        </div>
        <WorkDock deckKey={deckKey} activePane={activePane} layoutLeafIds={layoutLeafIds} panesById={panesById} conversations={conversations} />

        {tabMenu && tabMenuConv && (
          <ConversationActionMenu
            conversation={tabMenuConv}
            mutations={convMutations}
            position={{ top: tabMenu.top, left: tabMenu.left }}
            onClose={() => setTabMenu(null)}
            onCloseTab={() => closePane(deckKey, tabMenu.paneId)}
            onOpenInSplit={() => openInSplit(tabMenu.paneId, 'row')}
            onSplitDown={() => openInSplit(tabMenu.paneId, 'col')}
            onCloseOthers={() => {
              const panes = usePanesStore.getState().panesByWorkspace[deckKey] ?? []
              for (const p of panes) {
                if (p.paneId !== tabMenu.paneId && !p.isPermanent && p.paneType !== 'home') closePane(deckKey, p.paneId)
              }
            }}
            onCloseRight={() => {
              const panes = usePanesStore.getState().panesByWorkspace[deckKey] ?? []
              const idx = panes.findIndex((p) => p.paneId === tabMenu.paneId)
              if (idx < 0) return
              for (const p of panes.slice(idx + 1)) {
                if (!p.isPermanent && p.paneType !== 'home') closePane(deckKey, p.paneId)
              }
            }}
            onCloseAll={closeAllPanes}
          />
        )}

        {paneMenu && (
          <PaneTabMenu
            position={{ top: paneMenu.top, left: paneMenu.left }}
            onClose={() => setPaneMenu(null)}
            onOpenInSplit={() => openInSplit(paneMenu.paneId, 'row')}
            onSplitDown={() => openInSplit(paneMenu.paneId, 'col')}
            onCloseTab={paneMenu.permanent ? undefined : () => closePane(deckKey, paneMenu.paneId)}
            onCloseAll={closeAllPanes}
          />
        )}

        {convMutations.forkTarget && (
          <ForkModal
            conversation={convMutations.forkTarget}
            initialMode={convMutations.forkTargetMode}
            initialFocus={convMutations.forkTargetFocus}
            isPending={convMutations.isForkPending}
            onClose={convMutations.closeForkModal}
            onConfirm={(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness, projectKey) => {
              convMutations.submitFork(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness, projectKey)
            }}
          />
        )}
        {convMutations.addSkillsTarget && (
          <AddSkillsModal conversation={convMutations.addSkillsTarget} onClose={convMutations.closeAddSkillsModal} />
        )}
      </div>
    </StageDeckProvider>
  )
}
