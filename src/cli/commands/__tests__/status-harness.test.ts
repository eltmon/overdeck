import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stub the agents module so statusCommand sees our scripted agents.
vi.mock('../../../lib/agents.js', () => ({
  listRunningAgents: vi.fn(),
  getAgentDir: vi.fn(() => '/tmp/nonexistent'),
}))
vi.mock('../../../lib/shadow-state.js', () => ({
  isShadowed: vi.fn(async () => false),
  getShadowState: vi.fn(async () => null),
}))
vi.mock('../../../lib/tldr-daemon.js', () => ({
  getTldrMetrics: vi.fn(() => ({ interceptions: 0, bypasses: 0, estimatedTokensSaved: 0 })),
  getTldrDaemonService: vi.fn(),
}))
vi.mock('../../../lib/workspace/stack-health.js', () => ({
  collectDockerContainerLifecycleSnapshot: vi.fn(async () => []),
  getWorkspaceStackHealth: vi.fn(async () => ({ healthy: true, reasons: [], lastObserved: '2026-05-17T00:00:00.000Z' })),
  inferIssueIdFromStackContainerName: vi.fn((name: string) => {
    const match = name.toLowerCase().match(/(?:^|[-_])feature-([a-z]+-\d+)(?=$|[-_])/)
    return match?.[1]?.toUpperCase() ?? null
  }),
}))

import { statusCommand } from '../status.js'
import { listRunningAgents } from '../../../lib/agents.js'
import { collectDockerContainerLifecycleSnapshot, getWorkspaceStackHealth } from '../../../lib/workspace/stack-health.js'

describe('pan status — harness column (PAN-636 workspace-dbf)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(collectDockerContainerLifecycleSnapshot as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(getWorkspaceStackHealth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      healthy: true,
      reasons: [],
      lastObserved: '2026-05-17T00:00:00.000Z',
    })
  })

  afterEach(() => {
    logSpy.mockRestore()
    vi.restoreAllMocks()
  })

  it('AC: prints a "Harness:" line for each running agent (pi value when configured)', async () => {
    ;(listRunningAgents as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
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
    ;(listRunningAgents as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
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
    ;(listRunningAgents as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
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

  it('prints broken Docker workspace stacks without agent state', async () => {
    ;(listRunningAgents as unknown as ReturnType<typeof vi.fn>).mockReturnValue([])
    ;(collectDockerContainerLifecycleSnapshot as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'init1',
        name: 'panopticon-feature-pan-1140-init-1',
        status: 'Exited (1) 2 minutes ago',
        state: 'exited',
      },
    ])
    ;(getWorkspaceStackHealth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      healthy: false,
      reasons: ['panopticon-feature-pan-1140-init-1 init exited non-zero (1)'],
      lastObserved: '2026-05-17T00:00:00.000Z',
    })

    await statusCommand({} as any)

    const out = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(out).toContain('Broken Workspace Stacks')
    expect(out).toContain('PAN-1140')
    expect(out).toContain('STACK BROKEN')
  })
})
