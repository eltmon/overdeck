import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { PanRpcError } from '@overdeck/contracts'

const MODIFIED_MD = `diff --git a/docs/a.md b/docs/a.md\nindex 1111111..2222222 100644\n--- a/docs/a.md\n+++ b/docs/a.md\n@@ -1 +1 @@\n-# Old\n+# New\n`
const ADDED_MD = `diff --git a/docs/a.md b/docs/a.md\nnew file mode 100644\nindex 0000000..2222222\n--- /dev/null\n+++ b/docs/a.md\n@@ -0,0 +1,3 @@\n+# Title\n+\n+body\n`
const DELETED_MD = `diff --git a/docs/a.md b/docs/a.md\ndeleted file mode 100644\nindex 2222222..0000000\n--- a/docs/a.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-# Gone\n`

const rpc = vi.hoisted(() => ({ readFile: vi.fn() }))
vi.mock('../../explorer/explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer/explorer-rpc')>()),
  readFile: rpc.readFile,
}))
// The shadow-DOM renderer is out of scope; PatchFiles' list structure is enough here.
vi.mock('@pierre/diffs/react', () => ({
  Virtualizer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => <div data-testid="file-diff">{fileDiff.name}</div>,
}))

import { DockDiffView, NO_WORKSPACE_COMMIT_DIFF, TOO_LARGE_SENTENCE } from '../changes/DockDiffView'
import { useExplorerStore } from '../../explorer/explorerStore'
import { useDashboardStore } from '../../../lib/store'
import { installShortcutListener, resetShortcutsForTests } from '../../../lib/shortcuts/registry'
import type { DockScope } from '../dockScope'
import type { DockDiffTarget } from '../workDockStore'

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
`

function scopeFor(rootId: string | null, kind: 'conversation' | 'root' = 'root'): DockScope {
  return {
    rootId,
    changes: kind === 'root' && rootId ? { kind: 'root', rootId } : { kind: 'none' },
    header: { kind: 'none' },
    deckRootId: null,
    overridden: false,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

function renderView(props: { scope: DockScope; list: DockDiffTarget[]; index?: number; onIndex?: (i: number) => void }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onIndex = props.onIndex ?? vi.fn()
  const utils = render(
    <QueryClientProvider client={qc}>
      <DockDiffView deckKey="p" scope={props.scope} list={props.list} index={props.index ?? 0} onIndex={onIndex} onBack={vi.fn()} />
    </QueryClientProvider>,
  )
  return { ...utils, onIndex }
}

beforeEach(() => {
  localStorage.clear()
  rpc.readFile.mockReset()
  useExplorerStore.setState({ roots: {} })
  useExplorerStore.getState().setDir('project:p', '', { status: 'ready', entries: [], truncated: false, absPath: '/r' })
  useDashboardStore.setState({ agentsById: {} } as Parameters<typeof useDashboardStore.setState>[0])
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/registered-projects') return Response.json([])
    if (url === '/api/workspace-registry') return Response.json({ workspaces: [] })
    if (url.startsWith('/api/diffs/compare')) return Response.json({ files: [], diff: PATCH })
    if (url.includes('/diffs/vs-main')) return Response.json({ error: 'Agent not found' }, { status: 404 })
    return Response.json({ error: `unexpected ${url}` }, { status: 500 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetShortcutsForTests()
  vi.restoreAllMocks()
})

describe('DockDiffView', () => {
  it('compares a committed file against its parent and renders the patch', async () => {
    renderView({ scope: scopeFor('project:p'), list: [{ path: 'src/a.ts', sha: 'abc', repoRoot: '/r', repoPath: 'src/a.ts', pushed: true }] })
    expect(await screen.findByTestId('file-diff')).toHaveTextContent('src/a.ts')
    const url = fetchMock.mock.calls.map(([u]) => String(u)).find((u) => u.startsWith('/api/diffs/compare'))
    expect(url).toBe('/api/diffs/compare?repo=%2Fr&base=abc%5E&head=abc&file=src%2Fa.ts')
    expect(screen.getByText('abc · pushed')).toBeInTheDocument()
  })

  it('diffs an uncommitted text file from HEAD to the working copy', async () => {
    rpc.readFile.mockImplementation(async (_root: string, _path: string, ref?: string) => ({ kind: 'text', text: ref === 'HEAD' ? 'old\n' : 'new\n', size: 4, mtimeMs: 0, signature: 's', lang: 'ts', writable: true }))
    renderView({ scope: scopeFor('issue:PAN-1'), list: [{ path: 'src/a.ts' }] })
    expect(await screen.findByTestId('file-diff')).toHaveTextContent('src/a.ts')
    expect(rpc.readFile).toHaveBeenCalledWith('issue:PAN-1', 'src/a.ts', 'HEAD')
    expect(rpc.readFile).toHaveBeenCalledWith('issue:PAN-1', 'src/a.ts')
    expect(screen.getAllByTestId('file-diff')).toHaveLength(1)
    expect(screen.getByText('not committed')).toBeInTheDocument()
  })

  it('diffs a new file against nothing and refuses a binary file', async () => {
    rpc.readFile.mockImplementation(async (_root: string, _path: string, ref?: string) => {
      if (ref === 'HEAD') throw new PanRpcError({ message: 'missing', code: 'NOT_FOUND' })
      return { kind: 'text', text: 'new\n', size: 4, mtimeMs: 0, signature: 's', lang: 'ts', writable: true }
    })
    const { unmount } = renderView({ scope: scopeFor('issue:PAN-1'), list: [{ path: 'src/new.ts' }] })
    expect(await screen.findByTestId('file-diff')).toHaveTextContent('src/new.ts')
    unmount()
    rpc.readFile.mockResolvedValue({ kind: 'binary', size: 9, mtimeMs: 0, signature: 's', lang: '', writable: true })
    renderView({ scope: scopeFor('issue:PAN-1'), list: [{ path: 'img.png' }] })
    expect(await screen.findByText(TOO_LARGE_SENTENCE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open beside chat/ })).toBeInTheDocument()
  })

  it('steps through the list with wrap, and J moves only while focus is not in a text field', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64')
    const uninstall = installShortcutListener()
    rpc.readFile.mockResolvedValue({ kind: 'text', text: 'x', size: 1, mtimeMs: 0, signature: 's', lang: 'ts', writable: true })
    const list = [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }]
    const { onIndex } = renderView({ scope: scopeFor('issue:PAN-1'), list, index: 2 })
    expect(screen.getByTestId('dock-diff-position')).toHaveTextContent('3/3')
    fireEvent.click(screen.getByRole('button', { name: 'Next file (J)' }))
    expect(onIndex).toHaveBeenLastCalledWith(0)
    fireEvent.click(screen.getByRole('button', { name: 'Previous file (K)' }))
    expect(onIndex).toHaveBeenLastCalledWith(1)
    onIndex.mockClear()
    act(() => {
      fireEvent.keyDown(document.body, { key: 'j' })
    })
    expect(onIndex).toHaveBeenCalledWith(0)
    onIndex.mockClear()
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    act(() => {
      fireEvent.keyDown(input, { key: 'j' })
    })
    expect(onIndex).not.toHaveBeenCalled()
    input.remove()
    uninstall()
  })

  it('reports a vs-main failure for an issue branch file and keeps Open beside', async () => {
    useDashboardStore.setState({
      agentsById: { 'agent-pan-1': { id: 'agent-pan-1', issueId: 'PAN-1', role: 'work', status: 'running' } },
    } as unknown as Parameters<typeof useDashboardStore.setState>[0])
    renderView({ scope: scopeFor('issue:PAN-1'), list: [{ path: 'docs/x.md', committedVsMain: true }] })
    await waitFor(() => expect(screen.getByText(/^Couldn't load this diff:/)).toBeInTheDocument())
    expect(screen.getByText("Couldn't load this diff: Agent not found")).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/agents/agent-pan-1/diffs/vs-main?file=docs%2Fx.md')).toBe(true)
    expect(screen.getByRole('button', { name: /Open beside chat/ })).toBeEnabled()
  })

  it('says no agent has worked on the issue when there is none', async () => {
    renderView({ scope: scopeFor('issue:PAN-1'), list: [{ path: 'docs/x.md', committedVsMain: true }] })
    expect(await screen.findByText("Couldn't load this diff: no agent has worked on this issue")).toBeInTheDocument()
  })

  it('diffs a file deleted in the working tree against nothing (PAN-5289 review)', async () => {
    rpc.readFile.mockImplementation(async (_root: string, _path: string, ref?: string) => {
      if (ref === 'HEAD') return { kind: 'text', text: 'gone\n', size: 5, mtimeMs: 0, signature: 's', lang: 'ts', writable: true }
      throw new PanRpcError({ message: '"src/gone.ts" does not exist', code: 'NOT_FOUND' })
    })
    renderView({ scope: scopeFor('issue:PAN-1'), list: [{ path: 'src/gone.ts' }] })
    expect(await screen.findByTestId('file-diff')).toHaveTextContent('src/gone.ts')
    expect(screen.queryByText(/Couldn't load this diff/)).toBeNull()
  })

  it('says an edit workspace has no committed-file diff', async () => {
    renderView({ scope: scopeFor('workspace:w1'), list: [{ path: 'docs/x.md', committedVsMain: true }] })
    expect(await screen.findByText(NO_WORKSPACE_COMMIT_DIFF)).toBeInTheDocument()
    expect(rpc.readFile).not.toHaveBeenCalled()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('previews an uncommitted Markdown file as the working-tree text', async () => {
    rpc.readFile.mockImplementation(async (_root: string, _path: string, ref?: string) => ({
      kind: 'text',
      text: ref === 'HEAD' ? '# Old\n' : '# New\n',
      size: 4,
      mtimeMs: 0,
      signature: 's',
      lang: 'md',
      writable: true,
    }))
    renderView({ scope: scopeFor('issue:PAN-1'), list: [{ path: 'docs/a.md' }] })
    expect(await screen.findByTestId('file-diff')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Diff' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(await screen.findByTestId('diff-markdown-preview')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'New' })).toBeInTheDocument()
    expect(screen.queryByTestId('file-diff')).toBeNull()
  })

  it('previews a committedVsMain Markdown file at HEAD', async () => {
    useDashboardStore.setState({
      agentsById: { 'agent-pan-1': { id: 'agent-pan-1', issueId: 'PAN-1', role: 'work', status: 'running' } },
    } as unknown as Parameters<typeof useDashboardStore.setState>[0])
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/agents/agent-pan-1/diffs/vs-main?file=docs%2Fa.md') return Response.json({ diff: MODIFIED_MD })
      return Response.json({ error: `unexpected ${url}` }, { status: 500 })
    })
    rpc.readFile.mockResolvedValue({ kind: 'text', text: '# Head\n', size: 4, mtimeMs: 0, signature: 's', lang: 'md', writable: true })
    renderView({ scope: scopeFor('issue:PAN-1'), list: [{ path: 'docs/a.md', committedVsMain: true }] })
    expect(await screen.findByRole('tab', { name: 'Preview' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    await waitFor(() => expect(rpc.readFile).toHaveBeenCalledWith('issue:PAN-1', 'docs/a.md', 'HEAD'))
  })

  it('previews a commit-added Markdown file from the patch text without reading the file', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/diffs/compare')) return Response.json({ diff: ADDED_MD })
      return Response.json({ error: `unexpected ${url}` }, { status: 500 })
    })
    renderView({
      scope: scopeFor('project:p'),
      list: [{ path: 'docs/a.md', sha: 'abc', repoRoot: '/r', repoPath: 'docs/a.md' }],
    })
    expect(await screen.findByRole('tab', { name: 'Preview' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(await screen.findByRole('heading', { name: 'Title' })).toBeInTheDocument()
    expect(rpc.readFile).not.toHaveBeenCalled()
  })

  it('previews a commit-modified Markdown file as the current working-tree text, with the note', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/diffs/compare')) return Response.json({ diff: MODIFIED_MD })
      return Response.json({ error: `unexpected ${url}` }, { status: 500 })
    })
    rpc.readFile.mockResolvedValue({ kind: 'text', text: '# Current\n', size: 4, mtimeMs: 0, signature: 's', lang: 'md', writable: true })
    renderView({
      scope: scopeFor('project:p'),
      list: [{ path: 'docs/a.md', sha: 'abc', repoRoot: '/r', repoPath: 'docs/a.md' }],
    })
    expect(await screen.findByRole('tab', { name: 'Preview' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(await screen.findByText('Showing the current file')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Current' })).toBeInTheDocument()
    expect(rpc.readFile).toHaveBeenCalledWith('project:p', 'docs/a.md', undefined)
  })

  it('shows no switch for a .ts file, a deleted Markdown file, a commit-deleted Markdown file, or an edit-workspace committed file', async () => {
    rpc.readFile.mockResolvedValue({ kind: 'text', text: 'x', size: 1, mtimeMs: 0, signature: 's', lang: 'ts', writable: true })
    renderView({ scope: scopeFor('issue:PAN-1'), list: [{ path: 'src/a.ts' }] })
    await screen.findByTestId('file-diff')
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('shows no switch for an uncommitted Markdown file deleted from the working tree', async () => {
    rpc.readFile.mockImplementation(async (_root: string, _path: string, ref?: string) => {
      if (ref === 'HEAD') return { kind: 'text', text: '# Gone\n', size: 5, mtimeMs: 0, signature: 's', lang: 'md', writable: true }
      throw new PanRpcError({ message: '"docs/gone.md" does not exist', code: 'NOT_FOUND' })
    })
    renderView({ scope: scopeFor('issue:PAN-1'), list: [{ path: 'docs/gone.md' }] })
    await screen.findByTestId('file-diff')
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('shows no switch for a commit-deleted Markdown file', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/diffs/compare')) return Response.json({ diff: DELETED_MD })
      return Response.json({ error: `unexpected ${url}` }, { status: 500 })
    })
    renderView({
      scope: scopeFor('project:p'),
      list: [{ path: 'docs/a.md', sha: 'abc', repoRoot: '/r', repoPath: 'docs/a.md' }],
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('resets the switch to Diff when stepping to another target', async () => {
    rpc.readFile.mockImplementation(async (_root: string, _path: string, ref?: string) => ({
      kind: 'text',
      text: ref === 'HEAD' ? '# Old\n' : '# New\n',
      size: 4,
      mtimeMs: 0,
      signature: 's',
      lang: 'md',
      writable: true,
    }))
    const list = [{ path: 'docs/a.md' }, { path: 'docs/b.md' }]
    const scope = scopeFor('issue:PAN-1')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <DockDiffView deckKey="p" scope={scope} list={list} index={0} onIndex={vi.fn()} onBack={vi.fn()} />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('tab', { name: 'Preview' }))
    expect(await screen.findByTestId('diff-markdown-preview')).toBeInTheDocument()

    rerender(
      <QueryClientProvider client={qc}>
        <DockDiffView deckKey="p" scope={scope} list={list} index={1} onIndex={vi.fn()} onBack={vi.fn()} />
      </QueryClientProvider>,
    )
    expect(await screen.findByTestId('file-diff')).toBeInTheDocument()
    expect(screen.queryByTestId('diff-markdown-preview')).toBeNull()
  })
})
