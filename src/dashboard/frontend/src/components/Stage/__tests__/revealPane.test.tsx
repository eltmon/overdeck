import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../panes/AgentPane', () => ({
  AgentPane: () => <div data-testid="agent-pane" />,
}))
vi.mock('../../terminal/TerminalDrawer', () => ({
  TerminalDrawer: () => <div data-testid="terminal-drawer" />,
}))
// The code pane stub opens another file the way a code pane link does:
// openCodePane, then the deck's revealPane beside itself.
vi.mock('../../explorer/code/CodePaneSlot', async () => {
  const { useStageDeck } = await import('../StageDeckContext')
  const { openCodePane } = await import('../../explorer/openCodePane')
  return {
    CodePaneSlot: ({ pane }: { pane: { paneId: string } }) => {
      const deck = useStageDeck()
      return (
        <button
          type="button"
          onClick={() => {
            const id = openCodePane('overdeck', { rootId: 'project:overdeck', path: 'src/a.ts' })
            deck?.revealPane?.(id, pane.paneId)
          }}
        >
          open file
        </button>
      )
    },
  }
})

import { Stage } from '../index'
import { usePanesStore, selectPanesForWorkspace, selectActivePaneId } from '../../../lib/panesStore'
import { useTerminalStateStore } from '../../terminal/terminalStateStore'
import { collectLeafIds, type PaneLayout } from '../../../lib/paneLayout'
import { installWorkDockFetchMock } from '../../../test-utils/strictFetchMock'

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

beforeEach(() => {
  localStorage.clear()
  usePanesStore.setState({ panesByWorkspace: {}, activePaneByWorkspace: {} })
  useTerminalStateStore.setState({ terminalStateByThreadId: {} })
})

describe('Stage revealPane (PAN-5186)', () => {
  it('puts a file opened from a code pane into the other split region, keeping the opener visible', () => {
    const store = usePanesStore.getState()
    store.ensureHome(DECK)
    const web = store.addPane(DECK, { paneType: 'browser', label: 'Web' })
    const opener = store.addPane(DECK, { paneType: 'code', label: 'z.ts', explorerRootId: 'project:overdeck', explorerPath: 'src/z.ts' })
    const layout: PaneLayout = { kind: 'split', dir: 'row', ratio: 0.5, a: { kind: 'leaf', paneId: opener }, b: { kind: 'leaf', paneId: web } }
    localStorage.setItem(`pan-layout:${DECK}`, JSON.stringify(layout))

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <Stage deckKey={DECK} renderHome={() => <div data-testid="home" />} renderIssue={(id: string) => <div>{id}</div>} />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'open file' }))

    const code = selectPanesForWorkspace(DECK)(usePanesStore.getState()).find((p) => p.paneType === 'code' && p.explorerPath === 'src/a.ts')
    expect(code).toBeDefined()
    const saved = JSON.parse(localStorage.getItem(`pan-layout:${DECK}`) ?? 'null') as PaneLayout
    expect(collectLeafIds(saved)).toEqual([opener, code?.paneId])
    expect(selectActivePaneId(DECK)(usePanesStore.getState())).toBe(code?.paneId)
  })
})
