import { afterEach, describe, expect, it, vi } from 'vitest'

import { CLAUDE_TRUST_DIALOG_BACKSTOP } from '../../../../tests/fixtures/claude-trust-dialog.js'

const paneIo = vi.hoisted(() => ({
  read: vi.fn<(lines: number) => Promise<string>>(),
  sendKey: vi.fn<(key: string) => Promise<void>>(async () => undefined),
  resolved: [] as string[],
}))

vi.mock('../../../lib/terminal-backends/agent-pane-io.js', () => ({
  resolveAgentPaneIo: vi.fn(async (agentId: string) => {
    paneIo.resolved.push(agentId)
    return { backend: 'herdr', read: paneIo.read, sendKey: paneIo.sendKey, pressSendNow: vi.fn() }
  }),
}))

import { answerCommand, normalizeAnswerSessionId } from '../answer.js'

const paneChoice = {
  signature: 'sig-1',
  title: 'Allow this command?',
  contextLines: ['Bash command: npm test'],
  options: [
    { number: 1, label: 'Yes', recommended: true },
    { number: 2, label: 'No', recommended: false },
  ],
  selectedIndex: 0,
  footerHint: 'Enter to confirm',
  confidence: 'high' as const,
}

describe('answerCommand', () => {
  it('normalizes issue IDs while preserving explicit session IDs', () => {
    expect(normalizeAnswerSessionId('PAN-3228')).toBe('agent-pan-3228')
    expect(normalizeAnswerSessionId('agent-pan-3228')).toBe('agent-pan-3228')
    expect(normalizeAnswerSessionId('conv-123')).toBe('conv-123')
  })

  it('prints the pending menu when no option is supplied', async () => {
    const log = vi.fn()

    await answerCommand('PAN-3228', undefined, {
      captureSessionPaneChoice: vi.fn(async () => paneChoice),
      log,
      exit: vi.fn(async () => undefined),
    })

    expect(log.mock.calls.map(([line]) => line)).toEqual([
      'Allow this command?',
      'Bash command: npm test',
      '1. Yes (recommended)',
      '2. No',
      'Enter to confirm',
    ])
  })

  it('exits non-zero when no choice menu is pending', async () => {
    const error = vi.fn()
    const exit = vi.fn(async () => undefined)

    await answerCommand('PAN-3228', undefined, {
      captureSessionPaneChoice: vi.fn(async () => null),
      error,
      exit,
    })

    expect(error).toHaveBeenCalledWith('No pending choice menu for PAN-3228')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('answers the on-screen number and exits successfully only after core confirmation', async () => {
    const answerSessionPaneChoice = vi.fn(async () => ({
      body: { ok: true, answeredLabel: 'No' },
    }))
    const log = vi.fn()
    const exit = vi.fn(async () => undefined)

    await answerCommand('PAN-3228', '2', {
      captureSessionPaneChoice: vi.fn(async () => paneChoice),
      answerSessionPaneChoice,
      log,
      exit,
    })

    expect(answerSessionPaneChoice).toHaveBeenCalledWith('agent-pan-3228', {
      selectedIndex: 1,
      signature: 'sig-1',
    })
    expect(log).toHaveBeenCalledWith('Answered PAN-3228: No')
    expect(exit).not.toHaveBeenCalled()
  })

  it('exits non-zero with a clear explanation when the menu changed', async () => {
    const error = vi.fn()
    const exit = vi.fn(async () => undefined)

    await answerCommand('PAN-3228', '1', {
      captureSessionPaneChoice: vi.fn(async () => paneChoice),
      answerSessionPaneChoice: vi.fn(async () => ({
        body: { error: 'changed', code: 'menu-changed' },
        status: 409,
      })),
      error,
      exit,
    })

    expect(error).toHaveBeenCalledWith(expect.stringContaining('menu changed'))
    expect(exit).toHaveBeenCalledWith(1)
  })
})

// PAN-4242: on a Herdr host tmux sees no pane, so pan answer reads and keys
// through the host's terminal backend.
describe('answerCommand through the terminal backend', () => {
  afterEach(() => {
    vi.useRealTimers()
    paneIo.read.mockReset()
    paneIo.sendKey.mockClear()
    paneIo.resolved.length = 0
  })

  it('lists the folder-trust dialog read from a Herdr pane', async () => {
    paneIo.read.mockResolvedValue(CLAUDE_TRUST_DIALOG_BACKSTOP)
    const log = vi.fn()

    await answerCommand('planning-cli-2', undefined, { log, exit: vi.fn(async () => undefined) })

    expect(paneIo.resolved).toEqual(['planning-cli-2'])
    const lines = log.mock.calls.map(([line]) => line)
    expect(lines[0]).toBe('Accessing workspace:')
    expect(lines).toContain('1. No, continue without these permissions')
    expect(lines).toContain('2. Yes, I trust this folder')
  })

  it('answers option 2 with Down then Enter', async () => {
    vi.useFakeTimers()
    paneIo.read
      .mockResolvedValueOnce(CLAUDE_TRUST_DIALOG_BACKSTOP)
      .mockResolvedValueOnce(CLAUDE_TRUST_DIALOG_BACKSTOP)
      .mockResolvedValue('Claude Code v2.1.330\n❯ ')
    const log = vi.fn()
    const exit = vi.fn(async () => undefined)

    const run = answerCommand('planning-cli-2', '2', { log, exit })
    await vi.runAllTimersAsync()
    await run

    expect(paneIo.sendKey.mock.calls.map(([key]) => key)).toEqual(['Down', 'Enter'])
    expect(log).toHaveBeenCalledWith('Answered planning-cli-2: Yes, I trust this folder')
    expect(exit).not.toHaveBeenCalled()
  })

  it('reports no menu when the pane cannot be read', async () => {
    paneIo.read.mockRejectedValue(new Error('herdr holds no pane for planning-cli-2'))
    const error = vi.fn()
    const exit = vi.fn(async () => undefined)

    await answerCommand('planning-cli-2', undefined, { error, exit })

    expect(error).toHaveBeenCalledWith('No pending choice menu for planning-cli-2')
    expect(exit).toHaveBeenCalledWith(1)
  })
})
