import { describe, expect, it, vi } from 'vitest'

import { checkDeadEndAgents, type CheckDeadEndAgentsDeps } from '../deacon.js'

const issueId = 'PAN-3228'
const status = {
  issueId,
  reviewStatus: 'blocked',
  testStatus: 'pending',
  mergeStatus: 'pending',
  readyForMerge: false,
  autoRequeueCount: 0,
  updatedAt: '2026-07-28T12:00:00.000Z',
} as const

function createDeps(overrides: CheckDeadEndAgentsDeps = {}): CheckDeadEndAgentsDeps {
  return {
    loadReviewStatuses: vi.fn(() => ({ [issueId]: status as any })),
    sessionExistsSync: vi.fn(() => false),
    getAgentStateSync: vi.fn(() => ({
      id: 'agent-pan-3228',
      issueId,
      status: 'stopped',
    } as any)),
    getAgentDir: vi.fn(() => '/tmp/agent-pan-3228'),
    recordDeadEndNeedsYou: vi.fn(async () => undefined),
    spawnWorkAgentThroughAgentsEndpoint: vi.fn(async () => ({ spawned: true } as any)),
    setReviewStatusSync: vi.fn(),
    clearAgentTroubledSync: vi.fn(),
    saveAgentStateSync: vi.fn(),
    now: () => new Date('2026-07-28T13:00:00.000Z').getTime(),
    ...overrides,
  }
}

describe('checkDeadEndAgents pending operator decisions', () => {
  it('parks a dead agent on needs-you without spawning replacement work', async () => {
    const spawnWorkAgentThroughAgentsEndpoint = vi.fn(async () => ({ spawned: true } as any))
    const recordDeadEndNeedsYou = vi.fn(async () => 'pending decision escalated')
    const deps = createDeps({
      decideAgentAutonomousRedrive: vi.fn(async () => ({
        decision: 'defer' as const,
        reason: 'agent is waiting on an operator decision (tool_permission)',
        needsYou: true as const,
      })),
      spawnWorkAgentThroughAgentsEndpoint,
      recordDeadEndNeedsYou,
    })

    await expect(checkDeadEndAgents(deps)).resolves.toContain('pending decision escalated')
    expect(spawnWorkAgentThroughAgentsEndpoint).not.toHaveBeenCalled()
    expect(recordDeadEndNeedsYou).toHaveBeenCalledWith(
      issueId,
      'pending-operator-decision',
      status.updatedAt,
      expect.stringContaining("pan answer PAN-3228"),
    )
  })

  it('preserves the prior single-respawn behavior when no decision is pending', async () => {
    const spawnWorkAgentThroughAgentsEndpoint = vi.fn(async () => ({ spawned: true } as any))
    const deps = createDeps({
      decideAgentAutonomousRedrive: vi.fn(async () => ({
        decision: 'proceed' as const,
        gateDecision: { decision: 'proceed' as const },
      })),
      spawnWorkAgentThroughAgentsEndpoint,
    })

    const actions = await checkDeadEndAgents(deps)

    expect(spawnWorkAgentThroughAgentsEndpoint).toHaveBeenCalledTimes(1)
    expect(spawnWorkAgentThroughAgentsEndpoint).toHaveBeenCalledWith(issueId)
    expect(actions).toContain(
      'Dead-end recovery (PAN-2209): respawned dead work agent for PAN-3228 (review blocked) to address feedback',
    )
  })
})
