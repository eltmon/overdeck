import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PaneBar } from './PaneBar'
import type { WorkspacePane } from '../../lib/panesStore'

function makePanes(): WorkspacePane[] {
  return [
    { paneId: 'h', paneType: 'home', label: 'Home', createdAt: 1, isPermanent: true },
    { paneId: 't', paneType: 'terminal', label: 'Terminal', createdAt: 2 },
    { paneId: 'd', paneType: 'docs', label: 'Docs', createdAt: 3 },
  ]
}

function makeAgentPane(conversationId: string): WorkspacePane {
  return { paneId: 'a', paneType: 'agent', label: 'Agent', createdAt: 4, conversationId }
}

describe('PaneBar', () => {
  it('renders a tab per pane in order, HOME first with a ⌘1 hint', () => {
    render(
      <PaneBar
        panes={makePanes()}
        activePaneId="h"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
      />,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0]).toHaveTextContent('Home')
    expect(tabs[0]).toHaveTextContent('⌘1')
    expect(tabs[1]).toHaveTextContent('Terminal')
    expect(tabs[1]).toHaveTextContent('⌘2')
  })

  it('marks the active tab with aria-selected', () => {
    render(
      <PaneBar
        panes={makePanes()}
        activePaneId="t"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
      />,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('HOME has no close button; other panes do', () => {
    render(
      <PaneBar
        panes={makePanes()}
        activePaneId="h"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
      />,
    )
    expect(screen.queryByLabelText('Close Home')).toBeNull()
    expect(screen.getByLabelText('Close Terminal')).toBeTruthy()
    expect(screen.getByLabelText('Close Docs')).toBeTruthy()
  })

  it('clicking a tab fires onSelect with its paneId', () => {
    const onSelect = vi.fn()
    render(
      <PaneBar
        panes={makePanes()}
        activePaneId="h"
        onSelect={onSelect}
        onClose={() => {}}
        onAdd={() => {}}
      />,
    )
    fireEvent.click(screen.getAllByRole('tab')[1])
    expect(onSelect).toHaveBeenCalledWith('t')
  })

  it('clicking × fires onClose and does not also fire onSelect', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <PaneBar
        panes={makePanes()}
        activePaneId="h"
        onSelect={onSelect}
        onClose={onClose}
        onAdd={() => {}}
      />,
    )
    fireEvent.click(screen.getByLabelText('Close Terminal'))
    expect(onClose).toHaveBeenCalledWith('t')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('clicking + fires onAdd', () => {
    const onAdd = vi.fn()
    render(
      <PaneBar
        panes={makePanes()}
        activePaneId="h"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={onAdd}
      />,
    )
    fireEvent.click(screen.getByLabelText('Open new pane'))
    expect(onAdd).toHaveBeenCalledOnce()
  })

  // PAN-1591 / detach-by-drag: dropping a conversation tab outside any split
  // drop zone (dropEffect === 'none') opens it in a new window.
  it('fires onTabDetach when a conversation tab drag ends outside any drop zone', () => {
    const onTabDetach = vi.fn()
    const panes = [...makePanes(), makeAgentPane('conv-1')]
    render(
      <PaneBar
        panes={panes}
        activePaneId="a"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
        onTabDetach={onTabDetach}
      />,
    )
    const agentTab = screen.getAllByRole('tab')[3]
    fireEvent.dragEnd(agentTab, { dataTransfer: { dropEffect: 'none' } })
    expect(onTabDetach).toHaveBeenCalledWith('a', 'conv-1')
  })

  it('does NOT fire onTabDetach when a conversation tab is dropped on a valid split zone', () => {
    const onTabDetach = vi.fn()
    const panes = [...makePanes(), makeAgentPane('conv-1')]
    render(
      <PaneBar
        panes={panes}
        activePaneId="a"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
        onTabDetach={onTabDetach}
      />,
    )
    const agentTab = screen.getAllByRole('tab')[3]
    // dropEffect === 'move' means a registered drop zone accepted the drag.
    fireEvent.dragEnd(agentTab, { dataTransfer: { dropEffect: 'move' } })
    expect(onTabDetach).not.toHaveBeenCalled()
  })

  it('does NOT fire onTabDetach for session-backed agent panes (no conversationId)', () => {
    const onTabDetach = vi.fn()
    const panes: WorkspacePane[] = [
      ...makePanes(),
      // agentId-backed pane (work/review specialist) — no conversationId.
      { paneId: 'spec', paneType: 'agent', label: 'Work · PAN-1', createdAt: 4, agentId: 'work-pan-1' },
    ]
    render(
      <PaneBar
        panes={panes}
        activePaneId="spec"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
        onTabDetach={onTabDetach}
      />,
    )
    const specTab = screen.getAllByRole('tab')[3]
    fireEvent.dragEnd(specTab, { dataTransfer: { dropEffect: 'none' } })
    expect(onTabDetach).not.toHaveBeenCalled()
  })

  it('does NOT fire onTabDetach for non-conversation pane types (issue, plan, docs, ...)', () => {
    const onTabDetach = vi.fn()
    render(
      <PaneBar
        panes={makePanes()}
        activePaneId="h"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
        onTabDetach={onTabDetach}
      />,
    )
    // Docs tab: not a conversation; drop outside should NOT trigger detach.
    const docsTab = screen.getAllByRole('tab')[2]
    fireEvent.dragEnd(docsTab, { dataTransfer: { dropEffect: 'none' } })
    expect(onTabDetach).not.toHaveBeenCalled()
  })
})
