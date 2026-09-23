import { Effect } from 'effect'
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EventStoreService } from '../../services/domain-services.js'

const mocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  wipeAgentStateDirs: vi.fn(),
  canUseHarnessSync: vi.fn(),
  getProviderAuthMode: vi.fn(),
  killSession: vi.fn(),
  detectPendingOperatorDecision: vi.fn(),
  getIssueStageSync: vi.fn(),
  getWorkAgentLifecycleState: vi.fn(),
  appendAgentLifecycleLog: vi.fn(),
  invalidateAgentsCache: vi.fn(),
  spawnPanCommandDetached: vi.fn(),
  saveAgentStateSync: vi.fn(),
}))

vi.mock('../../../../lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/agents.js')>()
  return {
    ...actual,
    getAgentState: mocks.getAgentState,
    wipeAgentStateDirs: mocks.wipeAgentStateDirs,
    getProviderAuthMode: mocks.getProviderAuthMode,
    saveAgentStateSync: mocks.saveAgentStateSync,
  }
})

vi.mock('../../../../lib/harness-policy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/harness-policy.js')>()
  return {
    ...actual,
    canUseHarnessSync: mocks.canUseHarnessSync,
  }
})

vi.mock('../../../../lib/tmux.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/tmux.js')>()
  return {
    ...actual,
    killSession: mocks.killSession,
  }
})

vi.mock('../../../../lib/agents/pending-decision-gate.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/agents/pending-decision-gate.js')>()
  return {
    ...actual,
    detectPendingOperatorDecision: mocks.detectPendingOperatorDecision,
  }
})

vi.mock('../../../../lib/overdeck/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/overdeck/agents.js')>()
  return {
    ...actual,
    getIssueStageSync: mocks.getIssueStageSync,
  }
})

vi.mock('../../../../lib/work-agent-lifecycle.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/work-agent-lifecycle.js')>()
  return {
    ...actual,
    getWorkAgentLifecycleState: mocks.getWorkAgentLifecycleState,
  }
})

vi.mock('../agents/shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agents/shared.js')>()
  return {
    ...actual,
    appendAgentLifecycleLog: mocks.appendAgentLifecycleLog,
    invalidateAgentsCache: mocks.invalidateAgentsCache,
    spawnPanCommandDetached: mocks.spawnPanCommandDetached,
  }
})

import { postAgentRestartFreshRoute } from '../agents/lifecycle-restart.js'

function readJson(response: { body?: unknown }): Record<string, unknown> {
  const payload = response.body as { body?: Uint8Array } | null
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '{}'
  return JSON.parse(text) as Record<string, unknown>
}

const agentState = {
  id: 'agent-pan-1837',
  issueId: 'PAN-1837',
  workspace: '/tmp/pan-1837',
  model: 'claude-sonnet-5',
  role: 'work',
  status: 'stopped',
  startedAt: '2026-07-28T00:00:00.000Z',
} as const

async function postRestartFresh(body: Record<string, unknown>) {
  const request = HttpServerRequest.fromWeb(new Request(
    'http://localhost/api/agents/agent-pan-1837/restart-fresh',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  ))
  const eventStore = { appendAsync: () => Effect.succeed(1) }

  return Effect.runPromise(
    Effect.scoped(
      Effect.flatMap(HttpRouter.toHttpEffect(postAgentRestartFreshRoute), (app) =>
        Effect.provideService(
          Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
          EventStoreService,
          eventStore as any,
        ),
      ),
    ),
  )
}

describe('POST /api/agents/:id/restart-fresh — harness-gate ordering (PAN-1837 review fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAgentState.mockReturnValue(Effect.succeed(agentState as any))
    mocks.getIssueStageSync.mockReturnValue(null)
    mocks.detectPendingOperatorDecision.mockResolvedValue(null)
    mocks.getWorkAgentLifecycleState.mockResolvedValue({  // PAN-3917 (W6): the backend inventory's tmux fallback reads the pane list
  // synchronously; these tests have no tmux server, so it reads as empty.
  listSessionsSync: () => [],
  listPaneValuesSync: () => [],
 hasLiveTmuxSession: false } as any)
    mocks.killSession.mockReturnValue(Effect.succeed(undefined))
    mocks.wipeAgentStateDirs.mockResolvedValue({ removed: [], path: '/tmp/pan-1837-agent-dir' })
    mocks.getProviderAuthMode.mockResolvedValue('api-key')
    mocks.appendAgentLifecycleLog.mockResolvedValue(undefined)
    mocks.invalidateAgentsCache.mockReturnValue(undefined)
    mocks.spawnPanCommandDetached.mockResolvedValue('activity-1')
  })

  it('returns 400 with the policy reason and never kills the session or wipes state when the explicit harness/model pair is denied', async () => {
    mocks.canUseHarnessSync.mockReturnValue({ allowed: false, reason: 'Kimi Code harness runs Kimi models only.' })

    const response = await postRestartFresh({ spawn: true, harness: 'kimi-code', model: 'claude-sonnet-5' })

    expect(response.status).toBe(400)
    const payload = readJson(response)
    expect(payload.error).toBe('Kimi Code harness runs Kimi models only.')

    // The whole point of this test: a rejected selection must not have
    // mutated anything — no zombie-session kill, no state-dir wipe.
    expect(mocks.killSession).not.toHaveBeenCalled()
    expect(mocks.wipeAgentStateDirs).not.toHaveBeenCalled()
  })

  it('kills the session and wipes state only after an allowed harness/model pair', async () => {
    mocks.canUseHarnessSync.mockReturnValue({ allowed: true })

    const response = await postRestartFresh({ spawn: false, harness: 'kimi-code', model: 'kimi-code/k3' })

    expect(response.status).toBe(200)
    expect(mocks.killSession).toHaveBeenCalledWith('agent-pan-1837')
    expect(mocks.wipeAgentStateDirs).toHaveBeenCalledWith('PAN-1837')
  })

  it('writes no agent state when the fresh spawn fails — the failure lives in the lifecycle log', async () => {
    // PAN-3849 findings round: the catch path recreated a sessionless
    // `stopped` row (and bypassed the supervisor `exited` event as the source
    // of `stopped`). A failed spawn must leave nothing to roll back. The
    // failure branch is Effect-native: a JS try/catch around `yield*` never
    // sees an Effect.promise rejection (it becomes a defect), and the same
    // applied to the `finally` — so the claim release is asserted too.
    mocks.spawnPanCommandDetached.mockRejectedValue(new Error('boom'))

    const response = await postRestartFresh({ spawn: true })

    expect(response.status).toBe(500)
    const payload = readJson(response)
    expect(payload.error).toContain('could not start')
    expect(payload.details).toBe('boom')
    expect(mocks.saveAgentStateSync).not.toHaveBeenCalled()
    expect(mocks.appendAgentLifecycleLog).toHaveBeenCalledWith(
      'agent-pan-1837',
      'agent.restart_fresh_spawn_failed',
      expect.objectContaining({ issueId: 'PAN-1837', error: 'boom' }),
    )

    // The in-flight claim was released: a retry reaches the spawner instead
    // of 409ing on a leaked claim.
    await postRestartFresh({ spawn: true })
    expect(mocks.spawnPanCommandDetached).toHaveBeenCalledTimes(2)
  })
})
