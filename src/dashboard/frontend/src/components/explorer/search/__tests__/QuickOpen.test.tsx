import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

const rpc = vi.hoisted(() => ({ searchFiles: vi.fn() }))

vi.mock('../../explorer-rpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../explorer-rpc')>()
  return { ...actual, searchFiles: rpc.searchFiles }
})

import { QuickOpen } from '../QuickOpen'

beforeEach(() => {
  vi.useFakeTimers()
  rpc.searchFiles.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

function renderQuickOpen() {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(<QuickOpen rootId="issue:PAN-1" open onPick={onPick} onClose={onClose} />)
  return { onPick, onClose, input: screen.getByRole('combobox') }
}

const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } })

describe('QuickOpen', () => {
  it('sends one searchFiles call 120 ms after the last key, not before', async () => {
    rpc.searchFiles.mockResolvedValue({ paths: [] })
    const { input } = renderQuickOpen()
    type(input, 'ws')
    await act(() => vi.advanceTimersByTimeAsync(60))
    type(input, 'ws-rpc')
    await act(() => vi.advanceTimersByTimeAsync(119))
    expect(rpc.searchFiles).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(rpc.searchFiles).toHaveBeenCalledTimes(1)
    expect(rpc.searchFiles).toHaveBeenCalledWith('issue:PAN-1', 'ws-rpc', 50)
  })

  it('sends nothing for an empty query', async () => {
    const { input } = renderQuickOpen()
    expect(screen.getByText('Type to search files')).toBeInTheDocument()
    type(input, '   ')
    await act(() => vi.advanceTimersByTimeAsync(500))
    expect(rpc.searchFiles).not.toHaveBeenCalled()
  })

  it('picks the first result on Enter and closes', async () => {
    rpc.searchFiles.mockResolvedValue({ paths: ['src/dashboard/server/ws-rpc.ts', 'src/lib/ws-rpc-client.ts'] })
    const { input, onPick, onClose } = renderQuickOpen()
    type(input, 'ws-rpc')
    await act(() => vi.advanceTimersByTimeAsync(120))
    expect(screen.getByText('ws-rpc.ts')).toBeInTheDocument()
    expect(screen.getByText('src/dashboard/server')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('src/dashboard/server/ws-rpc.ts')
    expect(onClose).toHaveBeenCalled()
  })

  it('does not let an answer to an older query replace a newer one', async () => {
    const pending: Array<(v: { paths: string[] }) => void> = []
    rpc.searchFiles.mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
    const { input } = renderQuickOpen()
    type(input, 'old')
    await act(() => vi.advanceTimersByTimeAsync(120))
    type(input, 'new')
    await act(() => vi.advanceTimersByTimeAsync(120))
    expect(pending).toHaveLength(2)
    await act(async () => {
      pending[1]({ paths: ['new.ts'] })
      pending[0]({ paths: ['old.ts'] })
    })
    expect(screen.getByText('new.ts')).toBeInTheDocument()
    expect(screen.queryByText('old.ts')).toBeNull()
  })

  it('closes on Escape', () => {
    const { input, onClose } = renderQuickOpen()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
