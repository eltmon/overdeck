import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { EditWorkspaceStatus } from '@overdeck/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchEditWorkspaceStatus: vi.fn(),
  mergeEditWorkspace: vi.fn(),
  discardEditWorkspace: vi.fn(),
  createEditWorkspacePr: vi.fn(),
  leaveEditWorkspace: vi.fn(),
  openNewEditWorkspace: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('../edit-workspace-http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../edit-workspace-http')>()),
  mergeEditWorkspace: mocks.mergeEditWorkspace,
  discardEditWorkspace: mocks.discardEditWorkspace,
  createEditWorkspacePr: mocks.createEditWorkspacePr,
}))
vi.mock('../edit-workspace-switch', () => ({
  leaveEditWorkspace: mocks.leaveEditWorkspace,
  openNewEditWorkspace: mocks.openNewEditWorkspace,
}))

import { EditWorkspaceBanner } from '../EditWorkspaceBanner'

const SENTENCE = 'Editing in edit workspace edit-1113-1405 (branch scratch/edit-1113-1405). The main checkout is not changed.'
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
    prSupport: { available: true, reason: null },
    pipelineSupport: { available: true, reason: null },
  }
}

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EditWorkspaceBanner rootId="workspace:w1" deckKey="deck" paneId="f1" changedPaths={['README.md']} hasChanges={false} uncommittedPaths={[]} />
    </QueryClientProvider>,
  )
}

/** The status GET goes through fetch; the answer is whatever the test sets. */
function answerStatus(body: unknown, statusCode = 200) {
  mocks.fetchEditWorkspaceStatus.mockImplementation(async () => new Response(JSON.stringify(body), { status: statusCode }))
}

beforeEach(() => {
  vi.stubGlobal('fetch', (url: string) => mocks.fetchEditWorkspaceStatus(url))
  for (const fn of [mocks.fetchEditWorkspaceStatus, mocks.mergeEditWorkspace, mocks.discardEditWorkspace, mocks.createEditWorkspacePr, mocks.leaveEditWorkspace, mocks.openNewEditWorkspace]) fn.mockReset()
  mocks.toast.mockReset()
  mocks.toast.success.mockReset()
  mocks.toast.error.mockReset()
  mocks.openNewEditWorkspace.mockResolvedValue('workspace:w2')
})

describe('EditWorkspaceBanner', () => {
  it('renders the sentence with Create PR, Discard and New edit workspace', async () => {
    answerStatus(status())
    renderBanner()
    expect((await screen.findByTestId('edit-workspace-sentence')).textContent).toBe(SENTENCE)
    expect(screen.getByRole('button', { name: 'Create PR' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New edit workspace' }))
    expect(mocks.openNewEditWorkspace).toHaveBeenCalledWith('p', 'deck', 'f1')
  })

  it('renders nothing for a workspace that is not an edit workspace', async () => {
    answerStatus({ error: 'Workspace notes is not an explorer edit workspace.', code: 'NOT_AN_EDIT_WORKSPACE' }, 409)
    const { container } = renderBanner()
    await waitFor(() => expect(mocks.fetchEditWorkspaceStatus).toHaveBeenCalled())
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })

  it('shows the toast and leaves the edit workspace after a merge', async () => {
    answerStatus(status(OPEN_PR))
    mocks.mergeEditWorkspace.mockResolvedValue({ merged: true })
    renderBanner()
    fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(mocks.leaveEditWorkspace).toHaveBeenCalledWith('workspace:w1', 'p'))
    expect(mocks.mergeEditWorkspace).toHaveBeenCalledWith('w1')
    expect(mocks.toast.success).toHaveBeenCalledWith('Merged PR #7. The edit workspace was removed.')
    expect(screen.queryByRole('button', { name: 'Create PR' })).toBeNull()
  })

  it('leaves the edit workspace after a discard', async () => {
    answerStatus(status())
    mocks.discardEditWorkspace.mockResolvedValue({ removed: true, prClosed: false })
    renderBanner()
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    const dialogDiscard = screen.getAllByRole('button', { name: 'Discard' }).at(-1)!
    fireEvent.click(dialogDiscard)
    await waitFor(() => expect(mocks.leaveEditWorkspace).toHaveBeenCalledWith('workspace:w1', 'p'))
    expect(mocks.toast).toHaveBeenCalledWith('Discarded edit workspace edit-1113-1405.')
  })

  it('leaves the edit workspace and names the issue after a pipeline send', async () => {
    answerStatus(status())
    mocks.createEditWorkspacePr.mockResolvedValue({
      mode: 'pipeline', issueId: 'PAN-77', issueUrl: 'https://github.com/o/r/issues/77', prUrl: 'https://github.com/o/r/pull/88', prNumber: 88,
    })
    renderBanner()
    fireEvent.click(await screen.findByRole('button', { name: 'Create PR' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send through pipeline' }))
    await waitFor(() => expect(mocks.leaveEditWorkspace).toHaveBeenCalledWith('workspace:w1', 'p'))
    const message = String(mocks.toast.success.mock.calls[0]?.[0])
    expect(message).toContain('PAN-77')
    expect(message).toContain('#88')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})
