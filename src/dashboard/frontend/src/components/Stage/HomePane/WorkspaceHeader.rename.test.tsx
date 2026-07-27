import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkspaceHeader } from './WorkspaceHeader'
import { useProjectRename } from './useProjectRename'

/**
 * PAN-3156 — the project rename affordance now lives on the `# <project>`
 * title. These are the rename behaviours previously exercised through
 * ProjectOverview's hero billboard, plus the variant gate.
 */
function Harness({ projectName, projectKey }: { projectName: string; projectKey?: string }) {
  const rename = useProjectRename(projectName, projectKey)
  return <WorkspaceHeader variant="project" name={projectName} branch="main" rename={rename} />
}

function render(ui: Parameters<typeof rtlRender>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { ...rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }), queryClient: client }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WorkspaceHeader rename affordance', () => {
  it('renders the pencil for the project variant only', () => {
    const rename = {
      editing: false,
      draftName: '',
      error: null,
      pending: false,
      inputRef: { current: null },
      begin: vi.fn(),
      change: vi.fn(),
      commit: vi.fn(),
      cancel: vi.fn(),
    }
    const { rerender } = rtlRender(<WorkspaceHeader variant="project" name="Overdeck" rename={rename} />)
    expect(screen.getByRole('button', { name: 'Rename Overdeck' })).toBeInTheDocument()

    rerender(<WorkspaceHeader variant="issue" name="Overdeck" rename={rename} />)
    expect(screen.queryByRole('button', { name: 'Rename Overdeck' })).not.toBeInTheDocument()

    rerender(<WorkspaceHeader variant="project" name="Overdeck" />)
    expect(screen.queryByRole('button', { name: 'Rename Overdeck' })).not.toBeInTheDocument()
  })

  it('opens a selected, pre-filled project name editor from the title pencil', async () => {
    render(<Harness projectName="Overdeck" projectKey="overdeck" />)

    fireEvent.click(screen.getByRole('button', { name: 'Rename Overdeck' }))
    const input = screen.getByRole('textbox', { name: 'Rename Overdeck' }) as HTMLInputElement
    expect(input).toHaveValue('Overdeck')
    await waitFor(() => {
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe('Overdeck'.length)
    })
  })

  it('renames by project key and invalidates every project-name query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ key: 'overdeck', name: 'Overdeck App' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { queryClient } = render(<Harness projectName="Overdeck" projectKey="overdeck" />)
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    fireEvent.click(screen.getByRole('button', { name: 'Rename Overdeck' }))
    const input = screen.getByRole('textbox', { name: 'Rename Overdeck' })
    fireEvent.change(input, { target: { value: 'Overdeck App' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/projects/overdeck/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Overdeck App' }),
      })
    })
    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['command-deck-projects'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['registered-projects'] })
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['session-trees'] })
    })
  })

  it('cancels project rename on Escape without sending a request', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<Harness projectName="Overdeck" projectKey="overdeck" />)

    fireEvent.click(screen.getByRole('button', { name: 'Rename Overdeck' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Rename Overdeck' }), { key: 'Escape' })

    expect(screen.queryByRole('textbox', { name: 'Rename Overdeck' })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls).not.toContainEqual([
      '/api/projects/overdeck/rename',
      expect.any(Object),
    ])
  })

  it('keeps the draft editor open and shows a rename conflict', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Project name 'Krux' conflicts with existing project 'krux'" }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))
    render(<Harness projectName="Overdeck" />)

    fireEvent.click(screen.getByRole('button', { name: 'Rename Overdeck' }))
    const input = screen.getByRole('textbox', { name: 'Rename Overdeck' })
    fireEvent.change(input, { target: { value: 'Krux' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Project name 'Krux' conflicts with existing project 'krux'",
    )
    expect(screen.getByRole('textbox', { name: 'Rename Overdeck' })).toHaveValue('Krux')
    expect(fetch).toHaveBeenCalledWith('/api/projects/Overdeck/rename', expect.any(Object))
  })
})
