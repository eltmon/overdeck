import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GRACEFUL_RESTART_GRACE_MS } from '../../../../lib/graceful-restart.js'
import { restartAgent as restartAgentCore } from '../../../../lib/agents/recovery.js'
import { EventStoreService } from '../../services/domain-services.js'

const mocks = vi.hoisted(() => ({
  appendAgentLifecycleLog: vi.fn(),
  detectPendingOperatorDecision: vi.fn(),
  getAgentState: vi.fn(),
  invalidateAgentsCache: vi.fn(),
  restartAgent: vi.fn(),
  saveAgentStateAndEmitEventProgram: vi.fn(),
}))

vi.mock('../../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/agents.js')>()
  return {
    ...actual,
    getAgentState: mocks.getAgentState,
    restartAgent: mocks.restartAgent,
  }
})

vi.mock('../../../../lib/agents/pending-decision-gate.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/agents/pending-decision-gate.js')>()
  return {
    ...actual,
    detectPendingOperatorDecision: mocks.detectPendingOperatorDecision,
  }
})

vi.mock('../../services/agent-projection.js', () => ({
  saveAgentStateAndEmitEventProgram: mocks.saveAgentStateAndEmitEventProgram,
}))

vi.mock('../agents/shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agents/shared.js')>()
  return {
    ...actual,
    appendAgentLifecycleLog: mocks.appendAgentLifecycleLog,
    invalidateAgentsCache: mocks.invalidateAgentsCache,
  }
})

import { postAgentRestartRoute } from '../agents/lifecycle-restart.js'

const agentState = {
  id: 'agent-pan-3228',
  issueId: 'PAN-3228',
  workspace: '/tmp/pan-3228',
  model: 'claude-sonnet-5',
  role: 'work',
  status: 'running',
  startedAt: '2026-07-28T00:00:00.000Z',
} as const

async function postGracefulRestart() {
  const request = HttpServerRequest.fromWeb(new Request(
    'http://localhost/api/agents/agent-pan-3228/restart',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graceful: true }),
    },
  ))
  const eventStore = {
    appendAsync: () => Effect.succeed(1),
  }

  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(postAgentRestartRoute), (app) =>
        Effect.provideService(
          Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
          EventStoreService,
          eventStore as any,
        ),
      ),
    ),
  )
}

describe('POST /api/agents/:id/restart graceful projection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.detectPendingOperatorDecision.mockResolvedValue(null)
    mocks.getAgentState.mockReturnValue(Effect.succeed(agentState as any))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('restores the running projection when a decision appears during the grace window', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pan-restart-route-'))
    const projectedEvents: Array<{ type: string; payload?: Record<string, unknown> }> = []
    const stopAgent = vi.fn(async () => undefined)
    const detectLateDecision = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        source: 'pane' as const,
        reason: 'tool_permission' as const,
        prompt: 'Allow this command?',
      })
    let completeBackgroundRestart!: () => void
    const backgroundRestartCompleted = new Promise<void>((resolve) => {
      completeBackgroundRestart = resolve
    })

    mocks.saveAgentStateAndEmitEventProgram.mockImplementation((_state, event) =>
      Effect.sync(() => {
        projectedEvents.push(event)
      }),
    )
    mocks.restartAgent.mockImplementation((id, options) => restartAgentCore(id, options, {
      detectPendingOperatorDecision: detectLateDecision,
      getAgentStateSync: vi.fn(() => ({ ...agentState, workspace }) as any),
      logAgentLifecycleSync: vi.fn(),
      assertWorkspaceStackHealthyForSpawn: vi.fn(async () => undefined),
      resolveHarness: vi.fn(async () => 'claude-code'),
      prepareHarnessLaunch: vi.fn(async () => ({ binaryPath: '/usr/bin/claude' })) as any,
      sessionExists: vi.fn(async () => true),
      sendGracefulRestartWarning: vi.fn(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, GRACEFUL_RESTART_GRACE_MS))
      }),
      stopAgent,
    }))
    mocks.appendAgentLifecycleLog.mockImplementation(async (_id, event) => {
      if (event === 'agent.restart_completed') completeBackgroundRestart()
    })

    try {
      const response = await postGracefulRestart()
      expect(response.status).toBe(202)
      await vi.advanceTimersByTimeAsync(0)
      expect(projectedEvents.map((event) => event.type)).toEqual(['agent.stopped'])

      await vi.advanceTimersByTimeAsync(GRACEFUL_RESTART_GRACE_MS)
      await backgroundRestartCompleted

      expect(stopAgent).not.toHaveBeenCalled()
      expect(projectedEvents.map((event) => event.type)).toEqual([
        'agent.stopped',
        'agent.started',
      ])
      expect(projectedEvents.at(-1)).toMatchObject({
        type: 'agent.started',
        payload: {
          agent: { id: 'agent-pan-3228', status: 'running' },
        },
      })
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
