import { useEffect } from 'react'
import {
  usePanesStore,
  selectPanesForWorkspace,
  selectActivePaneId,
  type WorkspacePane,
  type WorkspaceId,
} from '../../lib/panesStore'
import { PaneBar } from './PaneBar'
import { useStageShortcuts } from './useStageShortcuts'
import { HomePane } from './HomePane'
import { TerminalPane } from './panes/TerminalPane'
import type { StageContext, PaneWrapperProps } from './types'
import styles from './stage.module.css'

export type { StageContext, PaneWrapperProps } from './types'

export interface StageProps {
  workspaceId: WorkspaceId
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

/** Dispatch a pane to its wrapper. Wrapper beads slot their cases in here;
 * everything unbuilt falls through to a safe placeholder. */
function renderPane(pane: WorkspacePane, ctx: StageContext) {
  switch (pane.paneType) {
    case 'home':
      return <HomePane workspaceId={ctx.workspaceId} openPane={ctx.openPane} />
    case 'terminal':
      return <TerminalPane pane={pane} ctx={ctx} />
    // Remaining wrappers are added by their respective beads (agent-pane,
    // commits-pane, plan-pane, docs-pane).
    default:
      return <PanePlaceholder pane={pane} ctx={ctx} />
  }
}

/**
 * Stage — the Command Deck's main work area (PAN-1549). Renders the persistent
 * PaneBar plus the active pane's body. Pane state lives in `panesStore`; this
 * shell wires the store to PaneBar and dispatches the active pane to its
 * wrapper. NOT mounted in CommandDeck until the `mount-stage` capstone bead.
 */
export function Stage({ workspaceId }: StageProps) {
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

  const activePane = panes.find((p) => p.paneId === activePaneId) ?? null
  const ctx: StageContext = {
    workspaceId,
    openPane: (spec) => addPane(workspaceId, spec),
  }

  return (
    <div className={styles.stage}>
      <PaneBar
        panes={panes}
        activePaneId={activePaneId}
        onSelect={(paneId) => setActivePane(workspaceId, paneId)}
        onClose={(paneId) => closePane(workspaceId, paneId)}
        onAdd={() => addPane(workspaceId, { paneType: 'terminal', label: 'Terminal' })}
      />
      <div className={styles.pane}>{activePane && renderPane(activePane, ctx)}</div>
    </div>
  )
}
