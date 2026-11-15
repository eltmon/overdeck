import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PanRpcError } from '@overdeck/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePanesStore } from '../../../../lib/panesStore'
import { installStrictFetchMock } from '../../../../test-utils/strictFetchMock'
import { ExplorerHttpError } from '../../explorer-http'
import { isRootNotFound, NO_PROJECT_TITLE, StaleCodeTab } from '../StaleCodeTab'

const DECK = 'overdeck'
let projects: Array<{ key: string; name: string; path: string }> = []
let fetchGuard: ReturnType<typeof installStrictFetchMock>

function renderTab(rootId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <StaleCodeTab rootId={rootId} path="docs/a.md" deckKey={DECK} paneId="c1" />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  projects = [{ key: 'overdeck', name: 'Overdeck', path: '/p' }]
  fetchGuard = installStrictFetchMock(({ method, url }) => {
    if (method === 'GET' && url === '/api/registered-projects') return Response.json(projects)
    if (method === 'GET' && url === '/api/workspace-registry') return Response.json({ workspaces: [] })
    return undefined
  })
})

afterEach(async () => {
  await fetchGuard.assertNoUnexpectedRequests()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('isRootNotFound', () => {
  it('matches ROOT_NOT_FOUND from the explorer RPC and the edit-workspace HTTP calls only', () => {
    expect(isRootNotFound(new PanRpcError({ code: 'ROOT_NOT_FOUND', message: 'gone' }))).toBe(true)
    expect(isRootNotFound(new ExplorerHttpError('gone', 404, 'ROOT_NOT_FOUND'))).toBe(true)
    expect(isRootNotFound(new PanRpcError({ code: 'NOT_FOUND', message: 'gone' }))).toBe(false)
    expect(isRootNotFound(new ExplorerHttpError('nope', 409, 'NOT_AN_EDIT_WORKSPACE'))).toBe(false)
    expect(isRootNotFound(new Error('ROOT_NOT_FOUND'))).toBe(false)
  })
})

describe('StaleCodeTab (PAN-5290 FR-13)', () => {
  it('says the edit workspace was merged or discarded', () => {
    renderTab('workspace:w1')
    expect(screen.getByText('This edit workspace was merged or discarded.')).toBeInTheDocument()
  })

  it("says the issue's workspace no longer exists", () => {
    renderTab('issue:PAN-1')
    expect(screen.getByText("This issue's workspace no longer exists.")).toBeInTheDocument()
  })

  it('says the project is no longer registered, with Close tab only', () => {
    renderTab('project:gone')
    expect(screen.getByText('This project is no longer registered on this machine.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open on main' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Close tab' })).toBeInTheDocument()
  })

  it('Open on main retargets the tab to the deck project', async () => {
    const updatePane = vi.spyOn(usePanesStore.getState(), 'updatePane').mockImplementation(() => {})
    renderTab('workspace:w1')
    const open = screen.getByRole('button', { name: 'Open on main' })
    await waitFor(() => expect(open).toBeEnabled())
    fireEvent.click(open)
    expect(updatePane).toHaveBeenCalledWith(DECK, 'c1', { explorerRootId: 'project:overdeck' })
  })

  it('disables Open on main with its title when the deck has no registered project', async () => {
    projects = []
    renderTab('workspace:w1')
    await waitFor(() => expect(fetchGuard.fetchMock).toHaveBeenCalled())
    const open = screen.getByRole('button', { name: 'Open on main' })
    expect(open).toBeDisabled()
    expect(open).toHaveAttribute('title', NO_PROJECT_TITLE)
  })

  it('Close tab closes the pane', () => {
    const closePane = vi.spyOn(usePanesStore.getState(), 'closePane').mockImplementation(() => {})
    renderTab('workspace:w1')
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(closePane).toHaveBeenCalledWith(DECK, 'c1')
  })
})
