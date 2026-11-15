import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HomeActions, type HomeActionsProps } from './HomeActions'

const editorState = vi.hoisted(() => ({
  editors: [] as string[],
  preferred: null as string | null,
  openFolderInEditor: vi.fn(),
}))
const mainCheckout = vi.hoisted(() => ({ open: vi.fn(async () => {}), opening: false }))
const dialog = vi.hoisted(() => ({ openNewConversationDialog: vi.fn() }))

vi.mock('../../PanOpenInPicker', () => ({
  EDITOR_LABELS: { vscode: 'VS Code', cursor: 'Cursor' },
  useAvailableEditors: () => ({ editors: editorState.editors, defaultCwd: null, preferred: editorState.preferred }),
  openFolderInEditor: editorState.openFolderInEditor,
}))
vi.mock('../../workspace/openMainWorkspace', () => ({
  useOpenMainCheckout: () => mainCheckout,
}))
vi.mock('../../newConversation/newConversationDialogStore', () => ({
  openNewConversationDialog: dialog.openNewConversationDialog,
}))

function handlers() {
  return {
    onNewConversation: vi.fn(),
    onSelectAgent: vi.fn(),
    onFiles: vi.fn(),
    onChanges: vi.fn(),
    onTerminal: vi.fn(),
    onWebPage: vi.fn(),
    onStartIssue: vi.fn(),
  }
}

function renderActions(props: Partial<HomeActionsProps> = {}) {
  const h = handlers()
  render(<HomeActions projectKey="overdeck" projectPath="/home/someone/overdeck" hasIssuePrefix busy={false} {...h} {...props} />)
  return h
}

function openMore() {
  fireEvent.click(screen.getByRole('button', { name: /^More/ }))
}

beforeEach(() => {
  editorState.editors = []
  editorState.preferred = null
  mainCheckout.opening = false
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('HomeActions (PAN-5294 G-D4)', () => {
  it('calls each action handler exactly once', () => {
    const h = renderActions()

    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    fireEvent.click(screen.getByRole('button', { name: /^Files/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Changes on main' }))
    fireEvent.click(screen.getByRole('button', { name: /^Terminal/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Start an issue…' }))
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Web page' }))

    expect(h.onNewConversation).toHaveBeenCalledTimes(1)
    expect(h.onFiles).toHaveBeenCalledTimes(1)
    expect(h.onChanges).toHaveBeenCalledTimes(1)
    expect(h.onTerminal).toHaveBeenCalledTimes(1)
    expect(h.onStartIssue).toHaveBeenCalledTimes(1)
    expect(h.onWebPage).toHaveBeenCalledTimes(1)
  })

  it('shows the N keycap on New conversation', () => {
    renderActions()
    expect(screen.getByRole('button', { name: 'New conversation' })).toHaveTextContent('N')
  })

  it('lists Claude Code, Codex and New conversation with options… under the caret', () => {
    const h = renderActions()

    fireEvent.click(screen.getByRole('button', { name: 'New conversation options' }))
    expect(screen.getByRole('menuitem', { name: /Claude Code/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'New conversation with options…' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Codex/ }))
    expect(h.onSelectAgent).toHaveBeenCalledWith('codex')
    expect(screen.queryByRole('menu', { name: 'New conversation options' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New conversation options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New conversation with options…' }))
    expect(dialog.openNewConversationDialog).toHaveBeenCalledWith({ projectKey: 'overdeck' })
  })

  it('preselects the deck project key in the New conversation dialog when given one', () => {
    renderActions({ newConversationProjectKey: 'Workflow fixture' })

    fireEvent.click(screen.getByRole('button', { name: 'New conversation options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New conversation with options…' }))
    expect(dialog.openNewConversationDialog).toHaveBeenCalledWith({ projectKey: 'Workflow fixture' })
  })

  it('disables the agent items while a conversation is being created and shows the error inline', () => {
    renderActions({ busy: true, errorText: 'harness unavailable' })

    fireEvent.click(screen.getByRole('button', { name: 'New conversation options' }))
    expect(screen.getByRole('menuitem', { name: /Codex/ })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('harness unavailable')
  })

  it('hides the project-only actions without a project key', () => {
    renderActions({ projectKey: undefined })

    expect(screen.queryByRole('button', { name: /^Files/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Changes on main' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Terminal/ })).toBeInTheDocument()
    openMore()
    expect(screen.getByRole('menuitem', { name: 'Web page' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Main checkout' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'New workspace' })).not.toBeInTheDocument()
  })

  it('hides Start an issue… when the project has no issue prefix', () => {
    renderActions({ hasIssuePrefix: false })
    expect(screen.queryByRole('button', { name: 'Start an issue…' })).not.toBeInTheDocument()
  })

  it('opens the main checkout from More ▾', () => {
    renderActions()
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Main checkout' }))
    expect(mainCheckout.open).toHaveBeenCalledWith('overdeck')
  })

  it('opens the project in the preferred editor when one is available', () => {
    renderActions({ projectPath: undefined })
    expect(screen.queryByRole('button', { name: /^Open in/ })).not.toBeInTheDocument()
    cleanup()

    editorState.editors = ['cursor']
    editorState.preferred = 'cursor'
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: 'Open in Cursor' }))
    expect(editorState.openFolderInEditor).toHaveBeenCalledWith('/home/someone/overdeck', 'cursor')
  })

  // Moved from ProjectOverview.test.tsx (PAN-3330 FR-6c): New workspace now lives under More ▾.
  it('New workspace opens the dialog with that project preselected', () => {
    const onNewWorkspace = vi.fn()
    renderActions({ onNewWorkspace })
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New workspace' }))
    expect(onNewWorkspace).toHaveBeenCalledWith('overdeck')
  })

  it('New workspace falls back to the routed creation page when given no handler', () => {
    window.history.replaceState(null, '', '/command-deck/overdeck')
    renderActions()
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'New workspace' }))
    expect(window.location.pathname).toBe('/workspaces/new')
    expect(window.location.search).toBe('?project=overdeck')
  })

  it('renders no New workspace item for a project with no key', () => {
    renderActions({ projectKey: undefined })
    openMore()
    expect(screen.queryByRole('menuitem', { name: 'New workspace' })).not.toBeInTheDocument()
  })
})
