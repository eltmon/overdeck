import { beforeEach, describe, expect, it, vi } from 'vitest'

const agentMocks = vi.hoisted(() => ({
  getAgentStateSync: vi.fn(),
  stopAgentSync: vi.fn(),
  wipeAgentStateDirs: vi.fn(),
}))

const tmuxMocks = vi.hoisted(() => ({
  sessionExistsSync: vi.fn(),
}))

vi.mock('../../../lib/agents.js', () => agentMocks)
vi.mock('../../../lib/tmux.js', () => tmuxMocks)

import { prepareFreshWorkAgentSession } from '../start-fresh-session.js'

describe('prepareFreshWorkAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    agentMocks.getAgentStateSync.mockReturnValue({ id: 'agent-pan-3228' })
    agentMocks.wipeAgentStateDirs.mockResolvedValue({
      removed: ['/tmp/agent-pan-3228'],
      path: '/tmp/agents',
    })
    tmuxMocks.sessionExistsSync.mockReturnValue(false)
  })

  it('refuses to replace a session with a pending operator decision', async () => {
    tmuxMocks.sessionExistsSync.mockReturnValue(true)
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
    expect(agentMocks.stopAgentSync).not.toHaveBeenCalled()
    expect(agentMocks.wipeAgentStateDirs).not.toHaveBeenCalled()
  })

  it('allows force to deliberately discard the pending decision', async () => {
    tmuxMocks.sessionExistsSync
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
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
    expect(agentMocks.stopAgentSync).toHaveBeenCalledWith('agent-pan-3228')
    expect(agentMocks.wipeAgentStateDirs).toHaveBeenCalledWith('PAN-3228')
  })
})
