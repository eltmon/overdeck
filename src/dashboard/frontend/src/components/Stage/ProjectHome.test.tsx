import { afterEach, describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectHome } from './ProjectHome'
import type { StageApi } from './types'

// ProjectHome owns the project rename mutation (PAN-3156), so every render
// needs a QueryClientProvider. Shadow render() so existing call sites work.
function render(ui: Parameters<typeof rtlRender>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
}

function api(overrides: Partial<StageApi> = {}): StageApi {
  return {
    deckKey: 'overdeck',
    openPane: vi.fn(),
    openTypedPane: vi.fn(),
    openIssue: vi.fn(),
    openOrFocusAgentPane: vi.fn(),
    toggleTerminal: vi.fn(),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('ProjectHome', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes the launcher query into the created agent conversation', async () => {
    const openOrFocusAgentPane = vi.fn()
    const onCreateConversation = vi.fn().mockResolvedValue({ name: 'conv-123' })

    render(
      <ProjectHome
        projectName="overdeck"
        onCreateConversation={onCreateConversation}
        api={api({ openOrFocusAgentPane })}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'This is a test' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(onCreateConversation).toHaveBeenCalledWith('claude-code', 'This is a test', 'terminal')
    })
    expect(openOrFocusAgentPane).toHaveBeenCalledWith('conv-123', 'Agent')
  })

  it('renders conversation creation errors inline without opening a pane', async () => {
    const openOrFocusAgentPane = vi.fn()
    const onCreateConversation = vi.fn().mockResolvedValue({ error: 'Unknown project: overdeck' })

    render(
      <ProjectHome
        projectName="overdeck"
        onCreateConversation={onCreateConversation}
        api={api({ openOrFocusAgentPane })}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Keep this query' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown project: overdeck')
    expect(input).toHaveValue('Keep this query')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(openOrFocusAgentPane).not.toHaveBeenCalled()
  })

  it('suppresses repeated submissions while creation is pending', async () => {
    const pending = deferred<{ name: string } | { error: string }>()
    const onCreateConversation = vi.fn().mockReturnValue(pending.promise)

    render(
      <ProjectHome
        projectName="overdeck"
        onCreateConversation={onCreateConversation}
        api={api()}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Only once' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onCreateConversation).toHaveBeenCalledTimes(1))

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCreateConversation).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve({ error: 'Unknown project: overdeck' })
      await pending.promise
    })
  })

  it('clears the previous error on retry and opens the successful conversation', async () => {
    const retry = deferred<{ name: string } | { error: string }>()
    const openOrFocusAgentPane = vi.fn()
    const onCreateConversation = vi.fn()
      .mockResolvedValueOnce({ error: 'Unknown project: overdeck' })
      .mockReturnValueOnce(retry.promise)

    render(
      <ProjectHome
        projectName="overdeck"
        onCreateConversation={onCreateConversation}
        api={api({ openOrFocusAgentPane })}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Retry this query' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown project: overdeck')

    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onCreateConversation).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()

    await act(async () => {
      retry.resolve({ name: 'conv-456' })
      await retry.promise
    })
    expect(openOrFocusAgentPane).toHaveBeenCalledWith('conv-456', 'Agent')
  })

  it('renders project settings in the sparse layout for a registered project', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/projects/myn/auto-merge-default') {
        return Response.json({ value: null })
      }
      if (url === '/api/projects/myn/swarm-policy') {
        return Response.json({ configured: null })
      }
      // PAN-1696: the settings panel also reads the per-project merge-train
      // override and the aggregate endpoints behind its summary line.
      if (url === '/api/projects/myn/merge-train') {
        return Response.json({ value: null, effective: true })
      }
      if (url === '/api/merge-train/queues' || url === '/api/merge-train/generations') {
        return Response.json([])
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={client}>
        <ProjectHome
          projectName="Mind Your Now"
          projectKey="myn"
          api={api()}
        />
      </QueryClientProvider>,
    )

    expect(await screen.findAllByText('Project settings')).not.toHaveLength(0)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
  })

  it('omits project settings and settings requests without a project key', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(
      <ProjectHome
        projectName="No project"
        api={api()}
      />,
    )

    expect(screen.queryByText('Project settings')).toBeNull()
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/projects/'))).toBe(false)
  })
})
