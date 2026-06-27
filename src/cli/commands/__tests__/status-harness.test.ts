import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'

// Stub the agents module so statusCommand sees our scripted agents.
vi.mock('../../../lib/agents.js', () => ({
  listRunningAgents: vi.fn(),
  listRunningAgentsSync: vi.fn(),
  getAgentDir: vi.fn(() => '/tmp/nonexistent'),
}))
vi.mock('../../../lib/shadow-state.js', () => ({
  isShadowed: vi.fn(() => Effect.succeed(false)),
  getShadowState: vi.fn(() => Effect.succeed(null)),
}))
vi.mock('../../../lib/tldr-daemon.js', () => ({
  getTldrMetrics: vi.fn(() => ({ interceptions: 0, bypasses: 0, estimatedTokensSaved: 0 })),
  getTldrMetricsSync: vi.fn(() => ({ interceptions: 0, bypasses: 0, estimatedTokensSaved: 0 })),
  getTldrDaemonService: vi.fn(),
  getTldrDaemonServiceSync: vi.fn(),
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
  readRestartStatus: vi.fn(() => Effect.succeed(null)),
  readRestartEvents: vi.fn(() => Effect.succeed([])),
  detectConcurrentRestartWriters: vi.fn(() => []),
}))

import { statusCommand } from '../status.js'
import { listRunningAgentsSync } from '../../../lib/agents.js'
import { collectDockerContainerLifecycleSnapshot, getWorkspaceStackHealth } from '../../../lib/workspace/stack-health.js'
import { readRestartEvents, readRestartStatus } from '../../../lib/restart-status.js'

describe('pan status — harness column (PAN-636 workspace-dbf)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let originalNoResume: string | undefined

  beforeEach(() => {
    originalNoResume = process.env.OVERDECK_NO_RESUME
    delete process.env.OVERDECK_NO_RESUME
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    ;(collectDockerContainerLifecycleSnapshot as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Effect.succeed([]))
    ;(readRestartStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Effect.succeed(null))
    ;(readRestartEvents as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Effect.succeed([]))
    ;(getWorkspaceStackHealth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Effect.succeed({
      healthy: true,
      reasons: [],
      lastObserved: '2026-05-17T00:00:00.000Z',
    }))
  })

  afterEach(() => {
    logSpy.mockRestore()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (originalNoResume === undefined) delete process.env.OVERDECK_NO_RESUME
    else process.env.OVERDECK_NO_RESUME = originalNoResume
  })

  it('AC: prints a "Harness:" line for each running agent (pi value when configured)', async () => {
    ;(listRunningAgentsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        id: 'agent-pi-1',
        issueId: 'PAN-636',
        harness: 'pi',
        role: 'work',
        model: 'claude-sonnet-4-6',
        workspace: '/tmp/ws',
        startedAt: new Date().toISOString(),
        tmuxActive: true,
      },
    ])

    await statusCommand({} as any)

    const out = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(out).toMatch(/Harness:\s+pi/)
  })

  it('AC: defaults to claude-code when harness is missing on legacy agent state', async () => {
    ;(listRunningAgentsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        id: 'agent-legacy-1',
        issueId: 'PAN-100',
        // harness intentionally absent — emulates a legacy state.json from before PAN-636.
        role: 'work',
        model: 'claude-sonnet-4-6',
        workspace: '/tmp/ws',
        startedAt: new Date().toISOString(),
        tmuxActive: true,
      },
    ])

    await statusCommand({} as any)

    const out = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(out).toMatch(/Harness:\s+claude-code/)
  })

  it('json mode includes harness in the agent payload', async () => {
    ;(listRunningAgentsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        id: 'agent-pi-2',
        issueId: 'PAN-636',
        harness: 'pi',
        role: 'work',
        model: 'claude-sonnet-4-6',
        workspace: '/tmp/ws',
        startedAt: new Date().toISOString(),
        tmuxActive: true,
      },
    ])

    await statusCommand({ json: true } as any)

    const out = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    // The first call is the JSON dump — it must contain `"harness":"pi"`.
    expect(out).toMatch(/"harness":\s*"pi"/)
  })

  it('prints the latest dashboard restart status', async () => {
    ;(listRunningAgentsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue([])
    ;(readRestartStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Effect.succeed({
      ts: new Date().toISOString(),
      trigger: 'pan reload',
      success: false,
      error: '[dashboard] health check failed',
      durationMs: 2400,
      attempts: 1,
    }))

    await statusCommand({} as any)

    const out = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(out).toContain('Last dashboard restart:')
    expect(out).toContain('pan reload')
    expect(out).toContain('[dashboard] health check failed')
  })

  it('shows a prominent marker when the watchdog gave up', async () => {
    ;(listRunningAgentsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue([])
    ;(readRestartStatus as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Effect.succeed({
      ts: new Date().toISOString(),
      trigger: 'watchdog',
      success: false,
      error: 'restart cap reached',
      durationMs: 0,
      attempts: 3,
      gaveUp: true,
    }))

    await statusCommand({} as any)

    const out = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(out).toContain('⚠ FAILED — watchdog gave up')
    expect(out).toContain('restart cap reached')
  })

  it('prints broken Docker workspace stacks without agent state', async () => {
    ;(listRunningAgentsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue([])
    ;(collectDockerContainerLifecycleSnapshot as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Effect.succeed([
      {
        id: 'init1',
        name: 'overdeck-feature-pan-1140-init-1',
        status: 'Exited (1) 2 minutes ago',
        state: 'exited',
      },
    ]))
    ;(getWorkspaceStackHealth as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Effect.succeed({
      healthy: false,
      reasons: ['overdeck-feature-pan-1140-init-1 init exited non-zero (1)'],
      lastObserved: '2026-05-17T00:00:00.000Z',
    }))

    await statusCommand({} as any)

    const out = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(out).toContain('Broken Workspace Stacks')
    expect(out).toContain('PAN-1140')
    expect(out).toContain('STACK BROKEN')
  })

  it('prints gating reasons only for non-running gated agents', async () => {
    ;(listRunningAgentsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        id: 'agent-paused',
        issueId: 'PAN-1141',
        role: 'work',
        model: 'claude-sonnet-4-6',
        workspace: '/tmp/paused',
        startedAt: new Date().toISOString(),
        tmuxActive: false,
        paused: true,
        pausedReason: 'manual inspection',
      },
      {
        id: 'agent-troubled',
        issueId: 'PAN-1142',
        role: 'work',
        model: 'claude-sonnet-4-6',
        workspace: '/tmp/troubled',
        startedAt: new Date().toISOString(),
        tmuxActive: false,
        troubled: true,
        consecutiveFailures: 3,
      },
      {
        id: 'agent-manual',
        issueId: 'PAN-1143',
        role: 'work',
        model: 'claude-sonnet-4-6',
        workspace: '/tmp/manual',
        startedAt: new Date().toISOString(),
        tmuxActive: false,
        stoppedByUser: true,
      },
      {
        id: 'agent-waiting',
        issueId: 'PAN-1144',
        role: 'work',
        model: 'claude-sonnet-4-6',
        workspace: '/tmp/waiting',
        startedAt: new Date().toISOString(),
        tmuxActive: false,
      },
      {
        id: 'agent-running',
        issueId: 'PAN-1145',
        role: 'work',
        model: 'claude-sonnet-4-6',
        workspace: '/tmp/running',
        startedAt: new Date().toISOString(),
        tmuxActive: true,
      },
    ])

    await statusCommand({} as any)

    const out = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(out).toContain('Gate:     Paused (manual inspection)')
    expect(out).toContain('Gate:     Troubled (3 failures)')
    expect(out).toContain('Gate:     Manual')
    expect(out).not.toMatch(/agent-waiting[\s\S]*?Gate:/)
    expect(out).not.toMatch(/agent-running[\s\S]*?Gate:/)
  })

  it('uses dashboard no-resume state as a boot gating reason', async () => {
    ;(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ active: true, since: '2026-05-17T17:00:00.000Z' }),
    })
    ;(listRunningAgentsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        id: 'agent-no-resume',
        issueId: 'PAN-1141',
        role: 'work',
        model: 'claude-sonnet-4-6',
        workspace: '/tmp/no-resume',
        startedAt: new Date().toISOString(),
        tmuxActive: false,
      },
    ])

    await statusCommand({} as any)

    const out = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(out).toContain('Gate:     Boot --no-resume')
  })
})
