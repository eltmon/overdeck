import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { EditWorkspaceChanges, EditWorkspaceStatus } from '@overdeck/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const http = vi.hoisted(() => ({ createEditWorkspacePr: vi.fn() }))
vi.mock('../edit-workspace-http', () => http)

import { ExplorerHttpError } from '../../explorer-http'
import { CreatePrDialog } from '../CreatePrDialog'

const PIPELINE_REASON = 'Send through pipeline needs a project whose tracker is GitHub Issues and that has an issue_prefix.'
const PR_REASON = 'Create PR needs a GitHub repository: set github_repo for this project in projects.yaml.'

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

function changes(over: Partial<EditWorkspaceChanges> = {}): EditWorkspaceChanges {
  return {
    base: 'abc',
    files: [
      { path: 'README.md', status: 'M', additions: 4, deletions: 2, binary: false },
      { path: 'img/logo.png', status: 'A', additions: 0, deletions: 0, binary: true },
    ],
    additions: 4,
    deletions: 2,
    uncommittedPaths: ['README.md'],
    ...over,
  }
}

const OPEN_PR = {
  url: 'https://github.com/o/r/pull/4', number: 4, state: 'OPEN' as const, isDraft: false, mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN', headSha: 'abc', canMerge: true, reason: null,
}

const choice = (name: RegExp) => screen.getByRole('radio', { name })

beforeEach(() => {
  http.createEditWorkspacePr.mockReset()
})

describe('CreatePrDialog', () => {
  it('names the edit workspace, branch and default branch it lands into', () => {
    render(<CreatePrDialog status={status()} changes={changes()} onClose={() => {}} onDone={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Create a pull request' })).toBeInTheDocument()
    expect(screen.getByTestId('create-pr-from').textContent).toBe('From edit workspace edit-1113-1405, branch scratch/edit-1113-1405, into main.')
  })

  it('lists what will land with each file and its +/−', () => {
    render(<CreatePrDialog status={status()} changes={changes()} onClose={() => {}} onDone={() => {}} />)
    expect(screen.getByTestId('create-pr-files-heading').textContent).toBe('What will land · 2 files +4 −2')
    const rows = within(screen.getByTestId('create-pr-files')).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows).toEqual(['README.md+4 −2', 'img/logo.pngbinary'])
  })

  it('offers both choices with their descriptions, the direct one selected', () => {
    render(<CreatePrDialog status={status()} changes={changes()} onClose={() => {}} onDone={() => {}} />)
    expect(screen.getByRole('radiogroup', { name: 'How should it land?' })).toBeInTheDocument()
    expect(choice(/Open a pull request/)).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('create-pr-direct-note').textContent).toBe(
      'You review and merge it yourself. When GitHub reports no conflicts, Merge appears in the editor bar.',
    )
    expect(screen.getByTestId('create-pr-pipeline-note').textContent).toBe(
      'Creates an issue and a PR; review and test agents check it, then it merges like any other issue.',
    )
  })

  it('labels the primary button by the choice and shows Open as a draft only for a direct PR', () => {
    render(<CreatePrDialog status={status()} changes={changes()} onClose={() => {}} onDone={() => {}} />)
    expect(screen.getByRole('button', { name: 'Open pull request' })).toBeEnabled()
    expect(screen.getByLabelText('Open as a draft')).toBeInTheDocument()
    fireEvent.click(choice(/Send through the pipeline/))
    expect(choice(/Send through the pipeline/)).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Send through the pipeline' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Open pull request' })).toBeNull()
    expect(screen.queryByLabelText('Open as a draft')).toBeNull()
  })

  it('opens a draft PR with the default title, the description and draft true', async () => {
    const result = { mode: 'direct', url: 'https://github.com/o/r/pull/9', number: 9, created: true }
    http.createEditWorkspacePr.mockResolvedValue(result)
    const onDone = vi.fn()
    render(<CreatePrDialog status={status()} changes={changes({ files: [changes().files[0]!] })} onClose={() => {}} onDone={onDone} />)
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('chore: edit README.md')
    fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: 'Why.' } })
    fireEvent.click(screen.getByLabelText('Open as a draft'))
    fireEvent.click(screen.getByRole('button', { name: 'Open pull request' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(result))
    expect(http.createEditWorkspacePr).toHaveBeenCalledWith('w1', { mode: 'direct', title: 'chore: edit README.md', body: 'Why.', draft: true })
  })

  it('sends mode pipeline with draft false from Send through the pipeline', async () => {
    http.createEditWorkspacePr.mockResolvedValue({ mode: 'pipeline', issueId: 'PAN-77', issueUrl: 'i', prUrl: 'p', prNumber: 8 })
    const onDone = vi.fn()
    render(<CreatePrDialog status={status()} changes={changes({ files: [] })} onClose={() => {}} onDone={onDone} />)
    fireEvent.click(screen.getByLabelText('Open as a draft'))
    fireEvent.click(choice(/Send through the pipeline/))
    fireEvent.click(screen.getByRole('button', { name: 'Send through the pipeline' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(http.createEditWorkspacePr.mock.calls[0]?.[1]).toMatchObject({ mode: 'pipeline', title: 'chore: edit files', draft: false })
  })

  it('disables the pipeline choice with its reason and keeps the direct choice', () => {
    render(
      <CreatePrDialog
        status={status({ pipelineSupport: { available: false, reason: PIPELINE_REASON } })}
        changes={changes()}
        onClose={() => {}}
        onDone={() => {}}
      />,
    )
    const pipeline = choice(/Send through the pipeline/)
    expect(pipeline).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('create-pr-pipeline-note').textContent).toBe(PIPELINE_REASON)
    fireEvent.click(pipeline)
    expect(choice(/Open a pull request/)).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Open pull request' })).toBeEnabled()
  })

  it('starts on the pipeline choice when only the pipeline is available, and disables submit when neither is', () => {
    const { unmount } = render(
      <CreatePrDialog status={status({ prSupport: { available: false, reason: PR_REASON } })} changes={changes()} onClose={() => {}} onDone={() => {}} />,
    )
    expect(choice(/Send through the pipeline/)).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('create-pr-direct-note').textContent).toBe(PR_REASON)
    unmount()
    render(
      <CreatePrDialog
        status={status({ prSupport: { available: false, reason: PR_REASON }, pipelineSupport: { available: false, reason: PR_REASON } })}
        changes={changes()}
        onClose={() => {}}
        onDone={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'Open pull request' })).toBeDisabled()
  })

  it('keeps a COMMIT_REFUSED message visible and stays open', async () => {
    const message = 'The commit was refused: ⧗ input: Fix typo\n✖ subject may not be empty [subject-empty]'
    http.createEditWorkspacePr.mockRejectedValue(new ExplorerHttpError(message, 422, 'COMMIT_REFUSED'))
    const onDone = vi.fn()
    render(<CreatePrDialog status={status()} changes={changes()} onClose={() => {}} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open pull request' }))
    expect((await screen.findByTestId('create-pr-error')).textContent).toBe(message)
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByTestId('create-pr-dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open pull request' })).toBeEnabled()
  })

  it('becomes Commit and push while a PR is open, listing only the uncommitted files', async () => {
    http.createEditWorkspacePr.mockResolvedValue({ mode: 'direct', url: 'u', number: 4, created: false })
    render(<CreatePrDialog status={status({ pr: OPEN_PR })} changes={changes()} onClose={() => {}} onDone={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Commit and push' })).toBeInTheDocument()
    expect(screen.getByLabelText('Commit message')).toBeInTheDocument()
    expect(screen.getByTestId('create-pr-files-heading').textContent).toBe('What will be committed · 1 file')
    expect(within(screen.getByTestId('create-pr-files')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['README.md'])
    expect(screen.queryByRole('radiogroup')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Commit and push' }))
    await waitFor(() => expect(http.createEditWorkspacePr).toHaveBeenCalledWith('w1', expect.objectContaining({ mode: 'direct', draft: false })))
  })

  it('lists an uncommitted deletion of a file a pushed commit added (CodeRabbit 4578715368)', () => {
    // notes.txt was added by a pushed commit and deleted locally: neither end of the merge-base diff has it.
    render(
      <CreatePrDialog status={status({ pr: OPEN_PR })} changes={changes({ uncommittedPaths: ['README.md', 'notes.txt'] })} onClose={() => {}} onDone={() => {}} />,
    )
    expect(screen.getByTestId('create-pr-files-heading').textContent).toBe('What will be committed · 2 files')
    expect(within(screen.getByTestId('create-pr-files')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['README.md', 'notes.txt'])
  })

  it('shows Working… on the primary button while the request runs', async () => {
    http.createEditWorkspacePr.mockReturnValue(new Promise(() => {}))
    render(<CreatePrDialog status={status()} changes={changes()} onClose={() => {}} onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open pull request' }))
    expect(await screen.findByRole('button', { name: 'Working…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
