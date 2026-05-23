/**
 * Tests for the agent output service (PAN-1221 F3)
 *
 * Verifies that diffLines correctly computes new pane output and that the
 * service emits agent.output_received events when running agents produce
 * new lines.
 */

import { Effect } from 'effect'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockAppendAsync = vi.hoisted(() => vi.fn((_event: unknown) => Promise.resolve(1)))
const mockEventStore = { appendAsync: mockAppendAsync }

vi.mock('../../event-store.js', () => ({
  getEventStore: () => mockEventStore,
}))

vi.mock('../../../../lib/tmux.js', () => ({
  capturePane: vi.fn(),
}))

vi.mock('../../../../lib/agents.js', () => ({
  listRunningAgents: vi.fn(),
  listRunningAgentsSync: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(() => Promise.reject(new Error('no remote state'))),
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  diffLines,
  splitLines,
  pollOnce,
  startAgentOutputService,
  stopAgentOutputService,
} from '../agent-output-service.js'
import { capturePane } from '../../../../lib/tmux.js'
import { listRunningAgents, type AgentState } from '../../../../lib/agents.js'

type RunningAgent = AgentState & { tmuxActive: boolean }

const mockCapturePane = vi.mocked(capturePane)
const mockListRunningAgents = vi.mocked(listRunningAgents)

// ─── diffLines tests ───────────────────────────────────────────────────────────

describe('diffLines', () => {
  it('returns all current lines when previous is empty', () => {
    expect(diffLines([], ['line1', 'line2'])).toEqual(['line1', 'line2'])
  })

  it('returns empty when current equals previous', () => {
    expect(diffLines(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('finds new lines appended to the end', () => {
    const previous = ['boot', 'working']
    const current = ['boot', 'working', 'on', 'PAN-1']
    expect(diffLines(previous, current)).toEqual(['on', 'PAN-1'])
  })

  it('handles scrolled panes where some old lines dropped off', () => {
    const previous = ['old1', 'old2', 'old3', 'shared1', 'shared2']
    const current = ['shared1', 'shared2', 'new1', 'new2']
    expect(diffLines(previous, current)).toEqual(['new1', 'new2'])
  })

  it('returns all current lines when there is no overlap', () => {
    const previous = ['old1', 'old2']
    const current = ['new1', 'new2']
    expect(diffLines(previous, current)).toEqual(['new1', 'new2'])
  })

  it('handles single-line overlap', () => {
    const previous = ['a', 'b', 'c']
    const current = ['c', 'd']
    expect(diffLines(previous, current)).toEqual(['d'])
  })
})

// ─── Service integration tests ─────────────────────────────────────────────────

describe('AgentOutputService', () => {
  beforeEach(() => {
    stopAgentOutputService()
    mockAppendAsync.mockClear()
    mockCapturePane.mockClear()
    mockListRunningAgents.mockClear()
  })

  afterEach(() => {
    stopAgentOutputService()
  })

  it('emits agent.output_received when a running agent produces new lines', async () => {
    mockListRunningAgents.mockReturnValue(Effect.succeed([
      { id: 'agent-pan-test', issueId: 'PAN-TEST', tmuxActive: true } as unknown as RunningAgent,
    ]))
    mockCapturePane
      .mockReturnValueOnce(Effect.succeed('boot\nworking on PAN-TEST'))
      .mockReturnValueOnce(Effect.succeed('boot\nworking on PAN-TEST\nnew line'))

    const state = { timer: null, lastOutput: new Map<string, string>() }

    // First poll
    await pollOnce(state)
    expect(mockAppendAsync).toHaveBeenCalledTimes(1)
    const firstCall = mockAppendAsync.mock.calls[0]![0] as {
      type: string
      payload: { agentId: string; lines: string[] }
    }
    expect(firstCall.type).toBe('agent.output_received')
    expect(firstCall.payload.agentId).toBe('agent-pan-test')
    expect(firstCall.payload.lines).toEqual(['boot', 'working on PAN-TEST'])

    // Second poll — new line
    await pollOnce(state)
    expect(mockAppendAsync).toHaveBeenCalledTimes(2)
    const secondCall = mockAppendAsync.mock.calls[1]![0] as {
      type: string
      payload: { agentId: string; lines: string[] }
    }
    expect(secondCall.type).toBe('agent.output_received')
    expect(secondCall.payload.lines).toEqual(['new line'])
  })

  it('does not emit when output is unchanged', async () => {
    mockListRunningAgents.mockReturnValue(Effect.succeed([
      { id: 'agent-pan-test', issueId: 'PAN-TEST', tmuxActive: true } as unknown as RunningAgent,
    ]))
    mockCapturePane.mockReturnValue(Effect.succeed('same output'))

    const state = { timer: null, lastOutput: new Map<string, string>() }

    await pollOnce(state)
    expect(mockAppendAsync).toHaveBeenCalledTimes(1)

    mockAppendAsync.mockClear()
    await pollOnce(state)
    expect(mockAppendAsync).not.toHaveBeenCalled()
  })

  it('does not emit for agents without tmuxActive', async () => {
    mockListRunningAgents.mockReturnValue(Effect.succeed([
      { id: 'agent-pan-test', issueId: 'PAN-TEST', tmuxActive: false } as unknown as RunningAgent,
    ]))
    mockCapturePane.mockReturnValue(Effect.succeed('some output'))

    const state = { timer: null, lastOutput: new Map<string, string>() }

    await pollOnce(state)
    expect(mockAppendAsync).not.toHaveBeenCalled()
  })

  it('cleans up state for stopped agents', async () => {
    mockListRunningAgents
      .mockReturnValueOnce(Effect.succeed([
        { id: 'agent-pan-test', issueId: 'PAN-TEST', tmuxActive: true } as unknown as RunningAgent,
      ]))
      .mockReturnValueOnce(Effect.succeed([]))

    mockCapturePane.mockReturnValue(Effect.succeed('output'))

    const state = { timer: null, lastOutput: new Map<string, string>() }

    await pollOnce(state)
    expect(mockAppendAsync).toHaveBeenCalledTimes(1)
    expect(state.lastOutput.has('agent-pan-test')).toBe(true)

    mockAppendAsync.mockClear()
    await pollOnce(state)
    // Agent stopped, state cleaned up
    expect(state.lastOutput.has('agent-pan-test')).toBe(false)
    expect(mockCapturePane).toHaveBeenCalledTimes(1)
    expect(mockAppendAsync).not.toHaveBeenCalled()
  })

  it('skips Session not found output', async () => {
    mockListRunningAgents.mockReturnValue(Effect.succeed([
      { id: 'agent-pan-test', issueId: 'PAN-TEST', tmuxActive: true } as unknown as RunningAgent,
    ]))
    mockCapturePane.mockReturnValue(Effect.succeed('Session not found'))

    const state = { timer: null, lastOutput: new Map<string, string>() }

    await pollOnce(state)
    expect(mockAppendAsync).not.toHaveBeenCalled()
  })
})
