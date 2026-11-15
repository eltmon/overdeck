import { describe, it, expect, vi, afterEach } from 'vitest'
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
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a tab per pane in order, HOME first, with no shortcut chip on any platform (PAN-5295)', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
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
    expect(tabs[1]).toHaveTextContent('Terminal')
    for (const tab of tabs) expect(tab.textContent).not.toContain('⌘')
  })

  it('N tabs ▾ lists every tab and selecting one calls onSelect (PAN-5295)', () => {
    const onSelect = vi.fn()
    render(<PaneBar panes={makePanes()} activePaneId="h" onSelect={onSelect} onClose={() => {}} onAdd={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: '3 tabs, list all tabs' }))
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((item) => item.textContent)).toEqual(['Home', 'Terminal', 'Docs'])
    expect(items[0]).toHaveAttribute('aria-checked', 'true')
    expect(items[1]).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(items[1])
    expect(onSelect).toHaveBeenCalledWith('t')
    expect(screen.queryByRole('menu', { name: 'All tabs' })).toBeNull()
  })

  it('a long label carries its full text in title, with no scroll arrows (PAN-5295)', () => {
    const label = 'A conversation title that runs well past sixty characters long'
    const panes = [...makePanes(), { paneId: 'l', paneType: 'agent' as const, label, createdAt: 5 }]
    render(<PaneBar panes={panes} activePaneId="h" onSelect={() => {}} onClose={() => {}} onAdd={() => {}} />)

    expect(label.length).toBeGreaterThanOrEqual(60)
    expect(screen.getAllByRole('tab')[3]).toHaveAttribute('title', label)
    expect(screen.queryByRole('button', { name: /Scroll tabs (left|right)/ })).toBeNull()
  })

  it('shows no ⌘N hint on Linux (PAN-5287 S-D9)', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64')
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
    expect(tabs[0]).toHaveTextContent('Home')
    expect(tabs[0]).not.toHaveTextContent('⌘1')
    expect(screen.queryByText('⌘2')).toBeNull()
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
