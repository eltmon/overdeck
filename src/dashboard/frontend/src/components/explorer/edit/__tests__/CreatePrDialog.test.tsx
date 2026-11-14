import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { EditWorkspaceStatus } from '@overdeck/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const http = vi.hoisted(() => ({ createEditWorkspacePr: vi.fn() }))
vi.mock('../edit-workspace-http', () => http)

import { ExplorerHttpError } from '../../explorer-http'
import { CreatePrDialog } from '../CreatePrDialog'

const PIPELINE_REASON = 'Send through pipeline needs a project whose tracker is GitHub Issues and that has an issue_prefix.'

function status(over: Partial<EditWorkspaceStatus> = {}): EditWorkspaceStatus {
  return {
    workspace: {
      id: 'w1',
      rootId: 'workspace:w1',
      name: 'edit-1113-1405',
      branch: 'scratch/edit-1113-1405',
      projectKey: 'p',
      defaultBranch: 'main',
      path: '/p/workspaces/scratch-edit-1113-1405',
    },
    pr: null,
    unpushedCommits: false,
    prSupport: { available: true, reason: null },
    pipelineSupport: { available: true, reason: null },
    ...over,
  }
}

beforeEach(() => {
  http.createEditWorkspacePr.mockReset()
})

describe('CreatePrDialog', () => {
  it('opens a draft PR with the default title from Open PR', async () => {
    const result = { mode: 'direct', url: 'https://github.com/o/r/pull/9', number: 9, created: true }
    http.createEditWorkspacePr.mockResolvedValue(result)
    const onDone = vi.fn()
    render(<CreatePrDialog status={status()} changedPaths={['README.md']} onClose={() => {}} onDone={onDone} />)
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('chore: edit README.md')
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Why.' } })
    fireEvent.click(screen.getByLabelText('Open as a draft'))
    fireEvent.click(screen.getByRole('button', { name: 'Open PR' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(result))
    expect(http.createEditWorkspacePr).toHaveBeenCalledWith('w1', { mode: 'direct', title: 'chore: edit README.md', body: 'Why.', draft: true })
  })

  it('sends mode pipeline from Send through pipeline', async () => {
    http.createEditWorkspacePr.mockResolvedValue({ mode: 'pipeline', issueId: 'PAN-77', issueUrl: 'i', prUrl: 'p', prNumber: 8 })
    const onDone = vi.fn()
    render(<CreatePrDialog status={status()} changedPaths={[]} onClose={() => {}} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send through pipeline' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(http.createEditWorkspacePr.mock.calls[0]?.[1]).toMatchObject({ mode: 'pipeline', title: 'chore: edit files', draft: false })
  })

  it('disables Send through pipeline and shows its reason without pipeline support', () => {
    render(
      <CreatePrDialog
        status={status({ pipelineSupport: { available: false, reason: PIPELINE_REASON } })}
        changedPaths={[]}
        onClose={() => {}}
        onDone={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Send through pipeline' })).toBeDisabled()
    expect(screen.getByTestId('pipeline-note').textContent).toBe(PIPELINE_REASON)
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeEnabled()
  })

  it('keeps a COMMIT_REFUSED message visible and stays open', async () => {
    const message = 'The commit was refused: ⧗ input: Fix typo\n✖ subject may not be empty [subject-empty]'
    http.createEditWorkspacePr.mockRejectedValue(new ExplorerHttpError(message, 422, 'COMMIT_REFUSED'))
    const onDone = vi.fn()
    render(<CreatePrDialog status={status()} changedPaths={[]} onClose={() => {}} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open PR' }))
    expect((await screen.findByTestId('create-pr-error')).textContent).toBe(message)
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByTestId('create-pr-dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeEnabled()
  })

  it('becomes Commit and push while a PR is open', async () => {
    http.createEditWorkspacePr.mockResolvedValue({ mode: 'direct', url: 'u', number: 4, created: false })
    const pr = {
      url: 'https://github.com/o/r/pull/4', number: 4, state: 'OPEN' as const, isDraft: false, mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN', headSha: 'abc', canMerge: true, reason: null,
    }
    render(<CreatePrDialog status={status({ pr })} changedPaths={['a.ts']} onClose={() => {}} onDone={() => {}} />)
    expect(screen.getByLabelText('Commit message')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send through pipeline' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Commit and push' }))
    await waitFor(() => expect(http.createEditWorkspacePr).toHaveBeenCalledWith('w1', expect.objectContaining({ mode: 'direct', draft: false })))
  })

  it('shows Working… on the pressed button while the request runs', async () => {
    http.createEditWorkspacePr.mockReturnValue(new Promise(() => {}))
    render(<CreatePrDialog status={status()} changedPaths={[]} onClose={() => {}} onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open PR' }))
    expect(await screen.findByRole('button', { name: 'Working…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send through pipeline' })).toBeDisabled()
  })
})
