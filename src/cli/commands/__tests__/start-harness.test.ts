import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const readlineMocks = vi.hoisted(() => ({
  question: vi.fn(),
  close: vi.fn(),
}))

const agentMocks = vi.hoisted(() => ({
  getAgentState: vi.fn(),
  getAgentStateSync: vi.fn(),
  clearAgentPaused: vi.fn(),
}))

vi.mock('readline/promises', () => ({
  createInterface: vi.fn(() => ({
    question: readlineMocks.question,
    close: readlineMocks.close,
  })),
}))

// Replace heavy dependencies with pure stubs. We only want to verify that
// (a) --harness pi + Anthropic model + subscription auth exits non-zero with
// the canUseHarness reason on stderr, and (b) --harness flows through to
// spawnAgent without breaking the default path.
vi.mock('../../../lib/agents.js', () => ({
  spawnAgent: vi.fn(async () => ({ id: 'agent-x', issueId: 'PAN-X', workspace: '/tmp', model: 'm', startedAt: new Date().toISOString() })),
  getAgentState: agentMocks.getAgentState,
  getAgentStateSync: agentMocks.getAgentState,
  clearAgentPaused: agentMocks.clearAgentPaused,
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
  let stdinIsTTYDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    readlineMocks.question.mockReset()
    readlineMocks.close.mockReset()
    agentMocks.getAgentState.mockReset()
    agentMocks.clearAgentPaused.mockReset()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`)
    }) as never)
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any)
  })

  afterEach(() => {
    exitSpy.mockRestore()
    stderrSpy.mockRestore()
    if (stdinIsTTYDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', stdinIsTTYDescriptor)
    } else {
      delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY
    }
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

  it('prompts for interactive --host --yes instead of silently accepting it', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    readlineMocks.question.mockResolvedValueOnce('n')

    const { issueCommand } = await import('../start.js')
    await expect(
      issueCommand('PAN-X', {
        model: '',
        host: true,
        yes: true,
      } as any),
    ).rejects.toThrow(/__exit__:1/)

    expect(readlineMocks.question).toHaveBeenCalledWith(expect.stringContaining('Are you sure?'))
    expect(readlineMocks.close).toHaveBeenCalled()
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

  it('refuses paused agents unless --force is passed', async () => {
    agentMocks.getAgentState.mockReturnValueOnce({
      id: 'agent-pan-x',
      issueId: 'PAN-X',
      paused: true,
      pausedReason: 'needs inspection',
    })

    const { issueCommand } = await import('../start.js')
    await expect(
      issueCommand('PAN-X', {
        model: '',
      } as any),
    ).rejects.toThrow(/__exit__:1/)

    const written = stderrSpy.mock.calls.map(call => String(call[0])).join('')
    expect(written).toContain('agent-pan-x')
    expect(written).toContain('needs inspection')
    expect(written).toContain('pan unpause PAN-X')
    expect(agentMocks.clearAgentPaused).not.toHaveBeenCalled()
  })
})
