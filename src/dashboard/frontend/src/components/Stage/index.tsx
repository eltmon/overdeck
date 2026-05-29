import { useEffect, useMemo, useCallback, type ReactNode } from 'react'
import {
  usePanesStore,
  selectPanesForWorkspace,
  selectActivePaneId,
  type WorkspacePane,
  type PaneType,
  type PaneSpec,
} from '../../lib/panesStore'
import type { Conversation } from '../CommandDeck/ConversationList'
import { PaneBar } from './PaneBar'
import { useStageShortcuts } from './useStageShortcuts'
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
export function Stage({ deckKey, conversations = [], renderHome, renderIssue }: StageProps) {
  const ensureHome = usePanesStore((s) => s.ensureHome)
  const addPane = usePanesStore((s) => s.addPane)
  const closePane = usePanesStore((s) => s.closePane)
  const setActivePane = usePanesStore((s) => s.setActivePane)
  const panes = usePanesStore(selectPanesForWorkspace(deckKey))
  const activePaneId = usePanesStore(selectActivePaneId(deckKey))

  useEffect(() => {
    ensureHome(deckKey)
  }, [deckKey, ensureHome])

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
    () => ({ deckKey, openPane, openTypedPane, openIssue, openOrFocusAgentPane }),
    [deckKey, openPane, openTypedPane, openIssue, openOrFocusAgentPane],
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
  const handleAddPane = useCallback(() => openTypedPane('terminal'), [openTypedPane])

  const activePane = panes.find((p) => p.paneId === activePaneId) ?? null

  return (
    <div className={styles.stage}>
      <PaneBar
        panes={panes}
        activePaneId={activePaneId}
        onSelect={handleSelectPane}
        onClose={handleClosePane}
        onAdd={handleAddPane}
      />
      <div className={styles.pane}>
        {activePane &&
          (activePane.paneType === 'home'
            ? renderHome(api)
            : activePane.paneType === 'issue'
              ? renderIssue(activePane.issueId ?? '', api)
              : renderPane(activePane, ctx))}
      </div>
    </div>
  )
}
