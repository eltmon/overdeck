/**
 * Tests for the agent output service (PAN-1221 F3)
 *
 * Verifies that diffLines correctly computes new pane output and that the
 * service emits agent.output_received events when running agents produce
 * new lines.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockAppendAsync = vi.hoisted(() => vi.fn(() => Promise.resolve(1)))
const mockEventStore = { appendAsync: mockAppendAsync }

vi.mock('../../event-store.js', () => ({
  getEventStore: () => mockEventStore,
}))

vi.mock('../../../../lib/tmux.js', () => ({
  capturePaneAsync: vi.fn(),
}))

vi.mock('../../../../lib/agents.js', () => ({
  listRunningAgentsAsync: vi.fn(),
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
import { capturePaneAsync } from '../../../../lib/tmux.js'
import { listRunningAgentsAsync } from '../../../../lib/agents.js'

const mockCapturePaneAsync = vi.mocked(capturePaneAsync)
const mockListRunningAgentsAsync = vi.mocked(listRunningAgentsAsync)

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
    mockCapturePaneAsync.mockClear()
    mockListRunningAgentsAsync.mockClear()
  })

  afterEach(() => {
    stopAgentOutputService()
  })

  it('emits agent.output_received when a running agent produces new lines', async () => {
    mockListRunningAgentsAsync.mockResolvedValue([
      { id: 'agent-pan-test', issueId: 'PAN-TEST', tmuxActive: true },
    ])
    mockCapturePaneAsync
      .mockResolvedValueOnce('boot\nworking on PAN-TEST')
      .mockResolvedValueOnce('boot\nworking on PAN-TEST\nnew line')

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
    mockListRunningAgentsAsync.mockResolvedValue([
      { id: 'agent-pan-test', issueId: 'PAN-TEST', tmuxActive: true },
    ])
    mockCapturePaneAsync.mockResolvedValue('same output')

    const state = { timer: null, lastOutput: new Map<string, string>() }

    await pollOnce(state)
    expect(mockAppendAsync).toHaveBeenCalledTimes(1)

    mockAppendAsync.mockClear()
    await pollOnce(state)
    expect(mockAppendAsync).not.toHaveBeenCalled()
  })

  it('does not emit for agents without tmuxActive', async () => {
    mockListRunningAgentsAsync.mockResolvedValue([
      { id: 'agent-pan-test', issueId: 'PAN-TEST', tmuxActive: false },
    ])
    mockCapturePaneAsync.mockResolvedValue('some output')

    const state = { timer: null, lastOutput: new Map<string, string>() }

    await pollOnce(state)
    expect(mockAppendAsync).not.toHaveBeenCalled()
  })

  it('cleans up state for stopped agents', async () => {
    mockListRunningAgentsAsync
      .mockResolvedValueOnce([
        { id: 'agent-pan-test', issueId: 'PAN-TEST', tmuxActive: true },
      ])
      .mockResolvedValueOnce([])

    mockCapturePaneAsync.mockResolvedValue('output')

    const state = { timer: null, lastOutput: new Map<string, string>() }

    await pollOnce(state)
    expect(mockAppendAsync).toHaveBeenCalledTimes(1)
    expect(state.lastOutput.has('agent-pan-test')).toBe(true)

    mockAppendAsync.mockClear()
    await pollOnce(state)
    // Agent stopped, state cleaned up
    expect(state.lastOutput.has('agent-pan-test')).toBe(false)
    expect(mockCapturePaneAsync).toHaveBeenCalledTimes(1)
    expect(mockAppendAsync).not.toHaveBeenCalled()
  })

  it('skips Session not found output', async () => {
    mockListRunningAgentsAsync.mockResolvedValue([
      { id: 'agent-pan-test', issueId: 'PAN-TEST', tmuxActive: true },
    ])
    mockCapturePaneAsync.mockResolvedValue('Session not found')

    const state = { timer: null, lastOutput: new Map<string, string>() }

    await pollOnce(state)
    expect(mockAppendAsync).not.toHaveBeenCalled()
  })
})
