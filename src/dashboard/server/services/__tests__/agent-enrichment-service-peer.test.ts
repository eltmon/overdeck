/**
 * PAN-3931: a peer dashboard (OVERDECK_DISABLE_DEACON=1) shares the primary's
 * event log, and the primary runs the same enrichment poller. The peer must fan
 * its events out in memory only (emitOnly), and append and announce nothing.
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
vi.mock('../backend-inventory.js', () => ({ getBackendPanes: mocks.getBackendPanes }))
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

// The service keeps a per-process set of agents it has announced, so each case
// uses its own agent id.
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

const BLOCKED = {
  role: 'work',
  hasPendingQuestion: true,
  pendingQuestionCount: 1,
  pendingInputCount: 1,
  pendingInputKinds: ['askUserQuestion'],
  resolution: 'working',
  resolutionCount: 0,
}

async function runTwoTicks(agentId: string): Promise<void> {
  const agent = makeAgent(agentId)
  mocks.listRunningAgents.mockImplementation(() => Effect.succeed([agent]))
  mocks.getBackendPanes.mockResolvedValue([{ id: agentId, terminalId: agentId, state: 'running', role: 'work', issue: 'PAN-1' }])
  const { startAgentEnrichmentService, stopAgentEnrichmentService } = await import('../agent-enrichment-service.js')
  startAgentEnrichmentService()
  // Tick 1: the agent is live and blocked on input.
  await vi.advanceTimersByTimeAsync(10_000)
  // Tick 2: its pane is gone, so the pending input is reaped.
  mocks.getBackendPanes.mockResolvedValue([])
  await vi.advanceTimersByTimeAsync(10_000)
  stopAgentEnrichmentService()
}

function typesOf(calls: unknown[][]): string[] {
  return calls.map(([event]) => (event as { type: string }).type)
}

describe('agent enrichment service — peer vs primary dashboard (PAN-3931)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.getRuntimeCensus.mockResolvedValue({ tmuxAvailable: true })
    mocks.getAgentJsonlMtime.mockResolvedValue(null)
    mocks.computeAgentEnrichment.mockResolvedValue(BLOCKED)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('peer: emits enrichment events in memory only and appends or announces nothing', async () => {
    vi.stubEnv('OVERDECK_DISABLE_DEACON', '1')
    await runTwoTicks('agent-pan-peer')

    expect(typesOf(mocks.store.emitOnly.mock.calls)).toEqual([
      'agent.created',
      'agent.enrichment_changed',
      'agent.enrichment_changed',
    ])
    expect(mocks.saveAgentStateAndEmitEvent).not.toHaveBeenCalled()
    expect(mocks.store.append).not.toHaveBeenCalled()
    expect(mocks.store.appendAsync).not.toHaveBeenCalled()
    expect(mocks.emitActivityEntry).not.toHaveBeenCalled()
    expect(mocks.emitActivityTts).not.toHaveBeenCalled()
  })

  it('primary: appends enrichment events durably and announces the blocked agent', async () => {
    vi.stubEnv('OVERDECK_DISABLE_DEACON', '')
    await runTwoTicks('agent-pan-primary')

    expect(mocks.saveAgentStateAndEmitEvent).toHaveBeenCalledOnce()
    expect(typesOf(mocks.store.appendAsync.mock.calls as unknown[][])).toEqual([
      'agent.enrichment_changed',
      'agent.enrichment_changed',
    ])
    expect(mocks.store.emitOnly).not.toHaveBeenCalled()
    expect(mocks.emitActivityTts).toHaveBeenCalledOnce()
    // Awaiting-input on tick 1, expired question on tick 2.
    expect(mocks.emitActivityEntry).toHaveBeenCalledTimes(2)
  })
})
