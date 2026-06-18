import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentPane } from './AgentPane'
import { usePanesStore, selectPanesForWorkspace } from '../../../lib/panesStore'
import type { SessionNode as SessionNodeType } from '@overdeck/contracts'
import type { Conversation } from '../../CommandDeck/ConversationList'
import type { StageContext, AgentPaneData } from '../types'

vi.mock('../../chat/ConversationPanel', () => ({
  ConversationPanel: ({
    conversation,
    viewMode,
    onViewModeChange,
    targetMessageId,
    targetMessageIndex,
    targetMessageNonce,
    onTargetMessageHandled,
  }: {
    conversation: { name: string }
    viewMode: string
    onViewModeChange: (m: string) => void
    targetMessageId?: string
    targetMessageIndex?: number
    targetMessageNonce?: number
    onTargetMessageHandled?: () => void
  }) => (
    <div
      data-testid="conversation-panel"
      data-view={viewMode}
      data-conv={conversation.name}
      data-target-id={targetMessageId ?? ''}
      data-target-index={targetMessageIndex ?? ''}
      data-target-nonce={targetMessageNonce ?? ''}
    >
      <button onClick={() => onViewModeChange('terminal')}>to-terminal</button>
      <button onClick={() => onTargetMessageHandled?.()}>target-handled</button>
    </div>
  ),
}))
vi.mock('../../CommandDeck/SessionView/SessionPanel', () => ({
  SessionPanel: ({ session, issueId }: { session: { id: string }; issueId?: string }) => (
    <div data-testid="session-panel" data-session={session.id} data-issue={issueId} />
  ),
}))

const WS = 'PAN-1549'

function ctxWith(data?: AgentPaneData): StageContext {
  return { workspaceId: WS, openPane: () => {}, resolveAgentPane: () => data }
}

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  usePanesStore.getState().ensureHome(WS)
})

describe('AgentPane', () => {
  it('renders ConversationPanel for a conversation-backed pane', () => {
    const id = usePanesStore.getState().addPane(WS, {
      paneType: 'agent',
      label: 'Agent',
      conversationId: 'conv-1',
    })
    const pane = selectPanesForWorkspace(WS)(usePanesStore.getState()).find((p) => p.paneId === id)!
    render(<AgentPane pane={pane} ctx={ctxWith({ conversation: { name: 'conv-1' } as unknown as Conversation })} />)
    expect(screen.getByTestId('conversation-panel')).toHaveAttribute('data-conv', 'conv-1')
    expect(screen.getByTestId('conversation-panel')).toHaveAttribute('data-view', 'conversation')
  })

  it('renders SessionPanel for a session-backed pane', () => {
    const id = usePanesStore.getState().addPane(WS, { paneType: 'agent', label: 'Review' })
    const pane = selectPanesForWorkspace(WS)(usePanesStore.getState()).find((p) => p.paneId === id)!
    render(<AgentPane pane={pane} ctx={ctxWith({ session: { id: 'sess-1' } as unknown as SessionNodeType })} />)
    const sp = screen.getByTestId('session-panel')
    expect(sp).toHaveAttribute('data-session', 'sess-1')
    expect(sp).toHaveAttribute('data-issue', WS)
  })

  it('persists viewMode changes onto the pane via updatePane', () => {
    const id = usePanesStore.getState().addPane(WS, {
      paneType: 'agent',
      label: 'Agent',
      conversationId: 'conv-1',
    })
    const pane = selectPanesForWorkspace(WS)(usePanesStore.getState()).find((p) => p.paneId === id)!
    render(<AgentPane pane={pane} ctx={ctxWith({ conversation: { name: 'conv-1' } as unknown as Conversation })} />)

    fireEvent.click(screen.getByText('to-terminal'))
    const updated = selectPanesForWorkspace(WS)(usePanesStore.getState()).find((p) => p.paneId === id)!
    expect(updated.viewMode).toBe('terminal')
  })

  it('clears one-shot target message fields after the conversation handles them', () => {
    const id = usePanesStore.getState().addPane(WS, {
      paneType: 'agent',
      label: 'Agent',
      conversationId: 'conv-1',
      targetMessageId: 'msg-1',
      targetMessageIndex: 3,
      targetMessageNonce: 7,
    })
    const pane = selectPanesForWorkspace(WS)(usePanesStore.getState()).find((p) => p.paneId === id)!
    render(<AgentPane pane={pane} ctx={ctxWith({ conversation: { name: 'conv-1' } as unknown as Conversation })} />)

    expect(screen.getByTestId('conversation-panel')).toHaveAttribute('data-target-id', 'msg-1')
    fireEvent.click(screen.getByText('target-handled'))

    const updated = selectPanesForWorkspace(WS)(usePanesStore.getState()).find((p) => p.paneId === id)!
    expect(updated.targetMessageId).toBeUndefined()
    expect(updated.targetMessageIndex).toBeUndefined()
    expect(updated.targetMessageNonce).toBeUndefined()
  })

  it('shows an unavailable state when no backing data resolves', () => {
    const id = usePanesStore.getState().addPane(WS, { paneType: 'agent', label: 'Agent' })
    const pane = selectPanesForWorkspace(WS)(usePanesStore.getState()).find((p) => p.paneId === id)!
    render(<AgentPane pane={pane} ctx={ctxWith(undefined)} />)
    expect(screen.getByText(/unavailable/i)).toBeTruthy()
  })
})
