import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/apiFetch', () => ({ fetchWithTimeout: fetchMock }))
vi.mock('../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn().mockResolvedValue({ 'Content-Type': 'application/json', 'x-csrf': 't' }),
}))
const openPathInDeck = vi.fn()
vi.mock('../../lib/uiCommands/openPathInDeck', () => ({ openPathInDeck: (...args: unknown[]) => openPathInDeck(...args) }))
const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: toastError }) }))

import { TestDeckNavigationProvider } from '../frame/deck/deckNavigation'
import { useAddProjectDialog } from '../project/new/addProjectDialogStore'
import { OpenPathHost } from './OpenPathHost'

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const navigation = { openInDeck: vi.fn(), selectProject: vi.fn() }

function renderAt(url: string) {
  window.history.replaceState(null, '', url)
  return render(
    <TestDeckNavigationProvider navigation={navigation}>
      <OpenPathHost />
    </TestDeckNavigationProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useAddProjectDialog.getState().hide()
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('OpenPathHost', () => {
  it('opens the resolved path with dryRun and moves the URL to the project deck', async () => {
    const resolution = { projectKey: 'demo app', rootId: 'project:demo app', relPath: 'docs', kind: 'dir', delivered: 0 }
    fetchMock.mockResolvedValue(json(resolution))
    renderAt('/open?path=%2Fp%2Fdocs&line=4')
    await waitFor(() => expect(openPathInDeck).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/ui/open')
    expect(JSON.parse(String(init.body))).toEqual({ path: '/p/docs', line: 4, dryRun: true })
    expect(init.headers).toMatchObject({ 'x-csrf': 't' })
    expect(openPathInDeck.mock.calls[0]?.[0]).toMatchObject({ projectKey: 'demo app', relPath: 'docs' })
    expect(window.location.pathname).toBe('/command-deck/demo%20app')
  })

  it('offers to add an outside folder as a project, with the folder prefilled', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(json({ error: 'outside-projects', path: '/x/y/notes.txt', kind: 'file', suggestion: 'pan project add /x/y' }, 404))
    renderAt('/open?path=%2Fx%2Fy%2Fnotes.txt')
    expect(await screen.findByText(/isn.t in a project\. Add it as a project\?/)).toBeInTheDocument()
    expect(screen.getByText('/x/y')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add project' }))
    expect(useAddProjectDialog.getState()).toMatchObject({ open: true, mode: 'existing', initialPath: '/x/y' })
    expect(openPathInDeck).not.toHaveBeenCalled()
  })

  it('shows the no-root sentence as an error toast', async () => {
    fetchMock.mockResolvedValue(json({ error: 'no-root', path: '/p/workspaces/x', projectKey: 'demo' }, 404))
    renderAt('/open?path=%2Fp%2Fworkspaces%2Fx')
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('/p/workspaces/x is inside demo but not in a feature or scratch workspace'),
    )
  })

  it('without a path shows the Nothing to open toast and returns to /', () => {
    renderAt('/open')
    expect(toastError).toHaveBeenCalledWith('Nothing to open: the link has no path')
    expect(window.location.pathname).toBe('/')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing on any other pathname', () => {
    renderAt('/command-deck/demo?path=%2Fp')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })
})
