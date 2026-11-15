import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readFileMock = vi.hoisted(() => vi.fn())

vi.mock('../../explorer/explorer-rpc', async () => {
  const actual = await vi.importActual<typeof import('../../explorer/explorer-rpc')>(
    '../../explorer/explorer-rpc',
  )
  return { ...actual, readFile: readFileMock }
})

import { DiffMarkdownPreview } from '../DiffMarkdownPreview'
import type { PreviewSource } from '../markdownPreviewSource'

function renderPreview(source: PreviewSource): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DiffMarkdownPreview source={source} />
    </QueryClientProvider>,
  )
}

describe('DiffMarkdownPreview', () => {
  beforeEach(() => {
    readFileMock.mockReset()
  })

  it('renders a patch source without calling readFile', () => {
    renderPreview({ kind: 'patch', text: '# Title\n' })

    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('reads with the given ref for a read source', async () => {
    readFileMock.mockResolvedValue({ kind: 'text', text: '# Title\n', size: 8, mtimeMs: 0, signature: 's', lang: 'markdown', writable: false })
    renderPreview({ kind: 'read', rootId: 'issue:PAN-1', path: 'docs/a.md', ref: 'HEAD', note: false })

    await waitFor(() => expect(readFileMock).toHaveBeenCalledWith('issue:PAN-1', 'docs/a.md', 'HEAD'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
  })

  it('renders the current-file note when note is true', async () => {
    readFileMock.mockResolvedValue({ kind: 'text', text: 'body', size: 4, mtimeMs: 0, signature: 's', lang: 'markdown', writable: false })
    renderPreview({ kind: 'read', rootId: 'issue:PAN-1', path: 'docs/a.md', note: true })

    expect(await screen.findByTestId('diff-preview-note')).toHaveTextContent('Showing the current file')
  })

  it('renders the too-large sentence for a large-text result', async () => {
    readFileMock.mockResolvedValue({ kind: 'large-text', size: 999999, mtimeMs: 0, signature: 's', lang: 'markdown', writable: false })
    renderPreview({ kind: 'read', rootId: 'issue:PAN-1', path: 'docs/a.md', note: false })

    expect(await screen.findByText('This file is too large to preview.')).toBeInTheDocument()
  })

  it('renders a read error', async () => {
    readFileMock.mockRejectedValue(new Error('boom'))
    renderPreview({ kind: 'read', rootId: 'issue:PAN-1', path: 'docs/a.md', note: false })

    expect(await screen.findByText(/Couldn't read this file: boom/)).toBeInTheDocument()
  })

  it('renders the unavailable message without calling readFile', () => {
    renderPreview({ kind: 'unavailable', message: 'nope' })

    expect(screen.getByText('nope')).toBeInTheDocument()
    expect(readFileMock).not.toHaveBeenCalled()
  })
})
