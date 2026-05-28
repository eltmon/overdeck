import { useEffect } from 'react'
import {
  usePanesStore,
  selectPanesForWorkspace,
  selectActivePaneId,
  type WorkspacePane,
  type WorkspaceId,
  type PaneType,
} from '../../lib/panesStore'
import type { Conversation } from '../CommandDeck/ConversationList'
import { PaneBar } from './PaneBar'
import { useStageShortcuts } from './useStageShortcuts'
import { HomePane } from './HomePane'
import { WorkspaceHeader } from './HomePane/WorkspaceHeader'
import { StatChips } from './HomePane/StatChips'
import { Launcher } from './HomePane/Launcher'
import { AgentDock } from './HomePane/AgentDock'
import { ActionDock } from './HomePane/ActionDock'
import { Timeline } from './HomePane/Timeline'
import { HomePaneSections } from './HomePane/HomePaneSections'
import { dispatchLauncherIntent } from './HomePane/launcherActions'
import { readLastUsedAgent, writeLastUsedAgent } from './HomePane/launcherOrdering'
import type { TimelineConversation } from './HomePane/timeline'
import { TerminalPane } from './panes/TerminalPane'
import { CommitsPane } from './panes/CommitsPane'
import { PlanPane } from './panes/PlanPane'
import { DocsPane } from './panes/DocsPane'
import { AgentPane } from './panes/AgentPane'
import type { StageContext, PaneWrapperProps } from './types'
import styles from './stage.module.css'

export type { StageContext, PaneWrapperProps } from './types'

export interface StageProps {
  workspaceId: WorkspaceId
  /** Issue title for the workspace header (falls back to the id). */
  issueTitle?: string
  /** Feature branch; defaults to feature/<workspaceId>. */
  branch?: string
  /** Issue creation time for the age stat chip. */
  issueCreatedAt?: number | string
  /** The workspace's agent id — used as the workspace terminal session. */
  agentId?: string
  /** All conversations; the Stage filters to this workspace. */
  conversations?: Conversation[]
  /** Create a conversation for this workspace via the existing flow. */
  onCreateConversation?: (agentId: string) => void
}

const PANE_LABELS: Record<PaneType, string> = {
  home: 'Home',
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

/** Dispatch a non-home pane to its wrapper. The home pane is composed in the
 * Stage body (it needs workspace data), so it is handled before this. */
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
    default:
      return <PanePlaceholder pane={pane} ctx={ctx} />
  }
}

/**
 * Stage — the Command Deck's main work area (PAN-1549). Renders the persistent
 * PaneBar plus the active pane. The permanent HOME pane is composed here from
 * the workspace's data (header/stats/launcher/docks/timeline/sections); all
 * other panes dispatch through renderPane. Pane state lives in `panesStore`.
 */
export function Stage({
  workspaceId,
  issueTitle,
  branch,
  issueCreatedAt,
  agentId,
  conversations = [],
  onCreateConversation,
}: StageProps) {
  const ensureHome = usePanesStore((s) => s.ensureHome)
  const addPane = usePanesStore((s) => s.addPane)
  const closePane = usePanesStore((s) => s.closePane)
  const setActivePane = usePanesStore((s) => s.setActivePane)
  const panes = usePanesStore(selectPanesForWorkspace(workspaceId))
  const activePaneId = usePanesStore(selectActivePaneId(workspaceId))

  useEffect(() => {
    ensureHome(workspaceId)
  }, [workspaceId, ensureHome])

  useStageShortcuts(workspaceId)

  const openPane = (spec: Parameters<typeof addPane>[1]) => addPane(workspaceId, spec)
  const openTypedPane = (paneType: PaneType) =>
    openPane({
      paneType,
      label: PANE_LABELS[paneType],
      ...(paneType === 'terminal' ? { terminalId: agentId ?? null } : {}),
    })

  const wsConversations = conversations.filter(
    (c) => (c.issueId ?? '').toUpperCase() === workspaceId.toUpperCase(),
  )

  /** Open the agent pane for a conversation, or focus it if already open. */
  const openOrFocusAgentPane = (conversationId: string, label: string) => {
    const existing = panes.find(
      (p) => p.paneType === 'agent' && p.conversationId === conversationId,
    )
    if (existing) setActivePane(workspaceId, existing.paneId)
    else openPane({ paneType: 'agent', label, conversationId })
  }

  const ctx: StageContext = {
    workspaceId,
    openPane,
    resolveAgentPane: (pane) => {
      if (!pane.conversationId) return undefined
      const conversation = conversations.find((c) => c.name === pane.conversationId)
      return conversation ? { conversation } : undefined
    },
  }

  const timelineConversations: TimelineConversation[] = wsConversations.map((c) => ({
    id: c.name,
    agentLabel: c.title ?? c.model ?? 'Agent',
    timestamp: c.lastAttachedAt ?? c.createdAt,
    preview: c.title ?? undefined,
  }))

  const onAgentSelected = (id: string) => {
    writeLastUsedAgent(workspaceId, id)
    onCreateConversation?.(id)
  }

  const homePane = (
    <HomePane
      workspaceId={workspaceId}
      openPane={openPane}
      header={
        <>
          <WorkspaceHeader
            name={issueTitle ?? workspaceId}
            branch={branch ?? `feature/${workspaceId.toLowerCase()}`}
            iconLabel={(issueTitle ?? workspaceId).charAt(0).toUpperCase()}
          />
          <StatChips createdAt={issueCreatedAt} conversationCount={wsConversations.length} />
        </>
      }
      launcher={
        <Launcher
          lastUsedAgentId={readLastUsedAgent(workspaceId)}
          onSelect={(intent, query) =>
            dispatchLauncherIntent(intent, query, {
              openAgent: (i) => onAgentSelected(i.id),
              openTerminal: () => openTypedPane('terminal'),
              openWeb: (_q, url) =>
                openPane({ paneType: 'browser', label: PANE_LABELS.browser, browserInitialUrl: url }),
              onAgentRun: (id) => writeLastUsedAgent(workspaceId, id),
            })
          }
        />
      }
      agentDock={<AgentDock onSelectAgent={onAgentSelected} />}
      actionDock={<ActionDock onOpen={openTypedPane} />}
      timeline={
        <Timeline
          conversations={timelineConversations}
          onOpen={(id) => {
            const conv = wsConversations.find((c) => c.name === id)
            openOrFocusAgentPane(id, conv?.title ?? 'Agent')
          }}
        />
      }
      detail={<HomePaneSections issueId={workspaceId} />}
    />
  )

  const activePane = panes.find((p) => p.paneId === activePaneId) ?? null

  return (
    <div className={styles.stage}>
      <PaneBar
        panes={panes}
        activePaneId={activePaneId}
        onSelect={(paneId) => setActivePane(workspaceId, paneId)}
        onClose={(paneId) => closePane(workspaceId, paneId)}
        onAdd={() => openTypedPane('terminal')}
      />
      <div className={styles.pane}>
        {activePane &&
          (activePane.paneType === 'home' ? homePane : renderPane(activePane, ctx))}
      </div>
    </div>
  )
}
