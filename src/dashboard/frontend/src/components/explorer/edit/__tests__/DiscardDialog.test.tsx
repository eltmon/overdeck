import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { EditWorkspaceStatus } from '@overdeck/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const http = vi.hoisted(() => ({ discardEditWorkspace: vi.fn() }))
vi.mock('../edit-workspace-http', () => http)

import { DiscardDialog } from '../DiscardDialog'

const OPEN_PR = {
  url: 'https://github.com/o/r/pull/7', number: 7, state: 'OPEN' as const, isDraft: false, mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN', headSha: 'abc', canMerge: true, reason: null,
}

function status(pr: EditWorkspaceStatus['pr'] = null): EditWorkspaceStatus {
  return {
    workspace: {
      id: 'w1', rootId: 'workspace:w1', name: 'edit-1113-1405', branch: 'scratch/edit-1113-1405',
      projectKey: 'p', defaultBranch: 'main', path: '/p/workspaces/scratch-edit-1113-1405',
    },
    pr,
    unpushedCommits: false,
    prSupport: { available: true, reason: null },
    pipelineSupport: { available: true, reason: null },
  }
}

beforeEach(() => {
  http.discardEditWorkspace.mockReset()
  http.discardEditWorkspace.mockResolvedValue({ removed: true, prClosed: false })
})

describe('DiscardDialog', () => {
  it('lists the uncommitted and the unsaved paths', () => {
    render(<DiscardDialog status={status()} uncommittedPaths={['README.md']} unsavedPaths={['src/a.ts']} onClose={() => {}} onDiscarded={() => {}} />)
    const items = screen.getByTestId('discard-paths').querySelectorAll('li')
    expect([...items].map((li) => li.textContent)).toEqual(['README.md', 'src/a.ts'])
  })

  it('says there is nothing to lose and hides the PR checkbox without an open PR', async () => {
    const onDiscarded = vi.fn()
    render(<DiscardDialog status={status()} uncommittedPaths={[]} unsavedPaths={[]} onClose={() => {}} onDiscarded={onDiscarded} />)
    expect(screen.getByText('No uncommitted changes.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Also close PR/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(onDiscarded).toHaveBeenCalled())
    expect(http.discardEditWorkspace).toHaveBeenCalledWith('w1', false)
  })

  it('closes the open PR by default and sends closePr false when unchecked', async () => {
    const onDiscarded = vi.fn()
    render(<DiscardDialog status={status(OPEN_PR)} uncommittedPaths={[]} unsavedPaths={[]} onClose={() => {}} onDiscarded={onDiscarded} />)
    const box = screen.getByLabelText('Also close PR #7') as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(onDiscarded).toHaveBeenCalled())
    expect(http.discardEditWorkspace).toHaveBeenCalledWith('w1', false)
  })

  it('shows a failure in the dialog', async () => {
    http.discardEditWorkspace.mockRejectedValue(new Error('Closing PR #7 failed: HTTP 502'))
    render(<DiscardDialog status={status(OPEN_PR)} uncommittedPaths={[]} unsavedPaths={[]} onClose={() => {}} onDiscarded={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect((await screen.findByTestId('discard-error')).textContent).toBe('Closing PR #7 failed: HTTP 502')
  })
})
