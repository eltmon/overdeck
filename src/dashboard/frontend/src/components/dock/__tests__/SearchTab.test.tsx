import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const rpc = vi.hoisted(() => ({ searchContent: vi.fn() }))
vi.mock('../../explorer/explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer/explorer-rpc')>()),
  searchContent: rpc.searchContent,
}))

import { SearchTab } from '../SearchTab'
import { useWorkDockStore } from '../workDockStore'
import { StageDeckProvider, type StageDeckContextValue } from '../../Stage/StageDeckContext'
import type { DockScope } from '../dockScope'

const DECK = 'p'
const SCOPE: DockScope = {
  rootId: 'project:p',
  changes: { kind: 'project-main', projectKey: 'p' },
  header: { kind: 'project' },
  deckRootId: 'project:p',
  overridden: false,
}

function renderTab(deck: StageDeckContextValue) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <StageDeckProvider value={deck}>
        <SearchTab deckKey={DECK} scope={SCOPE} />
      </StageDeckProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useWorkDockStore.setState({ byDeck: {} })
  rpc.searchContent.mockReset()
  rpc.searchContent.mockResolvedValue({ matches: [{ path: 'src/a.ts', line: 7, column: 3, preview: 'foo()' }], truncated: false })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SearchTab', () => {
  it('scopes to the Find in folder path, opens a hit beside the chat, and refocuses on a new openDock', async () => {
    act(() => useWorkDockStore.getState().openDock(DECK, { tab: 'search', searchPath: 'src' }))
    const openBeside = vi.fn(() => 'code-1')
    renderTab({ deckKey: DECK, openOrFocusEditorPane: vi.fn(), openOrFocusAgentPane: vi.fn(), openBeside })
    expect(screen.getByText('src/')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close search' })).toBeNull()

    const input = screen.getByRole('textbox', { name: 'Search in files' })
    fireEvent.change(input, { target: { value: 'foo' } })
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(rpc.searchContent).toHaveBeenCalledWith(expect.objectContaining({ rootId: 'project:p', scopePath: 'src', query: 'foo' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'src/a.ts' })).getByText('foo()'))
    expect(openBeside).toHaveBeenCalledWith({ rootId: 'project:p', path: 'src/a.ts', line: 7 })

    input.blur()
    act(() => useWorkDockStore.getState().openDock(DECK, { tab: 'search', searchPath: 'src' }))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search in files' }))
  })

  it('clears the folder scope through openDock', () => {
    act(() => useWorkDockStore.getState().openDock(DECK, { tab: 'search', searchPath: 'src' }))
    renderTab({ deckKey: DECK, openOrFocusEditorPane: vi.fn(), openOrFocusAgentPane: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'Clear folder scope' }))
    expect(useWorkDockStore.getState().byDeck[DECK].searchPath).toBeUndefined()
    expect(screen.queryByText('src/')).toBeNull()
  })
})
