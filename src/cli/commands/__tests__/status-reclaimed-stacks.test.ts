import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'

// Stub the agents module so statusCommand sees no agents.
vi.mock('../../../lib/agents.js', () => ({
  listRunningAgents: vi.fn(),
  listRunningAgentsSync: vi.fn(() => []),
  getAgentDir: vi.fn(() => '/tmp/nonexistent'),
}))
vi.mock('../../../lib/agents/liveness.js', () => ({
  isAlive: vi.fn(async () => ({ alive: false, reason: 'no-session' })),
}))
vi.mock('../../../lib/shadow-state.js', () => ({
  isShadowed: vi.fn(async () => false),
  getShadowState: vi.fn(async () => null),
}))
vi.mock('../../../lib/workspace/stack-health.js', () => ({
  collectDockerContainerLifecycleSnapshot: vi.fn(() => Effect.succeed([])),
  getWorkspaceStackHealth: vi.fn(() => Effect.succeed({ healthy: true, reasons: [], lastObserved: '2026-05-17T00:00:00.000Z' })),
  inferIssueIdFromStackContainerName: vi.fn((name: string) => {
    const match = name.toLowerCase().match(/(?:^|[-_])feature-([a-z]+-\d+)(?=$|[-_])/)
    return match?.[1]?.toUpperCase() ?? null
  }),
}))
vi.mock('../../../lib/restart-status.js', () => ({
  readRestartStatus: vi.fn(async () => null),
  readRestartEvents: vi.fn(async () => []),
  detectConcurrentRestartWriters: vi.fn(() => []),
}))
vi.mock('../../../lib/restart-gate-client.js', () => ({
  readRestartGate: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('../../../lib/cloister/gate-starvation.js', () => ({
  gateStarvationStatusLine: vi.fn(async () => null),
}))

import { statusCommand } from '../status.js'
import { listRunningAgentsSync } from '../../../lib/agents.js'
import { collectDockerContainerLifecycleSnapshot, getWorkspaceStackHealth } from '../../../lib/workspace/stack-health.js'

describe('pan status — reclaimed stacks without an agent (PAN-5648 status-reclaimed-no-agent, CodeRabbit r4672667670)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    delete process.env.OVERDECK_NO_RESUME
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    ;(listRunningAgentsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue([])
    ;(collectDockerContainerLifecycleSnapshot as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Effect.succeed([
      {
        id: 'id-api',
        name: 'overdeck-feature-pan-9001-api-1',
        status: 'Exited (137) 1 minute ago',
        state: 'exited',
      },
    ]))
    ;(getWorkspaceStackHealth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Effect.succeed({
      healthy: true,
      reasons: [],
      reclaimed: ['overdeck-feature-pan-9001-api-1'],
      lastObserved: '2026-05-17T00:00:00.000Z',
    }))
  })

  afterEach(() => {
    logSpy.mockRestore()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows the reclaimed stack under "Stacks Stopped To Free Memory" (ac1)', async () => {
    await statusCommand({} as any)

    const out = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(out).toContain('Stacks Stopped To Free Memory')
    expect(out).toContain('PAN-9001')
    expect(out).toContain('stopped to free memory')
  })

  it('does not fall back to the empty-status message or the broken-stack section (ac2)', async () => {
    await statusCommand({} as any)

    const out = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(out).not.toContain('No running agents.')
    expect(out).not.toContain('Broken Workspace Stacks')
  })
})
