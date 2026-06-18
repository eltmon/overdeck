import type { SessionNode as SessionNodeType } from '@overdeck/contracts'
import type { WorkspacePane, WorkspaceId, PaneSpec, PaneType } from '../../lib/panesStore'
import type { Conversation } from '../CommandDeck/ConversationList'

/** Backing data for an agent pane, resolved by the Stage mount point. */
export interface AgentPaneData {
  conversation?: Conversation
  session?: SessionNodeType
}

/**
 * StageApi — the pane-opening surface the Stage hands to its render props
 * (ProjectHome and IssueOverview, PAN-1561). The Stage owns pane state keyed
 * by the project deck; these helpers let the home/issue content open and focus
 * tabs without reaching into the store directly.
 */
export interface StageApi {
  /** The deck's pane-store key (the project key). */
  deckKey: string
  /** Open + activate an arbitrary pane. */
  openPane: (spec: PaneSpec) => void
  /** Open + activate a typed pane; `terminalId` scopes a terminal to an agent. */
  openTypedPane: (paneType: PaneType, opts?: { terminalId?: string | null }) => void
  /** Open (or focus, if already open) an issue tab in the project deck. */
  openIssue: (issueId: string, label: string) => void
  /** Open (or focus) an agent pane backed by a conversation. */
  openOrFocusAgentPane: (conversationId: string, label: string) => void
  /** Toggle the terminal drawer stacked below the deck (PAN-1561). */
  toggleTerminal: () => void
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
