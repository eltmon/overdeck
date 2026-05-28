import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { FilesPane } from './FilesPane'
import type { StageContext } from '../types'
import type { WorkspacePane } from '../../../lib/panesStore'

const pane: WorkspacePane = { paneId: 'f', paneType: 'files', label: 'Files', createdAt: 1 }

function renderWithClient(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

function ctx(over: Partial<StageContext> = {}): StageContext {
  return { workspaceId: 'PAN-1549', openPane: () => {}, agentId: 'agent-1', ...over }
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        files: [
          { path: 'src/a.ts', additions: 3, deletions: 1 },
          { path: 'src/b.ts', additions: 0, deletions: 2 },
        ],
      }),
    })) as unknown as typeof fetch,
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('FilesPane', () => {
  it('lists changed files from the diff-vs-main response', async () => {
    renderWithClient(<FilesPane pane={pane} ctx={ctx()} />)
    await waitFor(() => expect(screen.getByText('src/a.ts')).toBeTruthy())
    expect(screen.getByText('src/b.ts')).toBeTruthy()
  })

  it('opens a commits pane when a file is clicked', async () => {
    const openPane = vi.fn()
    renderWithClient(<FilesPane pane={pane} ctx={ctx({ openPane })} />)
    await waitFor(() => expect(screen.getByText('src/a.ts')).toBeTruthy())
    fireEvent.click(screen.getByText('src/a.ts'))
    expect(openPane).toHaveBeenCalledWith(expect.objectContaining({ paneType: 'commits' }))
  })

  it('shows an empty state when there is no agent workspace', () => {
    renderWithClient(<FilesPane pane={pane} ctx={ctx({ agentId: undefined })} />)
    expect(screen.getByText(/no agent workspace/i)).toBeTruthy()
  })
})
