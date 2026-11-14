import { fireEvent, render, screen } from '@testing-library/react'
import type { EditWorkspacePr } from '@overdeck/contracts'
import { describe, expect, it, vi } from 'vitest'
import { PrStatusRow, UNCOMMITTED_REASON } from '../PrStatusRow'

function pr(over: Partial<EditWorkspacePr> = {}): EditWorkspacePr {
  return {
    url: 'https://github.com/o/r/pull/7', number: 7, state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN', headSha: 'abc', canMerge: true, reason: null, ...over,
  }
}

const handlers = () => ({ onMerge: vi.fn(), onRefresh: vi.fn(), onPush: vi.fn() })

describe('PrStatusRow', () => {
  it('disables Merge with the verdict reason for a DIRTY PR', () => {
    const dirty = pr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', canMerge: false, reason: 'Conflicts with the base branch' })
    render(<PrStatusRow pr={dirty} hasChanges={false} merging={false} {...handlers()} />)
    const merge = screen.getByRole('button', { name: 'Merge' })
    expect(merge).toBeDisabled()
    expect(merge).toHaveAttribute('title', 'Conflicts with the base branch')
    expect(screen.getByTestId('edit-pr-merge-reason').textContent).toBe('Conflicts with the base branch')
  })

  it('disables Merge and offers Push changes while there are uncommitted changes', () => {
    const h = handlers()
    render(<PrStatusRow pr={pr()} hasChanges merging={false} {...h} />)
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled()
    expect(screen.getByTestId('edit-pr-merge-reason').textContent).toBe(UNCOMMITTED_REASON)
    fireEvent.click(screen.getByRole('button', { name: 'Push changes' }))
    expect(h.onPush).toHaveBeenCalledTimes(1)
  })

  it('calls onMerge from an enabled Merge and onRefresh from Refresh', () => {
    const h = handlers()
    render(<PrStatusRow pr={pr()} hasChanges={false} merging={false} {...h} />)
    expect(screen.queryByTestId('edit-pr-merge-reason')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    expect(h.onMerge).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(h.onRefresh).toHaveBeenCalledTimes(1)
  })

  it('links the PR and shows its state as a word', () => {
    render(<PrStatusRow pr={pr({ isDraft: true })} hasChanges={false} merging={false} {...handlers()} />)
    expect(screen.getByRole('link', { name: 'PR #7' })).toHaveAttribute('href', 'https://github.com/o/r/pull/7')
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  it('shows no Merge for a merged PR', () => {
    render(<PrStatusRow pr={pr({ state: 'MERGED', canMerge: false, reason: 'Already merged' })} hasChanges={false} merging={false} {...handlers()} />)
    expect(screen.getByText('Merged')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
  })
})
