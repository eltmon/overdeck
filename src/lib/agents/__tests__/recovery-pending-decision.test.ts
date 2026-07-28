import { describe, expect, it, vi } from 'vitest'

import { restartAgent } from '../recovery.js'

const agentState = {
  id: 'agent-pan-3228',
  issueId: 'PAN-3228',
  workspace: '/definitely/missing/pan-3228',
  model: 'claude-sonnet-5',
  role: 'work',
  status: 'running',
  startedAt: '2026-07-28T00:00:00.000Z',
} as const

describe('restartAgent pending operator decision gate', () => {
  it('returns a typed refusal before destructive restart work', async () => {
    const detectPendingOperatorDecision = vi.fn(async () => ({
      source: 'pane' as const,
      reason: 'tool_permission' as const,
      prompt: 'Allow this command?',
    }))
    const logAgentLifecycleSync = vi.fn()

    const result = await restartAgent('agent-pan-3228', { graceful: false }, {
      detectPendingOperatorDecision,
      getAgentStateSync: vi.fn(() => agentState as any),
      logAgentLifecycleSync,
    })

    expect(result).toMatchObject({
      success: false,
      code: 'pending-operator-decision',
      error: expect.stringContaining("pan answer PAN-3228"),
      pendingDecision: {
        source: 'pane',
        reason: 'tool_permission',
      },
    })
    expect(logAgentLifecycleSync).toHaveBeenCalledWith(
      'agent-pan-3228',
      expect.stringContaining('restartAgent BLOCKED'),
    )
  })

  it('continues past the pending-decision gate when no decision is detected', async () => {
    const result = await restartAgent('agent-pan-3228', { graceful: false }, {
      detectPendingOperatorDecision: vi.fn(async () => null),
      getAgentStateSync: vi.fn(() => agentState as any),
      logAgentLifecycleSync: vi.fn(),
    })

    expect(result).toEqual({
      success: false,
      error: 'Agent workspace missing: /definitely/missing/pan-3228',
    })
  })

  it('allows force to bypass a pending decision deliberately', async () => {
    const detectPendingOperatorDecision = vi.fn(async () => ({
      source: 'pane' as const,
      reason: 'tool_permission' as const,
    }))

    const result = await restartAgent('agent-pan-3228', { graceful: false, force: true }, {
      detectPendingOperatorDecision,
      getAgentStateSync: vi.fn(() => agentState as any),
      logAgentLifecycleSync: vi.fn(),
    })

    expect(detectPendingOperatorDecision).not.toHaveBeenCalled()
    expect(result.error).toContain('workspace missing')
    expect(result.code).toBeUndefined()
  })
})
