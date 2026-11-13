import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const rpc = vi.hoisted(() => ({ gitStage: vi.fn() }))
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('../../explorer-rpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../explorer-rpc')>()
  return { ...actual, gitStage: rpc.gitStage }
})

import { DialogProvider } from '../../../DialogProvider'
import { ExplorerContextMenu, type ExplorerContextMenuProps, type ExplorerMenuTarget } from '../ExplorerContextMenu'
import { buildDecorations, EMPTY_DECORATIONS } from '../../git/git-decoration'

const writeText = vi.fn()

beforeEach(() => {
  rpc.gitStage.mockReset()
  rpc.gitStage.mockResolvedValue(undefined)
  toastMock.success.mockReset()
  toastMock.error.mockReset()
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

const FILE_A: ExplorerMenuTarget = { path: 'src/a.ts', kind: 'file', absPath: '/ws/src/a.ts' }
const FILE_B: ExplorerMenuTarget = { path: 'src/b.ts', kind: 'file', absPath: '/ws/src/b.ts' }

const MODIFIED = buildDecorations({ entries: [{ path: 'src/a.ts', status: 'modified', staged: false }], committed: [] })

function renderMenu(over: Partial<ExplorerContextMenuProps> = {}) {
  const props: ExplorerContextMenuProps = {
    rootId: 'issue:PAN-1',
    rootKind: 'issue',
    targets: [FILE_A],
    decorations: MODIFIED,
    onOpen: vi.fn(),
    onFindInFolder: vi.fn(),
    onGitChanged: vi.fn(),
    children: <div>tree</div>,
    ...over,
  }
  render(
    <DialogProvider>
      <ExplorerContextMenu {...props} />
    </DialogProvider>,
  )
  fireEvent.contextMenu(screen.getByText('tree'))
  return props
}

const item = (name: string) => screen.getByRole('menuitem', { name })

describe('ExplorerContextMenu', () => {
  it('discards only after the confirm dialog is accepted', async () => {
    const props = renderMenu()
    fireEvent.click(item('Discard changes'))
    expect(await screen.findByText('Discard changes?')).toBeInTheDocument()
    expect(rpc.gitStage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(rpc.gitStage).toHaveBeenCalledWith('issue:PAN-1', ['src/a.ts'], 'discard'))
    await waitFor(() => expect(props.onGitChanged).toHaveBeenCalledTimes(1))
  })

  it('makes no call when the discard is cancelled', async () => {
    renderMenu()
    fireEvent.click(item('Discard changes'))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument())
    expect(rpc.gitStage).not.toHaveBeenCalled()
  })

  it('renders no git actions on a project root', () => {
    renderMenu({ rootId: 'project:overdeck', rootKind: 'project' })
    expect(screen.queryByRole('menuitem', { name: 'Stage' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Unstage' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Discard changes' })).toBeNull()
    expect(item('Copy relative path')).toBeInTheDocument()
  })

  it('stages a changed file and enables Unstage only for staged changes', async () => {
    const props = renderMenu()
    expect(item('Unstage')).toHaveAttribute('data-disabled')
    fireEvent.click(item('Stage'))
    await waitFor(() => expect(rpc.gitStage).toHaveBeenCalledWith('issue:PAN-1', ['src/a.ts'], 'stage'))
    await waitFor(() => expect(props.onGitChanged).toHaveBeenCalled())
  })

  it('disables the git actions for an unchanged file', () => {
    renderMenu({ decorations: EMPTY_DECORATIONS })
    expect(item('Stage')).toHaveAttribute('data-disabled')
    expect(item('Discard changes')).toHaveAttribute('data-disabled')
  })

  it('copies the relative paths, one per line', async () => {
    renderMenu({ targets: [FILE_A, FILE_B] })
    fireEvent.click(item('Copy relative path'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('src/a.ts\nsrc/b.ts'))
  })

  it('copies the absolute paths and toasts', async () => {
    renderMenu({ targets: [FILE_A, FILE_B] })
    fireEvent.click(item('Copy path'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/ws/src/a.ts\n/ws/src/b.ts'))
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Copied path'))
  })

  it('finds in the parent folder of a file and in a folder itself', () => {
    const props = renderMenu()
    fireEvent.click(item('Find in folder'))
    expect(props.onFindInFolder).toHaveBeenCalledWith('src')
  })

  it('opens a single file target', () => {
    const props = renderMenu()
    fireEvent.click(item('Open'))
    expect(props.onOpen).toHaveBeenCalledWith('src/a.ts')
  })

  it('shows no Open for a folder target', () => {
    renderMenu({ targets: [{ path: 'src', kind: 'dir', absPath: '/ws/src' }] })
    expect(screen.queryByRole('menuitem', { name: 'Open' })).toBeNull()
  })
})
