import type { WorkspacePane, WorkspaceId, PaneSpec } from '../../lib/panesStore'

/**
 * Context every pane wrapper receives. The Stage is workspace/issue-scoped
 * (PAN-1549 D3), so `workspaceId` doubles as the issue id. `openPane` lets a
 * pane open + activate another pane. Later pane-wrapper beads widen this as
 * they need more workspace context.
 */
export interface StageContext {
  workspaceId: WorkspaceId
  openPane: (spec: PaneSpec) => void
}

/** Prop contract for a pane wrapper component: its pane + the Stage context. */
export interface PaneWrapperProps {
  pane: WorkspacePane
  ctx: StageContext
}
