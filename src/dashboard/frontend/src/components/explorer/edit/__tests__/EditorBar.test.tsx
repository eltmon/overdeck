import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { EditWorkspaceChanges, EditWorkspacePr, EditWorkspaceStatus } from '@overdeck/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureEditRoot: vi.fn(),
  leaveEditWorkspace: vi.fn(),
  mergeEditWorkspace: vi.fn(),
  discardEditWorkspace: vi.fn(),
  createEditWorkspacePr: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('../edit-workspace-switch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../edit-workspace-switch')>()),
  ensureEditRoot: mocks.ensureEditRoot,
  leaveEditWorkspace: mocks.leaveEditWorkspace,
}))
vi.mock('../edit-workspace-http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../edit-workspace-http')>()),
  mergeEditWorkspace: mocks.mergeEditWorkspace,
  discardEditWorkspace: mocks.discardEditWorkspace,
  createEditWorkspacePr: mocks.createEditWorkspacePr,
}))
// The changes query watches the edit root; no watch stream in unit tests.
vi.mock('../../watch/explorer-watch-hub', () => ({ subscribeExplorerWatch: () => () => {} }))

import { draftKey, useCodeDrafts } from '../../code/code-drafts'
import { PR_STATUS_REFETCH_MS, shouldPollPr } from '../edit-workspace-http'
import { usePanesStore } from '../../../../lib/panesStore'
import {
  CHANGES_FAILED_REASON,
  CHECKING_CHANGES_REASON,
  CREATING_EDIT_NOTE,
  EditorBar,
  MAIN_CHECKOUT_SENTENCE,
  UNCOMMITTED_REASON,
  UNSAVED_REASON,
} from '../EditorBar'
import { useEditWorkspaceStore } from '../edit-workspace-store'

const DECK = 'p'
const sentence = () => screen.getByTestId('editor-bar-sentence').textContent

beforeEach(() => {
  for (const fn of [mocks.ensureEditRoot, mocks.leaveEditWorkspace, mocks.mergeEditWorkspace, mocks.discardEditWorkspace, mocks.createEditWorkspacePr]) fn.mockReset()
  mocks.toast.mockReset()
  mocks.toast.success.mockReset()
  mocks.toast.error.mockReset()
  useCodeDrafts.setState({ drafts: {} })
  mocks.ensureEditRoot.mockResolvedValue('workspace:w1')
  useEditWorkspaceStore.setState({ creating: {}, active: {}, pending: {}, landed: {} })
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('EditorBar on a project root (PAN-5290 FR-8, FR-11)', () => {
  it('says this is the main checkout and Start editing creates the edit root', () => {
    render(<EditorBar rootId="project:p" deckKey={DECK} paneId="c1" />)
    expect(sentence()).toBe(MAIN_CHECKOUT_SENTENCE)
    fireEvent.click(screen.getByRole('button', { name: 'Start editing' }))
    expect(mocks.ensureEditRoot).toHaveBeenCalledWith('project:p')
  })

  it('reads "Creating edit workspace…" while the edit workspace is being created', () => {
    useEditWorkspaceStore.getState().setCreating('p', true)
    render(<EditorBar rootId="project:p" deckKey={DECK} />)
    expect(sentence()).toBe(CREATING_EDIT_NOTE)
    expect(screen.queryByRole('button', { name: 'Start editing' })).toBeNull()
  })

  it('shows the merged note with Dismiss and Close tab', () => {
    useEditWorkspaceStore.getState().setLanded('p', { kind: 'merged', prNumber: 12, defaultBranch: 'main' })
    render(<EditorBar rootId="project:p" deckKey={DECK} paneId="c1" />)
    expect(sentence()).toBe('Merged PR #12 into main. The edit workspace and its branch were removed; this tab now shows main.')
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close tab' })).toBeTruthy()
  })

  it('shows the pipeline note with Open PR', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    useEditWorkspaceStore.getState().setLanded('p', { kind: 'pipeline', issueId: 'PAN-9', prNumber: 13, prUrl: 'https://github.com/o/r/pull/13' })
    render(<EditorBar rootId="project:p" deckKey={DECK} paneId="c1" />)
    expect(sentence()).toBe('Sent through the pipeline as PAN-9 · PR #13. Review agents will check it.')
    fireEvent.click(screen.getByRole('button', { name: 'Open PR' }))
    expect(open).toHaveBeenCalledWith('https://github.com/o/r/pull/13', '_blank', 'noopener')
  })

  it('shows the discarded note', () => {
    useEditWorkspaceStore.getState().setLanded('p', { kind: 'discarded', workspaceName: 'edit-1115-1200' })
    render(<EditorBar rootId="project:p" deckKey={DECK} paneId="c1" />)
    expect(sentence()).toBe('Discarded edit workspace edit-1115-1200. This tab now shows main.')
  })

  it('Dismiss clears the note and shows the main-checkout sentence again', () => {
    useEditWorkspaceStore.getState().setLanded('p', { kind: 'discarded', workspaceName: 'edit-1' })
    render(<EditorBar rootId="project:p" deckKey={DECK} paneId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(useEditWorkspaceStore.getState().landed.p).toBeUndefined()
    expect(sentence()).toBe(MAIN_CHECKOUT_SENTENCE)
  })

  it('Close tab closes the pane, and renders only in a code pane', () => {
    const closePane = vi.spyOn(usePanesStore.getState(), 'closePane').mockImplementation(() => {})
    useEditWorkspaceStore.getState().setLanded('p', { kind: 'merged', prNumber: 1, defaultBranch: 'main' })
    const { unmount } = render(<EditorBar rootId="project:p" deckKey={DECK} paneId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(closePane).toHaveBeenCalledWith(DECK, 'c1')
    unmount()
    render(<EditorBar rootId="project:p" deckKey={DECK} />)
    expect(screen.queryByRole('button', { name: 'Close tab' })).toBeNull()
  })

  it('a new edit workspace for the project clears its landed note', () => {
    useEditWorkspaceStore.getState().setLanded('p', { kind: 'discarded', workspaceName: 'edit-1' })
    useEditWorkspaceStore.getState().setCreating('p', true)
    expect(useEditWorkspaceStore.getState().landed.p).toBeUndefined()
  })

  it('renders nothing on an issue root', () => {
    const { container } = render(<EditorBar rootId="issue:PAN-1" deckKey={DECK} paneId="c1" />)
    expect(container.textContent).toBe('')
  })
})

// ─── Edit-workspace root (PAN-5290 FR-9, FR-10; ported from EditWorkspaceBanner and PrStatusRow tests) ───

const ROOT = 'workspace:w1'

function pr(over: Partial<EditWorkspacePr> = {}): EditWorkspacePr {
  return {
    url: 'https://github.com/o/r/pull/7', number: 7, state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN', headSha: 'abc', canMerge: true, reason: null, checksPassing: true, ...over,
  }
}

function status(p: EditWorkspacePr | null = null, over: Partial<EditWorkspaceStatus> = {}): EditWorkspaceStatus {
  return {
    workspace: {
      id: 'w1', rootId: ROOT, name: 'edit-1113-1405', branch: 'scratch/edit-1113-1405',
      projectKey: 'p', defaultBranch: 'main', path: '/p/workspaces/scratch-edit-1113-1405',
    },
    pr: p,
    unpushedCommits: false,
    prSupport: { available: true, reason: null },
    pipelineSupport: { available: true, reason: null },
    ...over,
  }
}

function changes(over: Partial<EditWorkspaceChanges> = {}): EditWorkspaceChanges {
  return {
    base: 'abc',
    files: [
      { path: 'README.md', status: 'M', additions: 4, deletions: 2, binary: false },
      { path: 'docs/new.md', status: 'A', additions: 2, deletions: 0, binary: false },
    ],
    additions: 6,
    deletions: 2,
    uncommittedPaths: [],
    ...over,
  }
}

type Answer = { body: unknown; status?: number }
let statusAnswer: Answer
let changesAnswer: Answer
let fetchMock: ReturnType<typeof vi.fn>

function stubServer(s: Answer, c: Answer = { body: changes() }) {
  statusAnswer = s
  changesAnswer = c
  fetchMock = vi.fn(async (url: string) => {
    const answer = url.endsWith('/changes') ? changesAnswer : statusAnswer
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
}

const statusCalls = () => fetchMock.mock.calls.filter(([url]) => !String(url).endsWith('/changes')).length

function renderWorkspaceBar(props: { onStale?: () => void; paneId?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EditorBar rootId={ROOT} deckKey={DECK} {...props} />
    </QueryClientProvider>,
  )
}

function dirty(path = 'README.md') {
  const key = draftKey(ROOT, path)
  useCodeDrafts.getState().loaded(key, 'one\n', 'sig-one')
  useCodeDrafts.getState().edited(key, 'two\n')
}

describe('EditorBar on an edit workspace without a PR', () => {
  it('names the workspace and branch with the files, +/− and save state, Discard… and a primary Create PR', async () => {
    stubServer({ body: status() })
    renderWorkspaceBar()
    await waitFor(() => expect(sentence()).toBe('Editing in edit-1113-1405 on scratch/edit-1113-1405 · 2 files changed +6 −2 · All edits saved'))
    expect(screen.getByRole('button', { name: 'Discard…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create PR' }).className).toContain('bg-primary')
    expect(screen.queryByRole('button', { name: 'Close tab' })).toBeNull()
  })

  it('reads Saving… while a draft on the edit root is unsaved', async () => {
    stubServer({ body: status() })
    dirty()
    renderWorkspaceBar()
    await waitFor(() => expect(sentence()).toContain('· Saving…'))
  })

  it('renders nothing for a workspace that is not an edit workspace', async () => {
    stubServer({ body: { error: 'Workspace notes is not an explorer edit workspace.', code: 'NOT_AN_EDIT_WORKSPACE' }, status: 409 })
    const { container } = renderWorkspaceBar()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })

  it('shows the error with Retry for any other failure', async () => {
    stubServer({ body: { error: 'git exploded', code: 'GIT_FAILED' }, status: 500 })
    renderWorkspaceBar()
    await waitFor(() => expect(sentence()).toBe("Couldn't read this edit workspace: git exploded"))
    const before = statusCalls()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(statusCalls()).toBeGreaterThan(before))
  })

  it('calls onStale when the status answers ROOT_NOT_FOUND', async () => {
    const onStale = vi.fn()
    stubServer({ body: { error: 'Workspace w1 not found.', code: 'ROOT_NOT_FOUND' }, status: 404 })
    renderWorkspaceBar({ onStale })
    await waitFor(() => expect(onStale).toHaveBeenCalled())
  })

  it('calls onStale when the changes query answers ROOT_NOT_FOUND', async () => {
    const onStale = vi.fn()
    stubServer({ body: status() }, { body: { error: 'Workspace w1 not found.', code: 'ROOT_NOT_FOUND' }, status: 404 })
    renderWorkspaceBar({ onStale })
    await waitFor(() => expect(onStale).toHaveBeenCalled())
  })

  it('refuses to open Create PR while a draft is unsaved', async () => {
    stubServer({ body: status() })
    dirty()
    renderWorkspaceBar()
    fireEvent.click(await screen.findByRole('button', { name: 'Create PR' }))
    expect(mocks.toast.error).toHaveBeenCalledWith('Save or discard your unsaved edits first: README.md.')
    expect(screen.queryByTestId('create-pr-dialog')).toBeNull()
  })

  it('sets the discarded note and leaves the edit workspace after a discard', async () => {
    stubServer({ body: status() })
    mocks.discardEditWorkspace.mockResolvedValue({ removed: true, prClosed: false })
    renderWorkspaceBar()
    fireEvent.click(await screen.findByRole('button', { name: 'Discard…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(mocks.leaveEditWorkspace).toHaveBeenCalledWith(ROOT, 'p'))
    expect(mocks.toast).toHaveBeenCalledWith('Discarded edit workspace edit-1113-1405.')
    expect(useEditWorkspaceStore.getState().landed.p).toEqual({ kind: 'discarded', workspaceName: 'edit-1113-1405' })
  })

  it('sets the pipeline note and leaves the edit workspace after a pipeline send', async () => {
    stubServer({ body: status() })
    mocks.createEditWorkspacePr.mockResolvedValue({
      mode: 'pipeline', issueId: 'PAN-77', issueUrl: 'https://github.com/o/r/issues/77', prUrl: 'https://github.com/o/r/pull/88', prNumber: 88,
    })
    renderWorkspaceBar()
    fireEvent.click(await screen.findByRole('button', { name: 'Create PR' }))
    fireEvent.click(screen.getByRole('radio', { name: /Send through the pipeline/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Send through the pipeline' }))
    await waitFor(() => expect(mocks.leaveEditWorkspace).toHaveBeenCalledWith(ROOT, 'p'))
    const message = String(mocks.toast.success.mock.calls[0]?.[0])
    expect(message).toContain('PAN-77')
    expect(message).toContain('#88')
    expect(useEditWorkspaceStore.getState().landed.p).toEqual({ kind: 'pipeline', issueId: 'PAN-77', prNumber: 88, prUrl: 'https://github.com/o/r/pull/88' })
  })

  it('names a closed PR before the editing sentence and offers Create PR again', async () => {
    stubServer({ body: status(pr({ state: 'CLOSED', canMerge: false, reason: 'closed' })) })
    renderWorkspaceBar()
    await waitFor(() => expect(sentence()).toMatch(/^PR #7 was closed\. Editing in edit-1113-1405/))
    expect(screen.getByRole('button', { name: 'Create PR' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard…' })).toBeInTheDocument()
  })
})

describe('EditorBar with a PR', () => {
  it('reads the blocked reason and disables Merge titled by it', async () => {
    stubServer({ body: status(pr({ mergeStateStatus: 'BLOCKED', canMerge: false, reason: 'Required checks or reviews are not met' })) })
    renderWorkspaceBar()
    await waitFor(() => expect(sentence()).toBe('PR #7 is open · Required checks or reviews are not met.'))
    const merge = screen.getByRole('button', { name: 'Merge' })
    expect(merge).toBeDisabled()
    expect(merge).toHaveAttribute('title', 'Required checks or reviews are not met')
    expect(screen.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', 'https://github.com/o/r/pull/7')
  })

  it('disables Merge with the verdict reason for a DIRTY PR', async () => {
    stubServer({ body: status(pr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', canMerge: false, reason: 'Conflicts with the base branch' })) })
    renderWorkspaceBar()
    const merge = await screen.findByRole('button', { name: 'Merge' })
    expect(merge).toBeDisabled()
    expect(merge).toHaveAttribute('title', 'Conflicts with the base branch')
    expect(screen.getByTestId('edit-pr-merge-reason').textContent).toBe('Conflicts with the base branch.')
  })

  it('reads no conflicts with an enabled primary Merge when GitHub allows it and nothing is uncommitted', async () => {
    stubServer({ body: status(pr()) })
    renderWorkspaceBar()
    await waitFor(() => expect(sentence()).toBe('PR #7 · no conflicts. Merging squashes it into main.'))
    const merge = screen.getByRole('button', { name: 'Merge' })
    expect(merge).toBeEnabled()
    expect(merge.className).toContain('bg-primary')
    expect(screen.queryByRole('button', { name: 'Push changes' })).toBeNull()
  })

  it('disables Merge and offers Push changes while there are uncommitted changes', async () => {
    stubServer({ body: status(pr()) }, { body: changes({ uncommittedPaths: ['README.md'] }) })
    renderWorkspaceBar()
    await waitFor(() => expect(screen.getByTestId('edit-pr-merge-reason').textContent).toBe(UNCOMMITTED_REASON))
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Push changes' }))
    expect(screen.getByTestId('create-pr-dialog')).toBeInTheDocument()
  })

  it('offers Push changes and blocks Merge when the branch has unpushed commits', async () => {
    stubServer({ body: status(pr(), { unpushedCommits: true }) })
    renderWorkspaceBar()
    await waitFor(() => expect(screen.getByTestId('edit-pr-merge-reason').textContent).toBe(UNCOMMITTED_REASON))
    expect(screen.getByRole('button', { name: 'Push changes' })).toBeInTheDocument()
  })

  it('keeps Merge disabled while the changes are still loading (CodeRabbit 4578715371)', async () => {
    stubServer({ body: status(pr()) })
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/changes') ? new Promise<Response>(() => {}) : new Response(JSON.stringify(status(pr())), { status: 200 }),
    )
    renderWorkspaceBar()
    await waitFor(() => expect(screen.getByTestId('edit-pr-merge-reason').textContent).toBe(CHECKING_CHANGES_REASON))
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled()
  })

  it('keeps Merge disabled and offers Retry when the changes cannot be read (CodeRabbit 4578715371)', async () => {
    stubServer({ body: status(pr()) }, { body: { error: 'git exploded', code: 'GIT_FAILED' }, status: 500 })
    renderWorkspaceBar()
    await waitFor(() => expect(screen.getByTestId('edit-pr-merge-reason').textContent).toBe(CHANGES_FAILED_REASON))
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled()
  })

  it('offers Retry on the editing line when the changes cannot be read', async () => {
    stubServer({ body: status() }, { body: { error: 'git exploded', code: 'GIT_FAILED' }, status: 500 })
    renderWorkspaceBar()
    await waitFor(() => expect(sentence()).toContain(CHANGES_FAILED_REASON))
    changesAnswer = { body: changes() }
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(sentence()).toContain('2 files changed +6 −2'))
  })

  it('blocks Merge while a draft on the edit root is unsaved', async () => {
    stubServer({ body: status(pr()) })
    dirty()
    renderWorkspaceBar()
    expect(await screen.findByRole('button', { name: 'Merge' })).toBeDisabled()
    expect(screen.getByTestId('edit-pr-merge-reason').textContent).toBe(UNSAVED_REASON)
    expect(mocks.mergeEditWorkspace).not.toHaveBeenCalled()
  })

  it('Refresh reads the status again', async () => {
    stubServer({ body: status(pr()) })
    renderWorkspaceBar()
    await screen.findByRole('button', { name: 'Merge' })
    const before = statusCalls()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(statusCalls()).toBeGreaterThan(before))
  })

  it('after a merge shows the toast, sets the merged note and leaves the edit workspace', async () => {
    stubServer({ body: status(pr()) })
    mocks.mergeEditWorkspace.mockResolvedValue({ merged: true })
    renderWorkspaceBar()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Merge' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(mocks.leaveEditWorkspace).toHaveBeenCalledWith(ROOT, 'p'))
    expect(mocks.mergeEditWorkspace).toHaveBeenCalledWith('w1')
    expect(mocks.toast.success).toHaveBeenCalledWith('Merged PR #7. The edit workspace was removed.')
    expect(useEditWorkspaceStore.getState().landed.p).toEqual({ kind: 'merged', prNumber: 7, defaultBranch: 'main' })
  })

  it('reads a PR merged on GitHub with Discard… and no Merge', async () => {
    stubServer({ body: status(pr({ state: 'MERGED', canMerge: false, reason: 'Already merged' })) })
    renderWorkspaceBar()
    await waitFor(() => expect(sentence()).toBe('PR #7 was merged on GitHub.'))
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Discard…' })).toBeInTheDocument()
  })

  it('names a draft PR as a draft', async () => {
    stubServer({ body: status(pr({ isDraft: true, canMerge: false, reason: 'This PR is a draft' })) })
    renderWorkspaceBar()
    await waitFor(() => expect(sentence()).toBe('PR #7 is a draft · This PR is a draft.'))
  })
})

describe('shouldPollPr (PAN-5290 C-D6)', () => {
  it('polls only while GitHub is still deciding an open, non-draft PR', () => {
    const blocked = { canMerge: false, reason: 'x' }
    expect(shouldPollPr(pr({ ...blocked, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }))).toBe(true)
    expect(shouldPollPr(pr({ ...blocked, mergeStateStatus: 'BLOCKED' }))).toBe(true)
    expect(shouldPollPr(pr({ ...blocked, isDraft: true, mergeStateStatus: 'BLOCKED' }))).toBe(false)
    expect(shouldPollPr(pr({ ...blocked, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }))).toBe(false)
    expect(shouldPollPr(pr({ ...blocked, mergeStateStatus: 'BEHIND' }))).toBe(false)
    expect(shouldPollPr(pr())).toBe(false)
    expect(shouldPollPr(pr({ ...blocked, state: 'MERGED' }))).toBe(false)
    expect(shouldPollPr(null)).toBe(false)
  })

  it('refetches the status after 15 000 ms for a BLOCKED PR', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    stubServer({ body: status(pr({ mergeStateStatus: 'BLOCKED', canMerge: false, reason: 'Required checks or reviews are not met' })) })
    renderWorkspaceBar()
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(statusCalls()).toBe(1)
    await act(() => vi.advanceTimersByTimeAsync(PR_STATUS_REFETCH_MS - 100))
    expect(statusCalls()).toBe(1)
    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(statusCalls()).toBe(2)
  })

  it('never refetches the status for a DIRTY PR', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    stubServer({ body: status(pr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', canMerge: false, reason: 'Conflicts with the base branch' })) })
    renderWorkspaceBar()
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(statusCalls()).toBe(1)
    await act(() => vi.advanceTimersByTimeAsync(PR_STATUS_REFETCH_MS * 3))
    expect(statusCalls()).toBe(1)
  })
})
