import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ExplorerGitStatusResult } from '@overdeck/contracts'

const git = vi.hoisted(() => ({ result: null as ExplorerGitStatusResult | null, errorCode: undefined as string | undefined }))
vi.mock('../../explorer/git/useExplorerGitStatus', () => ({
  useExplorerGitStatus: () => ({ result: git.result, decorations: { files: new Map(), folders: new Map() }, errorCode: git.errorCode, errorMessage: undefined, refresh: () => {} }),
}))

import { RootChangesList } from '../changes/RootChangesList'
import { useWorkDockStore } from '../workDockStore'
import { StageDeckProvider, type StageDeckContextValue } from '../../Stage/StageDeckContext'

const DECK = 'p'
let deck: StageDeckContextValue

function renderList() {
  return render(
    <StageDeckProvider value={deck}>
      <RootChangesList deckKey={DECK} rootId="issue:PAN-1" />
    </StageDeckProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  useWorkDockStore.setState({ byDeck: {} })
  deck = { deckKey: DECK, openOrFocusEditorPane: vi.fn(), openOrFocusAgentPane: vi.fn(), openBeside: vi.fn(() => 'c') }
  git.errorCode = undefined
  git.result = {
    entries: [
      { path: 'src/a.ts', status: 'modified', staged: false },
      { path: 'src/new.ts', status: 'untracked', staged: false },
    ],
    committed: [{ path: 'docs/x.md', status: 'modified' }],
    branch: 'feature/x',
    truncated: false,
  }
})

describe('RootChangesList', () => {
  it('groups uncommitted entries and the files committed on the branch', () => {
    renderList()
    const groups = screen.getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Not committed yet', 'Committed on feature/x'])
    expect(groups[0].querySelectorAll('[data-change-path]')).toHaveLength(2)
    expect(groups[1].querySelectorAll('[data-change-path]')).toHaveLength(1)
  })

  it('opens an uncommitted diff, a committed diff against main, beside and reveal', () => {
    renderList()
    const work = document.querySelector('[data-change-path="src/a.ts"]') as HTMLElement
    fireEvent.click(within(work).getByRole('button', { name: 'Open diff' }))
    expect(useWorkDockStore.getState().byDeck[DECK].diff).toEqual({ path: 'src/a.ts' })
    const done = document.querySelector('[data-change-path="docs/x.md"]') as HTMLElement
    fireEvent.click(within(done).getByRole('button', { name: 'Open diff' }))
    expect(useWorkDockStore.getState().byDeck[DECK].diff).toEqual({ path: 'docs/x.md', committedVsMain: true })
    fireEvent.click(within(done).getByRole('button', { name: 'Open the file beside the chat' }))
    expect(deck.openBeside).toHaveBeenCalledWith({ rootId: 'issue:PAN-1', path: 'docs/x.md' })
    fireEvent.click(within(done).getByRole('button', { name: 'Reveal in files' }))
    expect(useWorkDockStore.getState().byDeck[DECK]).toMatchObject({ tab: 'files', reveal: { rootId: 'issue:PAN-1', path: 'docs/x.md' } })
  })

  it('says so when nothing changed, and for a folder that is not a git repository', () => {
    git.result = { entries: [], committed: [], branch: 'main', truncated: false }
    const { unmount } = renderList()
    expect(screen.getByText('No changes on this root.')).toBeInTheDocument()
    unmount()
    git.result = null
    git.errorCode = 'NOT_A_GIT_REPO'
    renderList()
    expect(screen.getByText('Not a git repository, so there are no changes to show.')).toBeInTheDocument()
  })
})
