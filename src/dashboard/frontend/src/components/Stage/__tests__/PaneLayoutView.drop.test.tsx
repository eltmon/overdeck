/** PAN-5343 H-D8: dropping a conversation row onto a pane. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'

import { PaneLayoutView, type DropZone } from '../PaneLayoutView'
import { CONVERSATION_DRAG_TYPE } from '../conversationDragStore'
import { leaf } from '../../../lib/paneLayout'
import type { WorkspacePane } from '../../../lib/panesStore'

const panes = new Map<string, WorkspacePane>([
  ['p1', { paneId: 'p1', label: 'One' } as unknown as WorkspacePane],
])

type DropHandler = (targetPaneId: string, name: string, zone: DropZone) => void

function renderLeaf(props: { draggingConversation?: boolean; onDropConversation?: DropHandler; onDropTab?: DropHandler }) {
  render(
    <PaneLayoutView
      node={leaf('p1')}
      path={[]}
      panesById={panes}
      renderPaneContent={() => <div>content</div>}
      focusedPaneId="p1"
      showHeaders={false}
      draggingPaneId={null}
      onFocus={vi.fn()}
      onCloseLeaf={vi.fn()}
      onRatioChange={vi.fn()}
      onDropTab={props.onDropTab ?? vi.fn()}
      draggingConversation={props.draggingConversation}
      onDropConversation={props.onDropConversation}
    />,
  )
}

function dropAt(el: HTMLElement, clientX: number, data: Record<string, string>) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) })
  // happy-dom ignores clientX/clientY in a drag event's init, so set them on the event.
  const event = createEvent.drop(el, { dataTransfer: { getData: (type: string) => data[type] ?? '' } })
  Object.defineProperty(event, 'clientX', { value: clientX })
  Object.defineProperty(event, 'clientY', { value: 50 })
  fireEvent(el, event)
}

afterEach(cleanup)

describe('PaneLayoutView conversation drop (PAN-5343 H-D8)', () => {
  it('shows the drop overlay while a conversation is dragged', () => {
    renderLeaf({ draggingConversation: true, onDropConversation: vi.fn() })
    expect(screen.getByTestId('pane-drop-overlay')).toBeInTheDocument()
  })

  it('shows no overlay when nothing is dragged', () => {
    renderLeaf({})
    expect(screen.queryByTestId('pane-drop-overlay')).not.toBeInTheDocument()
  })

  it('a drop near the right edge calls onDropConversation with the pane, name and zone', () => {
    const onDropConversation = vi.fn()
    const onDropTab = vi.fn()
    renderLeaf({ draggingConversation: true, onDropConversation, onDropTab })
    dropAt(screen.getByTestId('pane-drop-overlay'), 95, { [CONVERSATION_DRAG_TYPE]: 'conv-x' })
    expect(onDropConversation).toHaveBeenCalledWith('p1', 'conv-x', 'right')
    expect(onDropTab).not.toHaveBeenCalled()
  })

  it('a drop in the centre reports the centre zone', () => {
    const onDropConversation = vi.fn()
    renderLeaf({ draggingConversation: true, onDropConversation })
    dropAt(screen.getByTestId('pane-drop-overlay'), 50, { [CONVERSATION_DRAG_TYPE]: 'conv-x' })
    expect(onDropConversation).toHaveBeenCalledWith('p1', 'conv-x', 'center')
  })
})
