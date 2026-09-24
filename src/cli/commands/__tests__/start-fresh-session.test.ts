import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const agentMocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  stopAgent: vi.fn(),
  wipeAgentStateDirs: vi.fn(),
}))

const tmuxMocks = vi.hoisted(() => ({
  sessionExists: vi.fn(),
}))

// The host's terminal backend: a Herdr pane or a tmux session for the agent.
const backendMocks = vi.hoisted(() => ({
  agentPaneExists: vi.fn(),
}))

const lifecycleMocks = vi.hoisted(() => ({
  assertCanStartFreshSync: vi.fn(),
}))

vi.mock('../../../lib/agents.js', () => agentMocks)
vi.mock('../../../lib/tmux.js', () => tmuxMocks)
vi.mock('../../../lib/terminal-backends/launch.js', () => backendMocks)
vi.mock('../../../lib/work-agent-lifecycle.js', () => lifecycleMocks)

import { prepareFreshWorkAgentSession } from '../start-fresh-session.js'

describe('prepareFreshWorkAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    agentMocks.getAgentStateSync.mockReturnValue({ id: 'agent-pan-3228' })
    agentMocks.wipeAgentStateDirs.mockResolvedValue({
      removed: ['/tmp/agent-pan-3228'],
      path: '/tmp/agents',
    })
    agentMocks.stopAgent.mockReturnValue(Effect.void)
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(false))
    backendMocks.agentPaneExists.mockResolvedValue(false)
    lifecycleMocks.assertCanStartFreshSync.mockReturnValue({ canStartFresh: true })
  })

  it('refuses to replace a session with a pending operator decision', async () => {
    backendMocks.agentPaneExists.mockResolvedValue(true)
    const detectPendingOperatorDecision = vi.fn(async () => ({
      source: 'pane' as const,
      reason: 'tool_permission' as const,
      prompt: 'Allow this command?',
    }))

    const result = await prepareFreshWorkAgentSession(
      'PAN-3228',
      {},
      { detectPendingOperatorDecision },
    )

    expect(result).toMatchObject({
      ok: false,
      messages: [],
      error: expect.stringContaining("pan answer PAN-3228"),
    })
    expect(result.error).toContain('tool permission')
    expect(agentMocks.stopAgent).not.toHaveBeenCalled()
    expect(agentMocks.wipeAgentStateDirs).not.toHaveBeenCalled()
  })

  it('leaves the agent state directory intact when the fresh-start guard refuses', async () => {
    lifecycleMocks.assertCanStartFreshSync.mockImplementation(() => {
      throw new Error("Use 'pan reset-session PAN-3228' before starting a new session.")
    })

    const result = await prepareFreshWorkAgentSession('PAN-3228', { force: true })

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('pan reset-session PAN-3228'),
    })
    expect(lifecycleMocks.assertCanStartFreshSync).toHaveBeenCalledWith('PAN-3228', {
      allowPausedForce: false,
      allowLiveSessionReplacement: true,
      explicitFresh: true,
    })
    expect(agentMocks.stopAgent).not.toHaveBeenCalled()
    expect(agentMocks.wipeAgentStateDirs).not.toHaveBeenCalled()
  })

  it('allows force to deliberately discard the pending decision', async () => {
    backendMocks.agentPaneExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    const detectPendingOperatorDecision = vi.fn(async () => ({
      source: 'pane' as const,
      reason: 'tool_permission' as const,
      prompt: 'Allow this command?',
    }))

    const result = await prepareFreshWorkAgentSession(
      'PAN-3228',
      { force: true },
      { detectPendingOperatorDecision },
    )

    expect(result.ok).toBe(true)
    expect(detectPendingOperatorDecision).not.toHaveBeenCalled()
    expect(agentMocks.stopAgent).toHaveBeenCalledWith('agent-pan-3228')
    expect(agentMocks.wipeAgentStateDirs).toHaveBeenCalledWith('PAN-3228')
  })

  it('stops a live Herdr pane that has no tmux session (PAN-4012)', async () => {
    // Herdr host: the agent runs in a Herdr pane, so the tmux probe sees nothing.
    tmuxMocks.sessionExists.mockReturnValue(Effect.succeed(false))
    let paneLive = true
    backendMocks.agentPaneExists.mockImplementation(async () => paneLive)
    agentMocks.stopAgent.mockImplementation(() => Effect.sync(() => { paneLive = false }))

    const result = await prepareFreshWorkAgentSession('PAN-3228', { force: true })

    expect(result.ok).toBe(true)
    expect(agentMocks.stopAgent).toHaveBeenCalledWith('agent-pan-3228')
    expect(result.messages[0]).toContain('replacing the live session for agent-pan-3228')
    expect(agentMocks.wipeAgentStateDirs).toHaveBeenCalledWith('PAN-3228')
  })

  it('refuses when the Herdr pane survives the stop', async () => {
    backendMocks.agentPaneExists.mockResolvedValue(true)

    const result = await prepareFreshWorkAgentSession('PAN-3228', { force: true })

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('still has a live pane or session') })
    expect(agentMocks.stopAgent).toHaveBeenCalledWith('agent-pan-3228')
    expect(agentMocks.wipeAgentStateDirs).not.toHaveBeenCalled()
  })
})
