/** PAN-5291: keyboard focus inside a split pane activates it, as a mouse-down does. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { PaneLayoutView } from '../PaneLayoutView'
import type { PaneLayout } from '../../../lib/paneLayout'
import type { WorkspacePane } from '../../../lib/panesStore'

const layout = {
  kind: 'split',
  dir: 'row',
  ratio: 0.5,
  a: { kind: 'leaf', paneId: 'left' },
  b: { kind: 'leaf', paneId: 'right' },
} as unknown as PaneLayout

const panes = new Map<string, WorkspacePane>([
  ['left', { paneId: 'left', label: 'Left' } as unknown as WorkspacePane],
  ['right', { paneId: 'right', label: 'Right' } as unknown as WorkspacePane],
])

function renderLayout(focusedPaneId: string, onFocus = vi.fn()) {
  render(
    <PaneLayoutView
      node={layout}
      path={[]}
      panesById={panes}
      renderPaneContent={(pane) => <button type="button">{`Action in ${pane.paneId}`}</button>}
      focusedPaneId={focusedPaneId}
      showHeaders
      draggingPaneId={null}
      onFocus={onFocus}
      onCloseLeaf={vi.fn()}
      onRatioChange={vi.fn()}
      onDropTab={vi.fn()}
    />,
  )
  return onFocus
}

afterEach(cleanup)

describe('PaneLayoutView focus', () => {
  it('activates a pane when keyboard focus moves into it', () => {
    const onFocus = renderLayout('left')
    fireEvent.focus(screen.getByRole('button', { name: 'Action in right' }))
    expect(onFocus).toHaveBeenCalledWith('right')
  })

  it('does not re-activate the pane that is already active', () => {
    const onFocus = renderLayout('left')
    fireEvent.focus(screen.getByRole('button', { name: 'Action in left' }))
    expect(onFocus).not.toHaveBeenCalled()
  })
})
