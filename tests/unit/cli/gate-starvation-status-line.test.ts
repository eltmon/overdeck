import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'

// Stub the agents module so statusCommand sees our scripted agents.
vi.mock('../../../src/lib/agents.js', () => ({
  listRunningAgents: vi.fn(),
  listRunningAgentsSync: vi.fn(() => []),
  getAgentDir: vi.fn(() => '/tmp/nonexistent'),
}))
vi.mock('../../../src/lib/agents/liveness.js', () => ({
  isAlive: vi.fn(async () => ({ alive: false, reason: 'no-session' })),
}))
vi.mock('../../../src/lib/shadow-state.js', () => ({
  isShadowed: vi.fn(async () => false),
  getShadowState: vi.fn(async () => null),
}))
vi.mock('../../../src/lib/workspace/stack-health.js', () => ({
  collectDockerContainerLifecycleSnapshot: vi.fn(() => Effect.succeed([])),
  getWorkspaceStackHealth: vi.fn(() => Effect.succeed({ healthy: true, reasons: [], lastObserved: '2026-05-17T00:00:00.000Z' })),
  inferIssueIdFromStackContainerName: vi.fn(() => null),
}))
vi.mock('../../../src/lib/restart-status.js', () => ({
  readRestartStatus: vi.fn(async () => null),
  readRestartEvents: vi.fn(async () => []),
  detectConcurrentRestartWriters: vi.fn(() => []),
}))
// The restart gate (PAN-3729) lives in the dashboard server; keep this test off
// the network and off the gate line.
vi.mock('../../../src/lib/restart-gate-client.js', () => ({
  readRestartGate: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('../../../src/lib/cloister/gate-starvation.js', () => ({
  gateStarvationStatusLine: vi.fn(),
}))

import { statusCommand } from '../../../src/cli/commands/status.js'
import { gateStarvationStatusLine } from '../../../src/lib/cloister/gate-starvation.js'

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '')
}

describe('pan status — starvation line (PAN-5621)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  })

  afterEach(() => {
    logSpy.mockRestore()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('prints the starvation line before "No running agents." when an episode is open', async () => {
    (gateStarvationStatusLine as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      'Gate queue starved since 09:27 (25 min): typecheck for PAN-5489 has waited 52 min and needs 2.7 GiB above the 8.0 GiB hard reserve; 9.4 GiB available. Free memory to let it start.',
    )

    await statusCommand({})

    const lines = logSpy.mock.calls.map((call) => stripAnsi(String(call[0] ?? '')))
    const starvedIndex = lines.findIndex((line) => line.includes('Gate queue starved'))
    const noAgentsIndex = lines.findIndex((line) => line.includes('No running agents.'))
    expect(starvedIndex).toBeGreaterThanOrEqual(0)
    expect(noAgentsIndex).toBeGreaterThanOrEqual(0)
    expect(starvedIndex).toBeLessThan(noAgentsIndex)
  })

  it('prints no starvation line when gateStarvationStatusLine resolves to null', async () => {
    (gateStarvationStatusLine as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    await statusCommand({})

    const lines = logSpy.mock.calls.map((call) => stripAnsi(String(call[0] ?? '')))
    expect(lines.some((line) => line.includes('Gate queue starved'))).toBe(false)
  })

  it('leaves --json output as a plain agent array with no starvation text', async () => {
    (gateStarvationStatusLine as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      'Gate queue starved since 09:27 (25 min): typecheck for PAN-5489 has waited 52 min; 9.4 GiB available. Free memory to let it start.',
    )

    await statusCommand({ json: true })

    expect(logSpy).toHaveBeenCalledTimes(1)
    const output = String(logSpy.mock.calls[0]?.[0] ?? '')
    const parsed = JSON.parse(output)
    expect(Array.isArray(parsed)).toBe(true)
    expect(output).not.toContain('Gate queue starved')
  })
})
