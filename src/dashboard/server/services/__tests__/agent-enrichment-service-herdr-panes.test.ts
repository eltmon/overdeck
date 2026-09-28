/**
 * PAN-4320: on Herdr, `BackendPane.id`/`terminalId` are backend handles, never
 * agent ids, so the poller must join panes to agents by agent key. A stored
 * `status: 'stopped'` is operator/supervisor intent the poller never
 * overrides, even when the agent's Herdr pane (and idle harness) outlives
 * the stop.
 */
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listRunningAgents: vi.fn(),
  computeAgentEnrichment: vi.fn(),
  getAgentJsonlMtime: vi.fn(),
  getBackendPanes: vi.fn(),
  isBackendInventoryDegraded: vi.fn(),
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
vi.mock('../backend-inventory.js', () => ({
  getBackendPanes: mocks.getBackendPanes,
  isBackendInventoryDegraded: mocks.isBackendInventoryDegraded,
}))
vi.mock('../../../../lib/terminal-backends/select.js', () => ({ hostTerminalBackendName: async () => 'herdr' }))
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

function makeAgent(id: string, status: 'running' | 'stopped') {
  return {
    id,
    issueId: 'PAN-4320',
    role: 'work',
    status,
    startedAt: '2026-09-28T00:00:00.000Z',
    workspace: '/tmp/ws',
    tmuxActive: true,
  }
}

/** A Herdr-shaped pane: `id`/`terminalId` are backend handles, never the agent id. */
function herdrPane(agentId: string, index: number, state: 'working' | 'exited') {
  return {
    id: `wKZ:p${index}`,
    terminalId: `term_${index}`,
    agentId,
    issue: 'PAN-4320',
    role: 'work',
    state,
    harness: 'claude-code',
    model: 'unknown',
  }
}

const NEUTRAL_ENRICHMENT = {
  role: 'work',
  hasPendingQuestion: false,
  pendingQuestionCount: 0,
  pendingInputCount: 0,
  pendingInputKinds: [],
  resolution: 'working',
  resolutionCount: 0,
}

async function runOneTick(): Promise<void> {
  const { startAgentEnrichmentService, stopAgentEnrichmentService } = await import('../agent-enrichment-service.js')
  startAgentEnrichmentService()
  await vi.advanceTimersByTimeAsync(10_000)
  stopAgentEnrichmentService()
}

function createdAgentIds(): string[] {
  return mocks.saveAgentStateAndEmitEvent.mock.calls
    .map(([, event]) => event as { type: string; payload: { agentId: string } })
    .filter((event) => event.type === 'agent.created')
    .map((event) => event.payload.agentId)
}

describe('agent enrichment service — Herdr pane join by agent key (PAN-4320)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubEnv('OVERDECK_DISABLE_DEACON', '')
    // On Herdr the gate follows isBackendInventoryDegraded, not the tmux
    // census — a Herdr host may run no tmux server at all (PAN-4320).
    mocks.getRuntimeCensus.mockResolvedValue({ tmuxAvailable: false })
    mocks.isBackendInventoryDegraded.mockReturnValue(false)
    mocks.getAgentJsonlMtime.mockResolvedValue(null)
    mocks.computeAgentEnrichment.mockResolvedValue(NEUTRAL_ENRICHMENT)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('emits agent.created for a Herdr-shaped live pane whose stored status is running', async () => {
    mocks.listRunningAgents.mockImplementation(() => Effect.succeed([makeAgent('agent-pan-herdr-live', 'running')]))
    mocks.getBackendPanes.mockResolvedValue([herdrPane('agent-pan-herdr-live', 1, 'working')])

    await runOneTick()

    expect(createdAgentIds()).toEqual(['agent-pan-herdr-live'])
  })

  // PAN-4320 (FR-7): on Herdr, no tmux server ever runs, so tmuxAvailable is
  // always false. The gate must not skip on that account — only a degraded
  // Herdr inventory does.
  it('does not skip the enrichment cycle on Herdr even with no tmux census evidence', async () => {
    mocks.getRuntimeCensus.mockResolvedValue({ tmuxAvailable: false })
    mocks.isBackendInventoryDegraded.mockReturnValue(false)
    mocks.listRunningAgents.mockImplementation(() => Effect.succeed([makeAgent('agent-pan-herdr-no-tmux', 'running')]))
    mocks.getBackendPanes.mockResolvedValue([herdrPane('agent-pan-herdr-no-tmux', 4, 'working')])

    await runOneTick()

    expect(createdAgentIds()).toEqual(['agent-pan-herdr-no-tmux'])
  })

  it('emits no agent.created for a Herdr-shaped exited pane, even with stored status running', async () => {
    // Herdr work agents run without the PTY supervisor, so when the harness
    // exits nothing rewrites state.json — it can still say 'running' with
    // only the exited pane as evidence the agent is gone.
    mocks.listRunningAgents.mockImplementation(() => Effect.succeed([makeAgent('agent-pan-herdr-dead', 'running')]))
    mocks.getBackendPanes.mockResolvedValue([herdrPane('agent-pan-herdr-dead', 2, 'exited')])

    await runOneTick()

    expect(createdAgentIds()).not.toContain('agent-pan-herdr-dead')
    expect(mocks.saveAgentStateAndEmitEvent).not.toHaveBeenCalled()
  })

  it('emits neither agent.created nor agent.enrichment_changed for a killed agent whose Herdr pane is still live', async () => {
    mocks.listRunningAgents.mockImplementation(() => Effect.succeed([makeAgent('agent-pan-herdr-killed', 'stopped')]))
    mocks.getBackendPanes.mockResolvedValue([herdrPane('agent-pan-herdr-killed', 3, 'working')])

    await runOneTick()

    expect(createdAgentIds()).not.toContain('agent-pan-herdr-killed')
    expect(mocks.saveAgentStateAndEmitEvent).not.toHaveBeenCalled()
    expect(mocks.store.appendAsync).not.toHaveBeenCalled()
  })
})
