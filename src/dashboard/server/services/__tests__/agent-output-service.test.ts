import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockEmitOnly = vi.hoisted(() => vi.fn((_event: unknown) => undefined))
const mockAppendAsync = vi.hoisted(() => vi.fn((_event: unknown) => Promise.resolve(1)))
const mockEventStore = { emitOnly: mockEmitOnly, appendAsync: mockAppendAsync }

vi.mock('../../event-store.js', () => ({ getEventStore: () => mockEventStore }))
vi.mock('../../../../lib/tmux.js', () => ({  // PAN-3917 (W6): the backend inventory's tmux fallback reads the pane list
  // synchronously; these tests have no tmux server, so it reads as empty.
  listSessionsSync: () => [],
  listSessions: () => Effect.succeed([]),
  listPaneValuesSync: () => [],
  listPaneValues: async () => [],
 capturePane: vi.fn() }))
// Fake terminal backend: the live pane inventory and its pane reader (#4109).
vi.mock('../../../../lib/terminal-backends/inventory.js', () => ({
  listLiveAgentPanes: vi.fn(async () => []),
  captureLiveAgentPaneText: vi.fn(async () => null),
}))
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(() => Promise.reject(new Error('no remote state'))),
}))

import {
  diffLines,
  pollOnce,
  retainAgentOutputInterest,
  retainAllAgentOutputInterest,
  splitLines,
  startAgentOutputService,
  stopAgentOutputService,
  type AgentOutputServiceState,
} from '../agent-output-service.js'
import { capturePane } from '../../../../lib/tmux.js'
import { captureLiveAgentPaneText, listLiveAgentPanes, type LiveAgentPane } from '../../../../lib/terminal-backends/inventory.js'

const mockCapturePane = vi.mocked(capturePane)
const mockListLiveAgentPanes = vi.mocked(listLiveAgentPanes)
const mockCaptureLiveAgentPaneText = vi.mocked(captureLiveAgentPaneText)

function herdrPane(agentId: string): LiveAgentPane {
  return { backend: 'herdr', agentId, paneId: `w1:${agentId}`, terminalId: `t-${agentId}`, state: 'working' } as LiveAgentPane
}

function createState(agentIds: string[] = []): AgentOutputServiceState {
  return {
    timer: null,
    lastOutput: new Map(),
    interestCounts: new Map(agentIds.map((agentId) => [agentId, 1])),
    allInterestCount: 0,
    inFlight: new Set(),
    polling: false,
    started: true,
  }
}

describe('diffLines', () => {
  it('returns all current lines when previous is empty', () => {
    expect(diffLines([], ['line1', 'line2'])).toEqual(['line1', 'line2'])
  })

  it('returns empty when current equals previous', () => {
    expect(diffLines(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('finds new lines appended to the end', () => {
    expect(diffLines(['boot', 'working'], ['boot', 'working', 'on', 'PAN-1']))
      .toEqual(['on', 'PAN-1'])
  })

  it('handles scrolled panes where some old lines dropped off', () => {
    expect(diffLines(
      ['old1', 'old2', 'old3', 'shared1', 'shared2'],
      ['shared1', 'shared2', 'new1', 'new2'],
    )).toEqual(['new1', 'new2'])
  })

  it('returns all current lines when there is no overlap', () => {
    expect(diffLines(['old1', 'old2'], ['new1', 'new2'])).toEqual(['new1', 'new2'])
  })

  it('handles single-line overlap', () => {
    expect(diffLines(['a', 'b', 'c'], ['c', 'd'])).toEqual(['d'])
  })
})

describe('AgentOutputService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stopAgentOutputService()
    mockEmitOnly.mockClear()
    mockAppendAsync.mockClear()
    mockCapturePane.mockReset()
    mockListLiveAgentPanes.mockReset()
    mockListLiveAgentPanes.mockResolvedValue([])
    mockCaptureLiveAgentPaneText.mockReset()
    mockCaptureLiveAgentPaneText.mockResolvedValue(null)
  })

  afterEach(() => {
    stopAgentOutputService()
    vi.useRealTimers()
  })

  it('does no fleet discovery or pane capture with zero interest', async () => {
    await pollOnce(createState())

    expect(mockListLiveAgentPanes).not.toHaveBeenCalled()
    expect(mockCapturePane).not.toHaveBeenCalled()
    expect(mockEmitOnly).not.toHaveBeenCalled()
  })

  it('coalesces overlapping wildcard polls into one fleet discovery', async () => {
    let resolveAgents!: (panes: LiveAgentPane[]) => void
    mockListLiveAgentPanes.mockReturnValue(new Promise((resolve) => {
      resolveAgents = resolve
    }))
    const state = createState()
    state.allInterestCount = 1

    const first = pollOnce(state)
    const overlapping = pollOnce(state)
    expect(mockListLiveAgentPanes).toHaveBeenCalledOnce()

    resolveAgents([])
    await Promise.all([first, overlapping])
  })

  it('captures each explicitly interested agent once and emits only new lines', async () => {
    mockCapturePane
      .mockResolvedValueOnce('boot\nworking on PAN-TEST')
      .mockResolvedValueOnce('boot\nworking on PAN-TEST\nnew line')
    const state = createState(['agent-pan-test'])

    await pollOnce(state)
    await pollOnce(state)

    expect(mockCapturePane).toHaveBeenCalledTimes(2)
    expect(mockEmitOnly).toHaveBeenCalledTimes(2)
    expect(mockEmitOnly.mock.calls[0]![0]).toMatchObject({
      type: 'agent.output_received',
      payload: { agentId: 'agent-pan-test', lines: ['boot', 'working on PAN-TEST'] },
    })
    expect(mockEmitOnly.mock.calls[1]![0]).toMatchObject({
      payload: { agentId: 'agent-pan-test', lines: ['new line'] },
    })
    expect(mockAppendAsync).not.toHaveBeenCalled()
  })

  it('skips empty and missing-session output', async () => {
    mockCapturePane
      .mockResolvedValueOnce('Session not found')
      .mockResolvedValueOnce('')
    const state = createState(['agent-one', 'agent-two'])

    await pollOnce(state)

    expect(mockEmitOnly).not.toHaveBeenCalled()
  })

  it('starts with an immediate capture and stops after the final release', async () => {
    mockCapturePane.mockResolvedValue('same output')
    startAgentOutputService()

    const releaseFirst = retainAgentOutputInterest('agent-pan-test')
    await vi.advanceTimersByTimeAsync(0)
    expect(mockCapturePane).toHaveBeenCalledOnce()

    const releaseSecond = retainAgentOutputInterest('agent-pan-test')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(mockCapturePane).toHaveBeenCalledTimes(2)

    releaseFirst()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(mockCapturePane).toHaveBeenCalledTimes(3)

    releaseSecond()
    await vi.advanceTimersByTimeAsync(6_000)
    expect(mockCapturePane).toHaveBeenCalledTimes(3)
  })

  it('coalesces an immediate capture with an overlapping poll', async () => {
    let resolveCapture!: (value: string) => void
    mockCapturePane.mockImplementation(() => new Promise((resolve) => {
      resolveCapture = resolve
    }))
    startAgentOutputService()

    const release = retainAgentOutputInterest('agent-pan-test')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(mockCapturePane).toHaveBeenCalledOnce()

    resolveCapture('output')
    await vi.advanceTimersByTimeAsync(0)
    release()
  })

  it('does not emit a slow capture after its interest is released', async () => {
    let resolveCapture!: (value: string) => void
    mockCapturePane.mockImplementation(() => new Promise((resolve) => {
      resolveCapture = resolve
    }))
    startAgentOutputService()

    const release = retainAgentOutputInterest('agent-pan-test')
    await vi.advanceTimersByTimeAsync(0)
    release()
    resolveCapture('late output')
    await vi.advanceTimersByTimeAsync(0)

    expect(mockEmitOnly).not.toHaveBeenCalled()
  })

  it('preserves the public all-agent SSE output surface only while subscribed', async () => {
    mockListLiveAgentPanes.mockResolvedValue([herdrPane('agent-one')])
    mockCaptureLiveAgentPaneText.mockResolvedValue('output')
    startAgentOutputService()

    const release = retainAllAgentOutputInterest()
    await vi.advanceTimersByTimeAsync(0)
    expect(mockListLiveAgentPanes).toHaveBeenCalledOnce()
    expect(mockCaptureLiveAgentPaneText).toHaveBeenCalledWith(herdrPane('agent-one'), 50)
    expect(mockCapturePane).not.toHaveBeenCalled()

    release()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(mockListLiveAgentPanes).toHaveBeenCalledOnce()
  })

  it('#4109: discovers and captures a live Herdr agent through the backend inventory', async () => {
    mockListLiveAgentPanes.mockResolvedValue([herdrPane('agent-herdr')])
    mockCaptureLiveAgentPaneText.mockResolvedValue('herdr output')
    const state = createState()
    state.allInterestCount = 1

    await pollOnce(state)

    expect(mockCaptureLiveAgentPaneText).toHaveBeenCalledWith(herdrPane('agent-herdr'), 50)
    expect(mockEmitOnly.mock.calls[0]![0]).toMatchObject({
      payload: { agentId: 'agent-herdr', lines: ['herdr output'] },
    })
  })

  it('#4109: an unreadable inventory discovers nothing but explicit subscriptions still capture', async () => {
    mockListLiveAgentPanes.mockResolvedValue(null)
    mockCapturePane.mockResolvedValue('explicit output')
    const state = createState(['agent-explicit'])
    state.allInterestCount = 1

    await pollOnce(state)

    expect(mockCapturePane).toHaveBeenCalledTimes(1)
    expect(mockCapturePane).toHaveBeenCalledWith('agent-explicit', 50)
  })
})
