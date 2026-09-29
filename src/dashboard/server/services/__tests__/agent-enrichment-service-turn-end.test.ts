/**
 * PAN-4371 — the enrichment poll peeks a turn-end assessment synchronously and
 * schedules the async Jev run fire-and-forget: it must never await the read or
 * the Jev call, and the schedule call must fire only for a bare agentTurnEnded.
 */
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listRunningAgents: vi.fn(),
  computeAgentEnrichment: vi.fn(),
  getAgentJsonlMtime: vi.fn(),
  getBackendPanes: vi.fn(),
  getRuntimeCensus: vi.fn(),
  saveAgentStateAndEmitEvent: vi.fn(),
  emitActivityEntry: vi.fn(),
  emitActivityTts: vi.fn(),
  peekTurnEndAssessment: vi.fn(),
  scheduleTurnEndAssessment: vi.fn(),
  clearTurnEndAssessment: vi.fn(),
  store: {
    append: vi.fn(() => 1),
    appendAsync: vi.fn(async () => 1),
    emitOnly: vi.fn(),
  },
}))

vi.mock('../../../../lib/agents.js', () => ({ listRunningAgents: mocks.listRunningAgents }))
vi.mock('../../../../lib/agent-enrichment.js', () => ({
  computeAgentEnrichment: mocks.computeAgentEnrichment,
  getAgentJsonlMtime: mocks.getAgentJsonlMtime,
}))
vi.mock('../backend-inventory.js', () => ({ getBackendPanes: mocks.getBackendPanes, isBackendInventoryDegraded: () => false }))
vi.mock('../../../../lib/terminal-backends/select.js', () => ({ hostTerminalBackendName: async () => 'tmux' }))
vi.mock('../../../../lib/runtime-census.js', () => ({ getRuntimeCensus: mocks.getRuntimeCensus }))
vi.mock('../../event-store.js', () => ({ getEventStore: () => mocks.store }))
vi.mock('../agent-projection.js', () => ({ saveAgentStateAndEmitEvent: mocks.saveAgentStateAndEmitEvent }))
vi.mock('../../../../lib/activity-logger.js', () => ({
  emitActivityEntry: mocks.emitActivityEntry,
  emitActivityTts: mocks.emitActivityTts,
}))
vi.mock('../../read-model.js', () => ({
  toAgentStatus: (status: string) => status,
  toRole: (role: string | undefined) => role,
  toAgentResolution: () => undefined,
}))
vi.mock('../../../../lib/jev/turn-end-store.js', () => ({
  peekTurnEndAssessment: mocks.peekTurnEndAssessment,
  scheduleTurnEndAssessment: mocks.scheduleTurnEndAssessment,
  clearTurnEndAssessment: mocks.clearTurnEndAssessment,
}))

function makeAgent(id: string) {
  return {
    id,
    issueId: 'PAN-1',
    role: 'work',
    status: 'running',
    startedAt: '2026-09-24T00:00:00.000Z',
    workspace: '/tmp/ws',
    tmuxActive: true,
  }
}

const TURN_ENDED = {
  role: 'work',
  hasPendingQuestion: true,
  pendingQuestionCount: 1,
  pendingInputCount: 1,
  pendingInputKinds: ['agentTurnEnded'],
  resolution: 'needs_input',
  resolutionCount: 0,
}

const BLOCKED_NOT_TURN_ENDED = {
  role: 'work',
  hasPendingQuestion: true,
  pendingQuestionCount: 1,
  pendingInputCount: 1,
  pendingInputKinds: ['askUserQuestion'],
  resolution: 'needs_input',
  resolutionCount: 0,
}

function typesOf(calls: unknown[][]): string[] {
  return calls.map(([event]) => (event as { type: string }).type)
}

async function runOneTick(agentId: string): Promise<void> {
  const agent = makeAgent(agentId)
  mocks.listRunningAgents.mockImplementation(() => Effect.succeed([agent]))
  mocks.getBackendPanes.mockResolvedValue([{ id: agentId, terminalId: agentId, state: 'running', role: 'work', issue: 'PAN-1' }])
  const { startAgentEnrichmentService, stopAgentEnrichmentService } = await import('../agent-enrichment-service.js')
  startAgentEnrichmentService()
  await vi.advanceTimersByTimeAsync(10_000)
  stopAgentEnrichmentService()
}

describe('agent enrichment service — turn-end scheduling (PAN-4371)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubEnv('OVERDECK_DISABLE_DEACON', '')
    mocks.getRuntimeCensus.mockResolvedValue({ tmuxAvailable: true })
    mocks.getAgentJsonlMtime.mockResolvedValue(123)
    mocks.peekTurnEndAssessment.mockReturnValue(undefined)
    // Fire-and-forget: the real store starts an async run and returns void
    // synchronously without the poll ever awaiting it.
    mocks.scheduleTurnEndAssessment.mockImplementation(() => {
      void new Promise(() => {})
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('ac1: schedules the assessment and still appends the enrichment event on the same tick', async () => {
    mocks.computeAgentEnrichment.mockResolvedValue(TURN_ENDED)

    await runOneTick('agent-pan-turnend-1')

    expect(mocks.scheduleTurnEndAssessment).toHaveBeenCalledWith({
      agentId: 'agent-pan-turnend-1',
      role: 'work',
      transcriptMtime: 123,
    })
    expect(mocks.saveAgentStateAndEmitEvent).toHaveBeenCalledOnce()
    expect(typesOf(mocks.store.appendAsync.mock.calls as unknown[][])).toEqual(['agent.enrichment_changed'])
  })

  it('ac2: echoes the peeked assessment into the appended payload when present', async () => {
    const assessment = { kind: 'asks_operator', confidence: 0.9, needsAnswer: true, model: 'm' }
    mocks.peekTurnEndAssessment.mockReturnValue(assessment)
    mocks.computeAgentEnrichment.mockResolvedValue({ ...TURN_ENDED, turnEndAssessment: assessment })

    await runOneTick('agent-pan-turnend-2')

    const enrichmentCall = mocks.store.appendAsync.mock.calls.find(
      ([event]) => (event as { type: string }).type === 'agent.enrichment_changed',
    )
    expect(enrichmentCall?.[0]).toMatchObject({ payload: { turnEndAssessment: assessment } })
  })

  it('ac2: the appended payload has no turnEndAssessment key when peek returns undefined', async () => {
    mocks.peekTurnEndAssessment.mockReturnValue(undefined)
    mocks.computeAgentEnrichment.mockResolvedValue(TURN_ENDED)

    await runOneTick('agent-pan-turnend-3')

    const enrichmentCall = mocks.store.appendAsync.mock.calls.find(
      ([event]) => (event as { type: string }).type === 'agent.enrichment_changed',
    )
    expect((enrichmentCall?.[0] as { payload: object }).payload).not.toHaveProperty('turnEndAssessment')
  })

  it('ac3: does not schedule when pendingInputKinds omits agentTurnEnded', async () => {
    mocks.computeAgentEnrichment.mockResolvedValue(BLOCKED_NOT_TURN_ENDED)

    await runOneTick('agent-pan-turnend-4')

    expect(mocks.scheduleTurnEndAssessment).not.toHaveBeenCalled()
  })
})
