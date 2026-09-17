import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  messageAgent: vi.fn(),
  sendKeys: vi.fn(),
  isAgentIdleForNudge: vi.fn(() => true),
  getAgentIdleAgeMs: vi.fn(() => 12 * 60_000),
}))

vi.mock('../../agents/messaging.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, messageAgent: mocks.messageAgent }
})

vi.mock('../../tmux.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, sendKeys: mocks.sendKeys }
})

vi.mock('../agent-idle.js', () => ({
  isAgentIdleForNudge: mocks.isAgentIdleForNudge,
  getAgentIdleAgeMs: mocks.getAgentIdleAgeMs,
}))

import { checkDeadEndAgents, type CheckDeadEndAgentsDeps } from '../deacon.js'

const issueId = 'PAN-3846'
const status = {
  issueId,
  reviewStatus: 'blocked',
  testStatus: 'pending',
  mergeStatus: 'pending',
  readyForMerge: false,
  autoRequeueCount: 0,
  updatedAt: '2026-09-17T10:00:00.000Z',
} as const

function createDeps(overrides: CheckDeadEndAgentsDeps = {}): CheckDeadEndAgentsDeps {
  return {
    loadReviewStatuses: vi.fn(() => ({ [issueId]: status as any })),
    sessionExistsSync: vi.fn(() => true),
    getAgentStateSync: vi.fn(() => ({
      id: 'agent-pan-3846',
      issueId,
      status: 'running',
    } as any)),
    getAgentDir: vi.fn(() => '/tmp/agent-pan-3846'),
    recordDeadEndNeedsYou: vi.fn(async () => undefined),
    spawnWorkAgentThroughAgentsEndpoint: vi.fn(async () => ({ spawned: false } as any)),
    setReviewStatusSync: vi.fn(),
    clearAgentTroubledSync: vi.fn(),
    saveAgentStateSync: vi.fn(),
    now: () => new Date('2026-09-17T12:00:00.000Z').getTime(),
    ...overrides,
  }
}

describe('checkDeadEndAgents idle nudge delivery (PAN-3846 W5)', () => {
  it('routes the dead-end nudge through messageAgent and never sendKeys', async () => {
    mocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: true, confirmed: true })

    const actions = await checkDeadEndAgents(createDeps())

    expect(mocks.messageAgent).toHaveBeenCalledTimes(1)
    expect(mocks.messageAgent).toHaveBeenCalledWith(
      'agent-pan-3846',
      expect.stringContaining('review agent found issues'),
      'deacon:dead-end',
      { owesRework: true },
    )
    expect(mocks.sendKeys).not.toHaveBeenCalled()
    expect(actions.some((a) =>
      a.includes('Dead-end recovery: nudged agent-pan-3846')
      && a.includes('idle for 12m')
      && a.includes('turn confirmed=true'),
    )).toBe(true)
  })

  it('reports the reason when the nudge is not delivered', async () => {
    mocks.messageAgent.mockResolvedValue({
      delivered: false,
      queuedToMail: true,
      confirmed: false,
      reason: 'message was injected but no turn appeared in transcript session-1 within the confirmation window (2 attempts)',
    })

    // A distinct issue key avoids the module-level dead-end cooldown.
    const other = { ...status, issueId: 'PAN-3847', updatedAt: status.updatedAt }
    const deps = createDeps({
      loadReviewStatuses: vi.fn(() => ({ 'PAN-3847': other as any })),
    })

    const actions = await checkDeadEndAgents(deps)

    expect(actions.some((a) =>
      a.includes('Dead-end recovery: nudge NOT delivered to agent-pan-3847')
      && a.includes('no turn appeared in transcript session-1'),
    )).toBe(true)
    expect(mocks.sendKeys).not.toHaveBeenCalled()
  })
})
