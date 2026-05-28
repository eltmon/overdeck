import type { SessionNode as SessionNodeType } from '@panctl/contracts'
import type { WorkspacePane, WorkspaceId, PaneSpec } from '../../lib/panesStore'
import type { Conversation } from '../CommandDeck/ConversationList'

/** Backing data for an agent pane, resolved by the Stage mount point. */
export interface AgentPaneData {
  conversation?: Conversation
  session?: SessionNodeType
}

/**
 * Context every pane wrapper receives. The Stage is workspace/issue-scoped
 * (PAN-1549 D3), so `workspaceId` doubles as the issue id. `openPane` lets a
 * pane open + activate another pane. Later pane-wrapper beads widen this as
 * they need more workspace context.
 */
export interface StageContext {
  workspaceId: WorkspaceId
  openPane: (spec: PaneSpec) => void
  /** The workspace's agent id — used for diff/files queries (FilesPane). */
  agentId?: string
  /**
   * Resolve an agent pane's backing conversation/session. Supplied by the
   * Stage mount point (the mount-stage capstone, per D10); absent during
   * build-then-swap, so AgentPane degrades to a graceful "unavailable" state.
   */
  resolveAgentPane?: (pane: WorkspacePane) => AgentPaneData | undefined
}

/** Prop contract for a pane wrapper component: its pane + the Stage context. */
export interface PaneWrapperProps {
  pane: WorkspacePane
  ctx: StageContext
}
