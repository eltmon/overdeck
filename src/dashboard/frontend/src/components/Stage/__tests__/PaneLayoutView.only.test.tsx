/** PAN-5343 H-D19: the split header's "Make this the only pane" button. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { PaneLayoutView } from '../PaneLayoutView'
import { presetLayout } from '../../../lib/paneLayout'
import type { WorkspacePane } from '../../../lib/panesStore'

const panes = new Map<string, WorkspacePane>([
  ['left', { paneId: 'left', label: 'Left' } as unknown as WorkspacePane],
  ['right', { paneId: 'right', label: 'Right' } as unknown as WorkspacePane],
])

function renderLayout(onMakeOnly?: (paneId: string) => void) {
  const onFocus = vi.fn()
  render(
    <PaneLayoutView
      node={presetLayout(['left', 'right'], 2)}
      path={[]}
      panesById={panes}
      renderPaneContent={(pane) => <div>{`Content ${pane.paneId}`}</div>}
      focusedPaneId="left"
      showHeaders
      draggingPaneId={null}
      onFocus={onFocus}
      onCloseLeaf={vi.fn()}
      onRatioChange={vi.fn()}
      onDropTab={vi.fn()}
      onMakeOnly={onMakeOnly}
    />,
  )
}

afterEach(cleanup)

describe('PaneLayoutView make-only button (PAN-5343 H-D19)', () => {
  it('calls onMakeOnly with that leaf\'s pane id', () => {
    const onMakeOnly = vi.fn()
    renderLayout(onMakeOnly)
    const buttons = screen.getAllByRole('button', { name: 'Make this the only pane' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1]!)
    expect(onMakeOnly).toHaveBeenCalledWith('right')
  })

  it('renders no button without onMakeOnly', () => {
    renderLayout()
    expect(screen.queryByRole('button', { name: 'Make this the only pane' })).not.toBeInTheDocument()
  })
})
