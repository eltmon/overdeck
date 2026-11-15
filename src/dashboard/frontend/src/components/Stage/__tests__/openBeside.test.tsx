import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// The latest deck context an agent stub saw, so tests can call deck seams directly (PAN-5290 C-D3).
const captured = vi.hoisted(() => ({ deck: null as import('../StageDeckContext').StageDeckContextValue | null }))

// The agent stub calls the deck seams the way a chat file link will (PAN-5287 §6.2).
vi.mock('../panes/AgentPane', async () => {
  const { useStageDeck } = await import('../StageDeckContext')
  return {
    AgentPane: () => {
      const deck = useStageDeck()
      captured.deck = deck
      return (
        <div data-testid="agent-pane">
          <button type="button" onClick={() => deck?.openBeside?.({ rootId: 'project:overdeck', path: 'src/a.ts', preview: true })}>
            open a.ts
          </button>
          <button type="button" onClick={() => deck?.openBeside?.({ rootId: 'project:overdeck', path: 'src/b.ts', preview: true })}>
            open b.ts
          </button>
          <button type="button" onClick={() => deck?.openBeside?.({ rootId: 'project:overdeck', path: 'src/c.ts' })}>
            open c.ts
          </button>
          <button type="button" onClick={() => deck?.openBeside?.({ rootId: 'project:overdeck', path: 'src/d.ts' })}>
            open d.ts
          </button>
          <button type="button" onClick={() => deck?.openDock?.({ tab: 'changes', changesScope: 'uncommitted' })}>
            open dock
          </button>
        </div>
      )
    },
  }
})
vi.mock('../../terminal/TerminalDrawer', () => ({
  TerminalDrawer: () => <div data-testid="terminal-drawer" />,
}))

import { Stage } from '../index'
import { usePanesStore, selectPanesForWorkspace, selectActivePaneId } from '../../../lib/panesStore'
import { useTerminalStateStore } from '../../terminal/terminalStateStore'
import { useWorkDockStore } from '../../dock/workDockStore'
import { collectLeafIds, type PaneLayout } from '../../../lib/paneLayout'
import { installWorkDockFetchMock } from '../../../test-utils/strictFetchMock'
import type { Conversation } from '../../CommandDeck/ConversationList'

// PAN-5289: the Stage mounts the work dock, which loads the project and workspace registries.
let workDockFetch: ReturnType<typeof installWorkDockFetchMock>
beforeEach(() => {
  workDockFetch = installWorkDockFetchMock()
})
afterEach(async () => {
  await workDockFetch.assertNoUnexpectedRequests()
  vi.unstubAllGlobals()
})

const DECK = 'overdeck'

function renderStage(conversations?: Conversation[]): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <Stage deckKey={DECK} conversations={conversations} renderHome={() => <div data-testid="home" />} renderIssue={(id: string) => <div>{id}</div>} />
    </QueryClientProvider>,
  )
}

function savedLayout(): PaneLayout {
  return JSON.parse(localStorage.getItem(`pan-layout:${DECK}`) ?? 'null') as PaneLayout
}

function codePanes() {
  return selectPanesForWorkspace(DECK)(usePanesStore.getState()).filter((p) => p.paneType === 'code')
}

function addAgent(): string {
  return usePanesStore.getState().addPane(DECK, { paneType: 'agent', label: 'Chat', conversationId: 'conv-1' })
}

function split(a: string, b: string): void {
  const layout: PaneLayout = { kind: 'split', dir: 'row', ratio: 0.5, a: { kind: 'leaf', paneId: a }, b: { kind: 'leaf', paneId: b } }
  localStorage.setItem(`pan-layout:${DECK}`, JSON.stringify(layout))
}

function conversation(name: string): Conversation {
  return {
    id: 1,
    name,
    tmuxSession: name,
    status: 'active',
    cwd: '/repo',
    issueId: null,
    createdAt: '2026-11-15T00:00:00.000Z',
    endedAt: null,
    lastAttachedAt: null,
    sessionAlive: true,
  } as Conversation
}

beforeEach(() => {
  captured.deck = null
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  useTerminalStateStore.setState({ terminalStateByThreadId: {} })
  useWorkDockStore.setState({ byDeck: {} })
})

describe('Stage openBeside (PAN-5287)', () => {
  it('splits an unsplit deck into a row with the chat left and the file right', () => {
    usePanesStore.getState().ensureHome(DECK)
    const agent = addAgent()
    usePanesStore.getState().setActivePane(DECK, agent)
    renderStage()

    fireEvent.click(screen.getByRole('button', { name: 'open a.ts' }))

    const [code] = codePanes()
    expect(code).toBeDefined()
    const saved = savedLayout()
    expect(saved.kind === 'split' && saved.dir).toBe('row')
    expect(collectLeafIds(saved)).toEqual([agent, code.paneId])
    expect(selectActivePaneId(DECK)(usePanesStore.getState())).toBe(code.paneId)
    expect(selectPanesForWorkspace(DECK)(usePanesStore.getState()).some((p) => p.paneId === agent)).toBe(true)
  })

  it('uses the other region when the deck is already split', () => {
    const store = usePanesStore.getState()
    store.ensureHome(DECK)
    const agent = addAgent()
    const web = store.addPane(DECK, { paneType: 'browser', label: 'Web' })
    store.setActivePane(DECK, agent)
    split(agent, web)
    renderStage()

    fireEvent.click(screen.getByRole('button', { name: 'open a.ts' }))

    const [code] = codePanes()
    expect(collectLeafIds(savedLayout())).toEqual([agent, code.paneId])
  })

  it('reuses the preview pane for a second file and keeps it in its region', () => {
    usePanesStore.getState().ensureHome(DECK)
    const agent = addAgent()
    usePanesStore.getState().setActivePane(DECK, agent)
    renderStage()

    fireEvent.click(screen.getByRole('button', { name: 'open a.ts' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'open b.ts' })[0])

    const panes = codePanes()
    expect(panes).toHaveLength(1)
    expect(panes[0].explorerPath).toBe('src/b.ts')
    expect(collectLeafIds(savedLayout())).toEqual([agent, panes[0].paneId])
  })

  it('reuses a region showing a code pane before any other region', () => {
    const store = usePanesStore.getState()
    store.ensureHome(DECK)
    const agent = addAgent()
    store.addPane(DECK, { paneType: 'browser', label: 'Web' })
    const codeA = store.addPane(DECK, {
      paneType: 'code',
      label: 'a.ts',
      explorerRootId: 'project:overdeck',
      explorerPath: 'src/a.ts',
    })
    store.setActivePane(DECK, agent)
    split(agent, codeA)
    renderStage()

    fireEvent.click(screen.getByRole('button', { name: 'open c.ts' }))

    const codeC = codePanes().find((p) => p.explorerPath === 'src/c.ts')
    expect(codeC).toBeDefined()
    expect(collectLeafIds(savedLayout())).toEqual([agent, codeC?.paneId])
  })

  it('keeps the chat when a second file opens while the first file is active', () => {
    usePanesStore.getState().ensureHome(DECK)
    const agent = addAgent()
    usePanesStore.getState().setActivePane(DECK, agent)
    renderStage()

    fireEvent.click(screen.getByRole('button', { name: 'open c.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'open d.ts' }))

    const codeD = codePanes().find((p) => p.explorerPath === 'src/d.ts')
    expect(codeD).toBeDefined()
    expect(collectLeafIds(savedLayout())).toEqual([agent, codeD?.paneId])
  })

  it('openDock writes the dock store', () => {
    usePanesStore.getState().ensureHome(DECK)
    const agent = addAgent()
    usePanesStore.getState().setActivePane(DECK, agent)
    renderStage()

    fireEvent.click(screen.getByRole('button', { name: 'open dock' }))

    expect(useWorkDockStore.getState().byDeck[DECK]).toMatchObject({ open: true, tab: 'changes', changesScope: 'uncommitted' })
  })
})

describe('Stage conversationBeside (PAN-5290 C-D3)', () => {
  it('returns the conversation openBeside split beside a code pane', () => {
    usePanesStore.getState().ensureHome(DECK)
    const agent = addAgent()
    usePanesStore.getState().setActivePane(DECK, agent)
    const conv = conversation('conv-1')
    renderStage([conv])

    fireEvent.click(screen.getByRole('button', { name: 'open a.ts' }))

    const [code] = codePanes()
    expect(collectLeafIds(savedLayout())).toEqual([agent, code.paneId])
    expect(captured.deck?.conversationBeside?.(code.paneId)).toBe(conv)
  })

  it('returns null when the deck is not split', () => {
    const store = usePanesStore.getState()
    store.ensureHome(DECK)
    const agent = addAgent()
    const code = store.addPane(DECK, { paneType: 'code', label: 'a.ts', explorerRootId: 'project:overdeck', explorerPath: 'src/a.ts' })
    store.setActivePane(DECK, agent)
    renderStage([conversation('conv-1')])

    expect(captured.deck?.conversationBeside?.(code)).toBeNull()
  })

  it('returns null when the split shows two code panes', () => {
    const store = usePanesStore.getState()
    store.ensureHome(DECK)
    const agent = addAgent()
    const codeA = store.addPane(DECK, { paneType: 'code', label: 'a.ts', explorerRootId: 'project:overdeck', explorerPath: 'src/a.ts' })
    const codeB = store.addPane(DECK, { paneType: 'code', label: 'b.ts', explorerRootId: 'project:overdeck', explorerPath: 'src/b.ts' })
    store.setActivePane(DECK, agent)
    split(codeA, codeB)
    renderStage([conversation('conv-1')])

    expect(captured.deck?.conversationBeside?.(codeA)).toBeNull()
    expect(captured.deck?.conversationBeside?.(codeB)).toBeNull()
  })
})
