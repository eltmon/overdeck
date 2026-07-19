import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockEmitOnly = vi.hoisted(() => vi.fn((_event: unknown) => undefined))
const mockAppendAsync = vi.hoisted(() => vi.fn((_event: unknown) => Promise.resolve(1)))
const mockEventStore = { emitOnly: mockEmitOnly, appendAsync: mockAppendAsync }

vi.mock('../../event-store.js', () => ({ getEventStore: () => mockEventStore }))
vi.mock('../../../../lib/tmux.js', () => ({ capturePane: vi.fn() }))
vi.mock('../../../../lib/agents.js', () => ({ listRunningAgents: vi.fn() }))
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
import { listRunningAgents } from '../../../../lib/agents.js'

const mockCapturePane = vi.mocked(capturePane)
const mockListRunningAgents = vi.mocked(listRunningAgents)

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
    mockListRunningAgents.mockReset()
    mockListRunningAgents.mockReturnValue(Effect.succeed([]))
  })

  afterEach(() => {
    stopAgentOutputService()
    vi.useRealTimers()
  })

  it('does no fleet discovery or pane capture with zero interest', async () => {
    await pollOnce(createState())

    expect(mockListRunningAgents).not.toHaveBeenCalled()
    expect(mockCapturePane).not.toHaveBeenCalled()
    expect(mockEmitOnly).not.toHaveBeenCalled()
  })

  it('coalesces overlapping wildcard polls into one fleet discovery', async () => {
    let resolveAgents!: (agents: never[]) => void
    mockListRunningAgents.mockReturnValue(Effect.promise(() => new Promise((resolve) => {
      resolveAgents = resolve
    })))
    const state = createState()
    state.allInterestCount = 1

    const first = pollOnce(state)
    const overlapping = pollOnce(state)
    expect(mockListRunningAgents).toHaveBeenCalledOnce()

    resolveAgents([])
    await Promise.all([first, overlapping])
  })

  it('captures each explicitly interested agent once and emits only new lines', async () => {
    mockCapturePane
      .mockReturnValueOnce(Effect.succeed('boot\nworking on PAN-TEST'))
      .mockReturnValueOnce(Effect.succeed('boot\nworking on PAN-TEST\nnew line'))
    const state = createState(['agent-pan-test'])

    await pollOnce(state)
    await pollOnce(state)

    expect(mockListRunningAgents).not.toHaveBeenCalled()
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
      .mockReturnValueOnce(Effect.succeed('Session not found'))
      .mockReturnValueOnce(Effect.succeed(''))
    const state = createState(['agent-one', 'agent-two'])

    await pollOnce(state)

    expect(mockEmitOnly).not.toHaveBeenCalled()
  })

  it('starts with an immediate capture and stops after the final release', async () => {
    mockCapturePane.mockReturnValue(Effect.succeed('same output'))
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
    mockCapturePane.mockReturnValue(Effect.promise(() => new Promise((resolve) => {
      resolveCapture = resolve
    })))
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
    mockCapturePane.mockReturnValue(Effect.promise(() => new Promise((resolve) => {
      resolveCapture = resolve
    })))
    startAgentOutputService()

    const release = retainAgentOutputInterest('agent-pan-test')
    await vi.advanceTimersByTimeAsync(0)
    release()
    resolveCapture('late output')
    await vi.advanceTimersByTimeAsync(0)

    expect(mockEmitOnly).not.toHaveBeenCalled()
  })

  it('preserves the public all-agent SSE output surface only while subscribed', async () => {
    mockListRunningAgents.mockReturnValue(Effect.succeed([
      { id: 'agent-one', tmuxActive: true },
      { id: 'agent-stopped', tmuxActive: false },
    ] as never))
    mockCapturePane.mockReturnValue(Effect.succeed('output'))
    startAgentOutputService()

    const release = retainAllAgentOutputInterest()
    await vi.advanceTimersByTimeAsync(0)
    expect(mockListRunningAgents).toHaveBeenCalledOnce()
    expect(mockCapturePane).toHaveBeenCalledWith('agent-one', 50)
    expect(mockCapturePane).not.toHaveBeenCalledWith('agent-stopped', 50)

    release()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(mockListRunningAgents).toHaveBeenCalledOnce()
  })
})
