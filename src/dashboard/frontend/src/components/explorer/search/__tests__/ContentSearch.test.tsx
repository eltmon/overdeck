import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { PanRpcError } from '@overdeck/contracts'

const rpc = vi.hoisted(() => ({ searchContent: vi.fn() }))

vi.mock('../../explorer-rpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../explorer-rpc')>()
  return { ...actual, searchContent: rpc.searchContent }
})

import { ContentSearch, type ContentSearchProps } from '../ContentSearch'

beforeEach(() => {
  vi.useFakeTimers()
  rpc.searchContent.mockReset()
  rpc.searchContent.mockResolvedValue({ matches: [], truncated: false })
})

afterEach(() => {
  vi.useRealTimers()
})

function renderSearch(over: Partial<ContentSearchProps> = {}) {
  const props: ContentSearchProps = { rootId: 'issue:PAN-1', onScopeClear: vi.fn(), onClose: vi.fn(), onPick: vi.fn(), ...over }
  render(<ContentSearch {...props} />)
  return { props, input: screen.getByRole('textbox', { name: 'Search in files' }) }
}

const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } })

describe('ContentSearch', () => {
  it('sends no request for a 1-character query', async () => {
    const { input } = renderSearch()
    type(input, 'f')
    await act(() => vi.advanceTimersByTimeAsync(1000))
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(rpc.searchContent).not.toHaveBeenCalled()
  })

  it('sends one request 300 ms after typing, with the scope passed through', async () => {
    const { input } = renderSearch({ scopePath: 'src' })
    type(input, 'fo')
    await act(() => vi.advanceTimersByTimeAsync(100))
    type(input, 'foo')
    await act(() => vi.advanceTimersByTimeAsync(299))
    expect(rpc.searchContent).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(rpc.searchContent).toHaveBeenCalledTimes(1)
    expect(rpc.searchContent).toHaveBeenCalledWith({
      rootId: 'issue:PAN-1',
      query: 'foo',
      scopePath: 'src',
      regex: false,
      caseSensitive: false,
      limit: 500,
    })
    expect(screen.getByText('src/')).toBeInTheDocument()
  })

  it('sends at once on Enter, and only once', async () => {
    const { input } = renderSearch()
    type(input, 'foo')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(rpc.searchContent).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(rpc.searchContent).toHaveBeenCalledTimes(1)
  })

  it('passes the case and regex toggles', async () => {
    const { input } = renderSearch()
    fireEvent.click(screen.getByRole('button', { name: 'Match case' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use regular expression' }))
    expect(screen.getByRole('button', { name: 'Match case' })).toHaveAttribute('aria-pressed', 'true')
    type(input, 'fo+')
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(rpc.searchContent).toHaveBeenCalledWith(expect.objectContaining({ regex: true, caseSensitive: true }))
  })

  it('groups results under their file header and picks a match with its line and column', async () => {
    rpc.searchContent.mockResolvedValue({
      matches: [
        { path: 'src/a.ts', line: 3, column: 5, preview: 'const foo = 1' },
        { path: 'src/b.ts', line: 1, column: 1, preview: 'foo()' },
        { path: 'src/a.ts', line: 9, column: 2, preview: 'foo.bar' },
      ],
      truncated: true,
    })
    const { input, props } = renderSearch()
    type(input, 'foo')
    await act(() => vi.advanceTimersByTimeAsync(300))
    const groups = screen.getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['src/a.ts', 'src/b.ts'])
    expect(within(groups[0]).getByText('2')).toBeInTheDocument()
    expect(within(groups[0]).getByText('9:2')).toBeInTheDocument()
    expect(screen.getByText('Showing the first 500 matches.')).toBeInTheDocument()
    fireEvent.click(within(groups[0]).getByText('foo.bar'))
    expect(props.onPick).toHaveBeenCalledWith({ path: 'src/a.ts', line: 9, column: 2 })
  })

  it('shows the server error, such as an invalid regex', async () => {
    rpc.searchContent.mockRejectedValue(new PanRpcError({ message: 'Invalid regular expression', code: 'INVALID_QUERY' }))
    const { input } = renderSearch()
    type(input, '(foo')
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(screen.getByText('Invalid regular expression')).toBeInTheDocument()
  })

  it('clears the scope and closes', () => {
    const { props } = renderSearch({ scopePath: 'src' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear folder scope' }))
    expect(props.onScopeClear).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
    expect(props.onClose).toHaveBeenCalled()
  })
})
