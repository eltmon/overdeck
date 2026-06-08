import { ConversationPanel, type ViewMode } from '../../chat/ConversationPanel'
import { SessionPanel } from '../../CommandDeck/SessionView/SessionPanel'
import { usePanesStore } from '../../../lib/panesStore'
import type { PaneWrapperProps } from '../types'
import styles from '../stage.module.css'

/**
 * AgentPane — paneType='agent' (PAN-1549). Renders the existing components
 * unchanged: a session-backed pane uses SessionPanel (which owns its own
 * conversation/terminal/findings toggle), while a conversation-backed pane
 * uses ConversationPanel with a conversation/terminal toggle. The conversation
 * pane's viewMode is persisted onto the WorkspacePane via updatePane so it
 * survives switching away and back. Backing data is resolved by the Stage
 * mount point via `ctx.resolveAgentPane` (absent during build-then-swap).
 */
export function AgentPane({ pane, ctx }: PaneWrapperProps) {
  const updatePane = usePanesStore((s) => s.updatePane)
  const data = ctx.resolveAgentPane?.(pane)

  if (data?.session) {
    // SessionPanel owns its own view toggle + persistence; do not modify it.
    return <SessionPanel session={data.session} issueId={pane.issueId ?? ctx.workspaceId} />
  }

  if (data?.conversation) {
    const viewMode: ViewMode = pane.viewMode === 'terminal' ? 'terminal' : 'conversation'
    return (
      <ConversationPanel
        conversation={data.conversation}
        viewMode={viewMode}
        onViewModeChange={(mode) => updatePane(ctx.workspaceId, pane.paneId, { viewMode: mode })}
        targetMessageId={pane.targetMessageId}
        targetMessageIndex={pane.targetMessageIndex}
        targetMessageNonce={pane.targetMessageNonce}
      />
    )
  }

  return <div className={styles.placeholder}>Agent conversation unavailable.</div>
}
