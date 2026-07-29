import { describe, expect, it, vi } from 'vitest'

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
