import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('../../../../lib/wsTransport', () => ({ getTransport: () => ({}) }))

import { DialogProvider } from '../../../DialogProvider'
import { draftKey, useCodeDrafts } from '../../code/code-drafts'
import { DELETE_TOAST_MS, useDeleteFlow } from '../useDeleteFlow'
import type { ExplorerActions } from '../useExplorerActions'

const ROOT = 'issue:PAN-1'

function fakeActions(): ExplorerActions {
  return {
    writable: true,
    runWrite: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(async () => 'op-7'),
    move: vi.fn(),
    recordCreated: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    undoEntry: vi.fn(async () => {}),
  }
}

const wrapper = ({ children }: { children: ReactNode }) => <DialogProvider>{children}</DialogProvider>

function setup(actions = fakeActions()) {
  const { result } = renderHook(() => useDeleteFlow(actions, ROOT), { wrapper })
  return { actions, requestDelete: result.current }
}

beforeEach(() => {
  toastMock.mockReset()
  useCodeDrafts.setState({ drafts: {} })
})

describe('useDeleteFlow', () => {
  it('deletes one clean path at once and offers Undo for that op', async () => {
    const { actions, requestDelete } = setup()
    await act(() => requestDelete(['src/a.ts']))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(actions.remove).toHaveBeenCalledWith(['src/a.ts'])
    expect(toastMock).toHaveBeenCalledWith('Moved a.ts to the Overdeck trash', {
      duration: DELETE_TOAST_MS,
      action: { label: 'Undo', onClick: expect.any(Function) },
    })
    expect(DELETE_TOAST_MS).toBe(8000)
    toastMock.mock.calls[0][1].action.onClick()
    expect(actions.undoEntry).toHaveBeenCalledWith('op-7')
  })

  it('confirms two paths first, and a cancel deletes nothing', async () => {
    const { actions, requestDelete } = setup()
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = requestDelete(['a.ts', 'b.ts'])
    })
    expect(await screen.findByText('Delete 2 items?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(() => pending)
    expect(actions.remove).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('deletes two paths after the confirm is accepted', async () => {
    const { actions, requestDelete } = setup()
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = requestDelete(['a.ts', 'b.ts', 'a.ts'])
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await act(() => pending)
    expect(actions.remove).toHaveBeenCalledWith(['a.ts', 'b.ts'])
    expect(toastMock.mock.calls[0][0]).toBe('Moved 2 items to the Overdeck trash')
  })

  it('confirms a single folder with an unsaved draft under it', async () => {
    useCodeDrafts.getState().loaded(draftKey(ROOT, 'src/deep/a.ts'), 'a', 'sig')
    useCodeDrafts.getState().edited(draftKey(ROOT, 'src/deep/a.ts'), 'a edited')
    useCodeDrafts.getState().loaded(draftKey('issue:OTHER', 'src/b.ts'), 'b', 'sig')
    useCodeDrafts.getState().edited(draftKey('issue:OTHER', 'src/b.ts'), 'b edited')
    const { actions, requestDelete } = setup()
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = requestDelete(['src'])
    })
    expect(await screen.findByText('Delete src?')).toBeInTheDocument()
    expect(screen.getByText(/Unsaved edits in: src\/deep\/a\.ts$/)).toBeInTheDocument()
    expect(screen.queryByText(/src\/b\.ts/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(() => pending)
    await waitFor(() => expect(actions.remove).not.toHaveBeenCalled())
  })

  it('shows no toast when nothing moved', async () => {
    const actions = fakeActions()
    vi.mocked(actions.remove).mockResolvedValue('')
    const { requestDelete } = setup(actions)
    await act(() => requestDelete(['a.ts']))
    expect(toastMock).not.toHaveBeenCalled()
  })
})
