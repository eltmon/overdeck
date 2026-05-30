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
import { useConversationMutations } from '../CommandDeck/useConversationMutations'
import { ConversationActionMenu } from '../CommandDeck/ConversationActionMenu'
import { ForkModal } from '../CommandDeck/ForkModal'
import { Bot, Terminal as TerminalIcon, Globe } from 'lucide-react'
import { PaneBar, type NewPaneAction } from './PaneBar'
import { useStageShortcuts } from './useStageShortcuts'
import { TerminalDrawer } from '../terminal/TerminalDrawer'
import { useTerminalStateStore, selectThreadTerminalState } from '../terminal/terminalStateStore'
import { TerminalPane } from './panes/TerminalPane'
import { CommitsPane } from './panes/CommitsPane'
import { PlanPane } from './panes/PlanPane'
import { DocsPane } from './panes/DocsPane'
import { AgentPane } from './panes/AgentPane'
import { FilesPane } from './panes/FilesPane'
import { BrowserPane } from './panes/BrowserPane'
import type { StageContext, PaneWrapperProps, StageApi } from './types'
import styles from './stage.module.css'

export type { StageContext, PaneWrapperProps, StageApi } from './types'

export interface StageProps {
  /** Pane-store key for this deck (PAN-1561: the project key). */
  deckKey: string
  /** All conversations; used to resolve agent panes. */
  conversations?: Conversation[]
  /** Working directory for new drawer terminals (the project path). */
  terminalCwd?: string
  /** Create a conversation for the deck's project (for the "+" New conversation
   * action); returns the new conversation name. */
  onCreateConversation?: (agentId: string) => Promise<string | undefined>
  /** Render the permanent HOME tab (project-scoped). */
  renderHome: (api: StageApi) => ReactNode
  /** Render an `issue` tab's body for the given issue id. */
  renderIssue: (issueId: string, api: StageApi) => ReactNode
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
    case 'files':
      return <FilesPane pane={pane} ctx={ctx} />
    case 'browser':
      return <BrowserPane pane={pane} ctx={ctx} />
    default:
      return <PanePlaceholder pane={pane} ctx={ctx} />
  }
}

/**
 * Stage — the project-scoped deck (PAN-1561, evolves PAN-1549). Renders the
 * persistent PaneBar plus the active pane. Pane state lives in `panesStore`,
 * keyed by `deckKey` (the project). The permanent HOME tab and any `issue` tab
 * are composed by the caller via `renderHome` / `renderIssue` (they need the
 * project's / issue's data); every other pane dispatches through `renderPane`.
 */
export function Stage({ deckKey, conversations = [], terminalCwd, onCreateConversation, renderHome, renderIssue }: StageProps) {
  const ensureHome = usePanesStore((s) => s.ensureHome)
  const addPane = usePanesStore((s) => s.addPane)
  const closePane = usePanesStore((s) => s.closePane)
  const setActivePane = usePanesStore((s) => s.setActivePane)
  const panes = usePanesStore(selectPanesForWorkspace(deckKey))
  const activePaneId = usePanesStore(selectActivePaneId(deckKey))
  const terminalOpen = useTerminalStateStore(
    (s) => selectThreadTerminalState(s.terminalStateByThreadId, deckKey).terminalOpen,
  )
  const setTerminalOpen = useTerminalStateStore((s) => s.setTerminalOpen)
  const toggleTerminal = useCallback(
    () => setTerminalOpen(deckKey, !terminalOpen),
    [setTerminalOpen, deckKey, terminalOpen],
  )

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
    const ISSUE_SCOPED = new Set<PaneType>(['files', 'commits', 'plan', 'docs'])
    for (const p of current) {
      // Terminals are drawer-only now.
      if (p.paneType === 'terminal') {
        closePane(deckKey, p.paneId)
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

  const api: StageApi = useMemo(
    () => ({ deckKey, openPane, openTypedPane, openIssue, openOrFocusAgentPane, toggleTerminal }),
    [deckKey, openPane, openTypedPane, openIssue, openOrFocusAgentPane, toggleTerminal],
  )

  const ctx: StageContext = useMemo(
    () => ({
      workspaceId: deckKey,
      openPane,
      resolveAgentPane: (pane) => {
        if (!pane.conversationId) return undefined
        const conversation = conversations.find((c) => c.name === pane.conversationId)
        return conversation ? { conversation } : undefined
      },
    }),
    [deckKey, openPane, conversations],
  )

  const handleSelectPane = useCallback(
    (paneId: string) => setActivePane(deckKey, paneId),
    [setActivePane, deckKey],
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
  const handlePaneContextMenu = useCallback(
    (pane: WorkspacePane, e: React.MouseEvent) => {
      if (pane.paneType !== 'agent' || !pane.conversationId) return
      if (!conversations.some((c) => c.name === pane.conversationId)) return
      e.preventDefault()
      setTabMenu({
        conversationName: pane.conversationId,
        paneId: pane.paneId,
        top: Math.min(e.clientY, window.innerHeight - 360),
        left: Math.min(e.clientX, window.innerWidth - 240),
      })
    },
    [conversations],
  )

  // PAN-1561: the "+" opens a menu of what to create, so it's explicit rather
  // than guessing. Fallback (⌘T / no menu) toggles the terminal drawer.
  const handleAddPane = useCallback(() => toggleTerminal(), [toggleTerminal])
  const newActions = useMemo<NewPaneAction[]>(() => {
    const actions: NewPaneAction[] = []
    if (onCreateConversation) {
      actions.push({
        key: 'conversation',
        label: 'New conversation',
        icon: Bot,
        onSelect: () => {
          void onCreateConversation('claude-code').then((name) => {
            if (name) openOrFocusAgentPane(name, 'Agent')
          })
        },
      })
    }
    actions.push({
      key: 'terminal',
      label: 'New terminal',
      icon: TerminalIcon,
      onSelect: () => setTerminalOpen(deckKey, true),
    })
    actions.push({
      key: 'web',
      label: 'Web',
      icon: Globe,
      onSelect: () => openPane({ paneType: 'browser', label: 'Web' }),
    })
    return actions
  }, [onCreateConversation, openOrFocusAgentPane, setTerminalOpen, deckKey, openPane])

  // Display panes: drop `terminal` panes (drawer-only now) and resolve agent
  // tab labels from the live conversation title so tabs are distinguishable
  // instead of a row of identical "New conversation"s.
  const displayPanes = useMemo(
    () =>
      panes
        .filter((p) => p.paneType !== 'terminal')
        .map((p) => {
          if (p.paneType !== 'agent') return p
          const conv = conversations.find((c) => c.name === p.conversationId)
          const title = conv?.title?.trim()
          // The server seeds untitled chats with the literal title "New
          // conversation"; treat that as untitled and disambiguate by a short
          // id so a row of brand-new chats isn't a wall of identical tabs.
          const isPlaceholder = !title || title.toLowerCase() === 'new conversation'
          const label = isPlaceholder
            ? `Chat ${(p.conversationId ?? '').split('-').pop() ?? ''}`.trim()
            : title
          return label === p.label ? p : { ...p, label }
        }),
    [panes, conversations],
  )

  const activePane = displayPanes.find((p) => p.paneId === activePaneId) ?? displayPanes[0] ?? null

  // Re-resolve the right-clicked tab's conversation from the live list so the
  // menu reflects current state and self-dismisses if the conversation is gone.
  const tabMenuConv = tabMenu ? conversations.find((c) => c.name === tabMenu.conversationName) ?? null : null

  return (
    <div className={styles.stage}>
      <PaneBar
        panes={displayPanes}
        activePaneId={activePane?.paneId ?? activePaneId}
        onSelect={handleSelectPane}
        onClose={handleClosePane}
        onAdd={handleAddPane}
        newActions={newActions}
        onPaneContextMenu={handlePaneContextMenu}
      />
      <div className={styles.pane}>
        {activePane &&
          (activePane.paneType === 'home'
            ? renderHome(api)
            : activePane.paneType === 'issue'
              ? renderIssue(activePane.issueId ?? '', api)
              : renderPane(activePane, ctx))}
      </div>
      {terminalOpen && <TerminalDrawer threadId={deckKey} cwd={terminalCwd} />}

      {tabMenu && tabMenuConv && (
        <ConversationActionMenu
          conversation={tabMenuConv}
          mutations={convMutations}
          position={{ top: tabMenu.top, left: tabMenu.left }}
          onClose={() => setTabMenu(null)}
          onCloseTab={() => closePane(deckKey, tabMenu.paneId)}
        />
      )}

      {convMutations.forkTarget && (
        <ForkModal
          conversation={convMutations.forkTarget}
          initialMode={convMutations.forkTargetMode}
          initialFocus={convMutations.forkTargetFocus}
          isPending={convMutations.isForkPending}
          onClose={convMutations.closeForkModal}
          onConfirm={(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness) => {
            convMutations.submitFork(conv, launchModel, summaryModel, forkMode, localSummaryOnly, includeThinkingInSummary, title, launchHarness, summaryHarness, focus, handoffAuthor, handoffAuthorModel, handoffAuthorHarness)
          }}
        />
      )}
    </div>
  )
}
