import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ensureEditRoot: vi.fn() }))

vi.mock('../edit-workspace-switch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../edit-workspace-switch')>()),
  ensureEditRoot: mocks.ensureEditRoot,
}))

import { usePanesStore } from '../../../../lib/panesStore'
import { CREATING_EDIT_NOTE, EditorBar, MAIN_CHECKOUT_SENTENCE } from '../EditorBar'
import { useEditWorkspaceStore } from '../edit-workspace-store'

const DECK = 'p'
const sentence = () => screen.getByTestId('editor-bar-sentence').textContent

beforeEach(() => {
  mocks.ensureEditRoot.mockReset()
  mocks.ensureEditRoot.mockResolvedValue('workspace:w1')
  useEditWorkspaceStore.setState({ creating: {}, active: {}, pending: {}, landed: {} })
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('EditorBar on a project root (PAN-5290 FR-8, FR-11)', () => {
  it('says this is the main checkout and Start editing creates the edit root', () => {
    render(<EditorBar rootId="project:p" deckKey={DECK} paneId="c1" />)
    expect(sentence()).toBe(MAIN_CHECKOUT_SENTENCE)
    fireEvent.click(screen.getByRole('button', { name: 'Start editing' }))
    expect(mocks.ensureEditRoot).toHaveBeenCalledWith('project:p')
  })

  it('reads "Creating edit workspace…" while the edit workspace is being created', () => {
    useEditWorkspaceStore.getState().setCreating('p', true)
    render(<EditorBar rootId="project:p" deckKey={DECK} />)
    expect(sentence()).toBe(CREATING_EDIT_NOTE)
    expect(screen.queryByRole('button', { name: 'Start editing' })).toBeNull()
  })

  it('shows the merged note with Dismiss and Close tab', () => {
    useEditWorkspaceStore.getState().setLanded('p', { kind: 'merged', prNumber: 12, defaultBranch: 'main' })
    render(<EditorBar rootId="project:p" deckKey={DECK} paneId="c1" />)
    expect(sentence()).toBe('Merged PR #12 into main. The edit workspace and its branch were removed; this tab now shows main.')
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close tab' })).toBeTruthy()
  })

  it('shows the pipeline note with Open PR', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    useEditWorkspaceStore.getState().setLanded('p', { kind: 'pipeline', issueId: 'PAN-9', prNumber: 13, prUrl: 'https://github.com/o/r/pull/13' })
    render(<EditorBar rootId="project:p" deckKey={DECK} paneId="c1" />)
    expect(sentence()).toBe('Sent through the pipeline as PAN-9 · PR #13. Review agents will check it.')
    fireEvent.click(screen.getByRole('button', { name: 'Open PR' }))
    expect(open).toHaveBeenCalledWith('https://github.com/o/r/pull/13', '_blank', 'noopener')
  })

  it('shows the discarded note', () => {
    useEditWorkspaceStore.getState().setLanded('p', { kind: 'discarded', workspaceName: 'edit-1115-1200' })
    render(<EditorBar rootId="project:p" deckKey={DECK} paneId="c1" />)
    expect(sentence()).toBe('Discarded edit workspace edit-1115-1200. This tab now shows main.')
  })

  it('Dismiss clears the note and shows the main-checkout sentence again', () => {
    useEditWorkspaceStore.getState().setLanded('p', { kind: 'discarded', workspaceName: 'edit-1' })
    render(<EditorBar rootId="project:p" deckKey={DECK} paneId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(useEditWorkspaceStore.getState().landed.p).toBeUndefined()
    expect(sentence()).toBe(MAIN_CHECKOUT_SENTENCE)
  })

  it('Close tab closes the pane, and renders only in a code pane', () => {
    const closePane = vi.spyOn(usePanesStore.getState(), 'closePane').mockImplementation(() => {})
    useEditWorkspaceStore.getState().setLanded('p', { kind: 'merged', prNumber: 1, defaultBranch: 'main' })
    const { unmount } = render(<EditorBar rootId="project:p" deckKey={DECK} paneId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(closePane).toHaveBeenCalledWith(DECK, 'c1')
    unmount()
    render(<EditorBar rootId="project:p" deckKey={DECK} />)
    expect(screen.queryByRole('button', { name: 'Close tab' })).toBeNull()
  })

  it('a new edit workspace for the project clears its landed note', () => {
    useEditWorkspaceStore.getState().setLanded('p', { kind: 'discarded', workspaceName: 'edit-1' })
    useEditWorkspaceStore.getState().setCreating('p', true)
    expect(useEditWorkspaceStore.getState().landed.p).toBeUndefined()
  })

  it('renders nothing on an issue root', () => {
    const { container } = render(<EditorBar rootId="issue:PAN-1" deckKey={DECK} paneId="c1" />)
    expect(container.textContent).toBe('')
  })
})
