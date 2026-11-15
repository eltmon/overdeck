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

function renderQuickOpen(extra: { changedPaths?: ReadonlySet<string>; onReveal?: (path: string) => void } = {}) {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(<QuickOpen rootId="issue:PAN-1" open onPick={onPick} onClose={onClose} {...extra} />)
  return { onPick, onClose, input: screen.getByRole('combobox') }
}

/** The option rows, by their full text. */
const rowTexts = () => screen.getAllByRole('option').map((o) => o.textContent)
/** An element whose own text content (marks included) is exactly `text`. */
const byWholeText = (text: string) => screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === text)

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
    expect(rpc.searchFiles).toHaveBeenCalledWith('issue:PAN-1', 'ws-rpc', 200)
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
    expect(byWholeText('ws-rpc.ts')).toBeInTheDocument()
    expect(byWholeText('src/dashboard/server')).toBeInTheDocument()
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
    expect(rowTexts()).toEqual(['new.ts'])
  })

  it('drops the old results as soon as the query changes', async () => {
    rpc.searchFiles.mockResolvedValueOnce({ paths: ['src/foo.ts'] })
    rpc.searchFiles.mockReturnValueOnce(new Promise(() => {}))
    const { input, onPick } = renderQuickOpen()
    type(input, 'foo')
    await act(() => vi.advanceTimersByTimeAsync(120))
    expect(rowTexts()).toEqual(['foo.tssrc'])
    type(input, 'bar')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).not.toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const { input, onClose } = renderQuickOpen()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('asks for 200 paths and shows at most 50', async () => {
    rpc.searchFiles.mockResolvedValue({ paths: Array.from({ length: 200 }, (_, i) => `src/foo${i}.ts`) })
    const { input } = renderQuickOpen()
    type(input, 'foo')
    await act(() => vi.advanceTimersByTimeAsync(120))
    expect(rpc.searchFiles).toHaveBeenCalledWith('issue:PAN-1', 'foo', 200)
    expect(screen.getAllByRole('option')).toHaveLength(50)
  })

  it('marks the matched text and ranks a changed path first in its tier with a tag (PAN-5289)', async () => {
    rpc.searchFiles.mockResolvedValue({ paths: ['a/foo.ts', 'b/foo.ts', 'c/myfoo.ts'] })
    const { input } = renderQuickOpen({ changedPaths: new Set(['b/foo.ts', 'c/myfoo.ts']) })
    type(input, 'foo')
    await act(() => vi.advanceTimersByTimeAsync(120))
    const options = screen.getAllByRole('option')
    // Both foo.ts are tier 1 (b changed, so first); myfoo.ts is tier 2 even though changed.
    expect(options.map((o) => o.getAttribute('data-value'))).toEqual(['b/foo.ts', 'a/foo.ts', 'c/myfoo.ts'])
    const mark = options[0].querySelector('mark')
    expect(mark).toHaveTextContent('foo')
    expect(mark).toHaveClass('match-mark')
    expect(mark?.className).not.toMatch(/bg-warning\//)
    expect(options[0]).toHaveTextContent('changed here')
    expect(options[1]).not.toHaveTextContent('changed here')
    expect(screen.getByText(/Shift Enter reveal in files/)).toBeInTheDocument()
  })

  it('reveals on Shift+Enter and opens on Enter', async () => {
    rpc.searchFiles.mockResolvedValue({ paths: ['src/foo.ts', 'lib/foo.ts'] })
    const onReveal = vi.fn()
    const { input, onPick, onClose } = renderQuickOpen({ onReveal })
    type(input, 'foo')
    await act(() => vi.advanceTimersByTimeAsync(120))
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onReveal).toHaveBeenCalledWith('src/foo.ts')
    expect(onPick).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPick).toHaveBeenCalledWith('src/foo.ts')
  })
})
