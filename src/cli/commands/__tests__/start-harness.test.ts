import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Replace heavy dependencies with pure stubs. We only want to verify that
// (a) --harness pi + Anthropic model + subscription auth exits non-zero with
// the canUseHarness reason on stderr, and (b) --harness flows through to
// spawnAgent without breaking the default path.
vi.mock('../../../lib/agents.js', () => ({
  spawnAgent: vi.fn(async () => ({ id: 'agent-x', issueId: 'PAN-X', workspace: '/tmp', model: 'm', startedAt: new Date().toISOString() })),
  getProviderAuthMode: vi.fn(async () => 'subscription'),
  getProviderEnvForModel: vi.fn(async () => ({})),
  getProviderExportsForModel: vi.fn(async () => ''),
  getAgentRuntimeBaseCommand: vi.fn(async () => 'claude'),
}))

vi.mock('../../../lib/harness-policy.js', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/harness-policy.js')>(
    '../../../lib/harness-policy.js',
  )
  return actual
})

describe('pan start --harness flag (PAN-636)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`)
    }) as never)
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any)
  })

  afterEach(() => {
    exitSpy.mockRestore()
    stderrSpy.mockRestore()
    vi.resetModules()
  })

  it('rejects --harness pi + Anthropic model + subscription auth with non-zero exit and reason on stderr', async () => {
    const { issueCommand } = await import('../start.js')
    await expect(
      issueCommand('PAN-X', {
        model: 'claude-sonnet-4-6',
        harness: 'pi',
      } as any),
    ).rejects.toThrow(/__exit__:1/)

    const written = stderrSpy.mock.calls.map(call => String(call[0])).join('')
    expect(written.toLowerCase()).toContain('pi')
    expect(written.toLowerCase()).toContain('anthropic')
  })

  it('rejects an unknown --harness value with non-zero exit', async () => {
    const { issueCommand } = await import('../start.js')
    await expect(
      issueCommand('PAN-X', {
        model: 'claude-sonnet-4-6',
        harness: 'codex' as any,
      } as any),
    ).rejects.toThrow(/__exit__:1/)
    const written = stderrSpy.mock.calls.map(call => String(call[0])).join('')
    expect(written).toMatch(/Invalid --harness/)
  })
})
