import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiOpenResolution } from '@overdeck/contracts'

const openCodePane = vi.fn()
vi.mock('../../components/explorer/openCodePane', () => ({ openCodePane: (...args: unknown[]) => openCodePane(...args) }))
vi.mock('sonner', () => ({ toast: vi.fn() }))

import { toast } from 'sonner'
import { useActiveDock, type ActiveDock } from '../../components/dock/activeDock'
import { useWorkDockStore } from '../../components/dock/workDockStore'
import { usePanesStore } from '../panesStore'
import { openPathInDeck } from './openPathInDeck'

const dir = (relPath: string, rootId = 'project:demo'): UiOpenResolution => ({ projectKey: 'demo', rootId, relPath, kind: 'dir' })

function activeDock(partial: Partial<ActiveDock>): ActiveDock {
  return { deckKey: 'demo', activePaneId: 'pane-1', rootId: 'issue:PAN-1', changedPaths: new Set(), openFile: vi.fn(), revealFile: vi.fn(), ...partial }
}

let setRootOverride: ReturnType<typeof vi.spyOn>
let openDock: ReturnType<typeof vi.spyOn>
const navigation = { openInDeck: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  useActiveDock.setState({ current: null })
  setRootOverride = vi.spyOn(useWorkDockStore.getState(), 'setRootOverride').mockImplementation(() => {})
  openDock = vi.spyOn(useWorkDockStore.getState(), 'openDock').mockImplementation(() => {})
  vi.spyOn(usePanesStore.getState(), 'ensureHome').mockImplementation(() => {})
})

describe('openPathInDeck', () => {
  it('shows the deck for the resolution’s project', () => {
    openPathInDeck(dir('docs'), navigation)
    expect(usePanesStore.getState().ensureHome).toHaveBeenCalledWith('demo')
    expect(navigation.openInDeck).toHaveBeenCalledWith({ projectKey: 'demo' })
    expect(toast).toHaveBeenCalledWith('Opened docs from pan open')
  })

  it('overrides the dock root for a folder on another root, anchored on the active pane, then reveals it', () => {
    useActiveDock.setState({ current: activeDock({ rootId: 'issue:PAN-1', activePaneId: 'pane-7' }) })
    openPathInDeck(dir('docs'), navigation)
    expect(setRootOverride).toHaveBeenCalledWith('demo', 'project:demo', 'pane-7')
    expect(openDock).toHaveBeenCalledWith('demo', { tab: 'files', reveal: { rootId: 'project:demo', path: 'docs' } })
    expect(setRootOverride.mock.invocationCallOrder[0]).toBeLessThan(openDock.mock.invocationCallOrder[0])
  })

  it('anchors on the deck’s active pane when no dock is mounted for that deck', () => {
    usePanesStore.setState({ activePaneByWorkspace: { ...usePanesStore.getState().activePaneByWorkspace, demo: 'pane-home' } })
    openPathInDeck(dir('docs'), navigation)
    expect(setRootOverride).toHaveBeenCalledWith('demo', 'project:demo', 'pane-home')
  })

  it('sets no override when the active dock already shows that root', () => {
    useActiveDock.setState({ current: activeDock({ rootId: 'project:demo' }) })
    openPathInDeck(dir('docs'), navigation)
    expect(setRootOverride).not.toHaveBeenCalled()
    expect(openDock).toHaveBeenCalledWith('demo', { tab: 'files', reveal: { rootId: 'project:demo', path: 'docs' } })
  })

  it('opens the dock with no reveal for the root folder itself', () => {
    openPathInDeck(dir(''), navigation)
    expect(openDock).toHaveBeenCalledWith('demo', { tab: 'files', reveal: undefined })
    expect(toast).toHaveBeenCalledWith('Opened root folder from pan open')
  })

  it('opens a file in a code pane at its position, then reveals it with no override', () => {
    openPathInDeck({ projectKey: 'demo', rootId: 'issue:PAN-1', relPath: 'src/a.ts', kind: 'file', line: 10, column: 3 }, navigation)
    expect(openCodePane).toHaveBeenCalledWith('demo', { rootId: 'issue:PAN-1', path: 'src/a.ts', line: 10, column: 3 })
    expect(openDock).toHaveBeenCalledWith('demo', { tab: 'files', reveal: { rootId: 'issue:PAN-1', path: 'src/a.ts' } })
    expect(setRootOverride).not.toHaveBeenCalled()
  })
})
