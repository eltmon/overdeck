import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import type { NeedsYouItem } from '../../../lib/selectors/needsYou'
import { HomeNeedsYou } from './HomeNeedsYou'

function items(): NeedsYouItem[] {
  return [
    { key: 'conversation:fixture-1', kind: 'pending-input', title: 'Fixture conversation', ask: 'Which branch should I use?', open: vi.fn() },
    { key: 'issue:WFX-2', kind: 'issue', title: 'Add the widget', ask: 'Approve the plan', open: vi.fn() },
    { key: 'flywheel:abc', kind: 'flywheel', title: 'Flywheel parked an item', ask: 'Decide the merge order', open: vi.fn() },
    { key: 'decision:d1', kind: 'decision', title: 'Approve a test removal?', ask: 'Two tests were removed', open: vi.fn() },
  ]
}

afterEach(() => {
  cleanup()
})

describe('HomeNeedsYou (PAN-5294 G-D12)', () => {
  it('renders one row per item with its kind tag, ask and action', () => {
    render(<HomeNeedsYou items={items()} />)

    const rows = screen.getAllByTestId('needs-you-row')
    expect(rows).toHaveLength(4)
    expect(rows.map((row) => within(row).getByRole('button').textContent)).toEqual(['Answer', 'Open', 'Open Flywheel', 'Decide'])
    expect(rows[0]).toHaveTextContent('waiting on you')
    expect(rows[0]).toHaveTextContent('Which branch should I use?')
    expect(rows[1]).toHaveTextContent('WFX-2')
    expect(rows[1]).toHaveTextContent('needs you')
    expect(rows[2]).toHaveTextContent('flywheel')
    expect(rows[3]).toHaveTextContent('decision')
    expect(rows[0]).not.toHaveTextContent('conversation:')
  })

  it('calls the item open() once when its button is clicked', () => {
    const list = items()
    render(<HomeNeedsYou items={list} />)

    fireEvent.click(screen.getByRole('button', { name: 'Decide' }))
    expect(list[3]!.open).toHaveBeenCalledTimes(1)
    expect(list[0]!.open).not.toHaveBeenCalled()
  })

  it('forwards its ref to the section', () => {
    const ref = createRef<HTMLElement>()
    render(<HomeNeedsYou ref={ref} items={items()} />)
    expect(ref.current).toBe(screen.getByRole('region', { name: 'Needs you' }))
  })

  it('renders nothing for an empty list', () => {
    const { container } = render(<HomeNeedsYou items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
