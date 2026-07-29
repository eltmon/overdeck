import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GRACEFUL_RESTART_GRACE_MS } from '../../graceful-restart.js'
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

describe('restartAgent graceful pending-decision rechecks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('leaves the session running when a permission decision appears during the grace period', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pan-restart-gate-'))
    const pendingDecision = {
      source: 'pane' as const,
      reason: 'tool_permission' as const,
      prompt: 'Allow this command?',
    }
    const detectPendingOperatorDecision = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(pendingDecision)
    const sendGracefulRestartWarning = vi.fn(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, GRACEFUL_RESTART_GRACE_MS))
    })
    const stopAgent = vi.fn(async () => undefined)

    try {
      const resultPromise = restartAgent('agent-pan-3228', { graceful: true }, {
        detectPendingOperatorDecision,
        getAgentStateSync: vi.fn(() => ({ ...agentState, workspace }) as any),
        logAgentLifecycleSync: vi.fn(),
        assertWorkspaceStackHealthyForSpawn: vi.fn(async () => undefined),
        resolveHarness: vi.fn(async () => 'claude-code'),
        prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/usr/bin/claude' })) as any,
        sessionExists: vi.fn(async () => true),
        sendGracefulRestartWarning,
        stopAgent,
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(sendGracefulRestartWarning).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(GRACEFUL_RESTART_GRACE_MS)

      await expect(resultPromise).resolves.toMatchObject({
        success: false,
        code: 'pending-operator-decision',
        pendingDecision,
      })
      expect(detectPendingOperatorDecision).toHaveBeenCalledTimes(3)
      expect(stopAgent).not.toHaveBeenCalled()
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
