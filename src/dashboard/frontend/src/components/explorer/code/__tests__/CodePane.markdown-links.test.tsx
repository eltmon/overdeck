/**
 * CodePane Preview document-relative links (PAN-5337, WI-5).
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ExplorerListDirResult, ExplorerReadFileResult } from '@overdeck/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspacePane } from '../../../../lib/panesStore'
import type { StageDeckContextValue } from '../../../Stage/StageDeckContext'

const mocks = vi.hoisted(() => ({ readFile: vi.fn(), listDir: vi.fn() }))

vi.mock('../../explorer-rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../explorer-rpc')>()),
  subscribeWatchStream: () => () => {},
  readFile: mocks.readFile,
  listDir: mocks.listDir,
  writeFile: async () => ({ signature: 'saved', mtimeMs: 2 }),
}))

vi.mock('../MonacoCodeEditor', async () => {
  const React = await import('react')
  return {
    codeModelUri: (rootId: string, path: string) => `overdeck-explorer://${rootId}/${path}`,
    MonacoCodeEditor: (props: { value: string; onMount(editor: unknown): void }) => {
      React.useEffect(() => props.onMount({ setPosition: () => {}, revealLineInCenter: () => {}, focus: () => {} }), [])
      return <textarea data-testid="monaco" value={props.value} readOnly />
    },
  }
})

const { CodePane } = await import('../CodePane')
const { useEditWorkspaceStore } = await import('../../edit/edit-workspace-store')
const { useCodeDrafts } = await import('../code-drafts')
const { clearDocLinkTargetCache } = await import('../../../chat/docLinkTargets')
const { StageDeckProvider } = await import('../../../Stage/StageDeckContext')

function pane(over: Partial<WorkspacePane> = {}): WorkspacePane {
  return {
    paneId: 'p1',
    paneType: 'code',
    label: 'index.md',
    createdAt: 0,
    explorerRootId: 'project:p',
    explorerPath: 'docs/index.md',
    ...over,
  } as WorkspacePane
}

const ctx = { workspaceId: 'p', openPane: () => {} }

function textRead(over: Partial<ExplorerReadFileResult> = {}): ExplorerReadFileResult {
  return {
    kind: 'text',
    text: '[Fort](fort3d.md) [Web](https://example.com)',
    size: 10,
    mtimeMs: 1,
    signature: 'sig-a',
    lang: 'markdown',
    writable: true,
    ...over,
  }
}

function listing(entries: ExplorerListDirResult['entries']): ExplorerListDirResult {
  return { entries, truncated: false, absPath: '/abs' }
}

function deckValue(over: Partial<StageDeckContextValue> = {}): StageDeckContextValue {
  return {
    deckKey: 'p',
    openOrFocusEditorPane: vi.fn(),
    openOrFocusAgentPane: vi.fn(),
    openBeside: vi.fn(),
    openDock: vi.fn(),
    ...over,
  }
}

beforeEach(() => {
  useCodeDrafts.setState({ drafts: {} })
  useEditWorkspaceStore.setState({ creating: {}, active: {}, pending: {} })
  mocks.readFile.mockReset()
  mocks.listDir.mockReset()
  clearDocLinkTargetCache()
})

describe('CodePane Preview document-relative links', () => {
  it('opens a relative link through openBeside and keeps only the https anchor as target=_blank', async () => {
    mocks.readFile.mockResolvedValue(textRead())
    mocks.listDir.mockResolvedValue(
      listing([{ name: 'fort3d.md', path: 'docs/fort3d.md', kind: 'file', mtimeMs: 0, ignored: false }]),
    )
    const deck = deckValue()

    render(
      <StageDeckProvider value={deck}>
        <CodePane pane={pane()} ctx={ctx} />
      </StageDeckProvider>,
    )

    fireEvent.click(await screen.findByRole('tab', { name: 'Preview' }))

    const fortLink = await screen.findByRole('link', { name: 'Fort' })
    expect(fortLink).toHaveAttribute('data-doc-link-state', 'file')
    expect(document.querySelector('a[href="fort3d.md"]')).toBeNull()

    fireEvent.click(fortLink)
    expect(deck.openBeside).toHaveBeenCalledWith({ rootId: 'project:p', path: 'docs/fort3d.md', preview: true })

    const anchors = Array.from(document.querySelectorAll('a[target="_blank"]'))
    expect(anchors).toHaveLength(1)
    expect(anchors[0]).toHaveAttribute('href', 'https://example.com')
  })

  it('reveals a folder link in the Files dock instead of calling openBeside', async () => {
    mocks.readFile.mockResolvedValue(textRead({ text: '[Levels](levels/)' }))
    mocks.listDir.mockResolvedValue(listing([{ name: 'levels', path: 'docs/levels', kind: 'dir', mtimeMs: 0, ignored: false }]))
    const deck = deckValue()

    render(
      <StageDeckProvider value={deck}>
        <CodePane pane={pane()} ctx={ctx} />
      </StageDeckProvider>,
    )

    fireEvent.click(await screen.findByRole('tab', { name: 'Preview' }))

    const levelsLink = await screen.findByRole('link', { name: 'Levels' })
    expect(levelsLink).toHaveAttribute('data-doc-link-state', 'dir')

    fireEvent.click(levelsLink)
    expect(deck.openDock).toHaveBeenCalledWith({ tab: 'files', reveal: { rootId: 'project:p', path: 'docs/levels' } })
    expect(deck.openBeside).not.toHaveBeenCalled()
  })
})
