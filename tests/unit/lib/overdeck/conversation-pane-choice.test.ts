/**
 * PAN-3113 — the pane-choice answer endpoint contract: stale-signature
 * refusal, menu-gone refusal, keystroke mapping, and post-delivery
 * confirmation. Deps (capture/sendKey/sleep/sessionExists) are injected so
 * no real tmux is involved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../src/lib/overdeck/conversations.js', () => ({
  getConversationById: vi.fn(),
  getConversationByName: vi.fn(),
}))
vi.mock('../../../../src/lib/overdeck/conversation-runtime.js', () => ({
  tmuxSessionExists: vi.fn(),
}))

import { handleConversationPaneChoiceAnswer } from '../../../../src/lib/overdeck/conversation-pane-choice.js'
import { getConversationById, getConversationByName } from '../../../../src/lib/overdeck/conversations.js'
import { tmuxSessionExists } from '../../../../src/lib/overdeck/conversation-runtime.js'

const MENU = [
  'This session is 4h 5m old and 146.9k tokens.',
  '',
  'Resuming the full session will consume a substantial portion of your usage limits. We recommend resuming from a summary.',
  '',
  '❯ 1. Resume from summary (recommended)',
  '  2. Resume full session as-is',
  "  3. Don't ask me again",
  '',
  'Enter to confirm · Esc to cancel',
].join('\n')

/** signature of MENU as produced by paneChoiceMenuSignature — computed via the real parser. */
import { parsePaneChoiceMenu, paneChoiceMenuSignature } from '../../../../src/lib/pane-choice-menu.js'
const SIGNATURE = paneChoiceMenuSignature(parsePaneChoiceMenu(MENU)!)

const CONV = { name: '20260726-7246', tmuxSession: 'conv-20260726-7246', harness: 'claude-code' }

function jsonOf(res: { body: Record<string, unknown> }): Record<string, unknown> {
  return res.body
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getConversationByName).mockReturnValue(CONV as never)
  vi.mocked(getConversationById).mockReturnValue(CONV as never)
  vi.mocked(tmuxSessionExists).mockResolvedValue(true)
})

describe('handleConversationPaneChoiceAnswer — validation', () => {
  it('rejects a bad selectedIndex', async () => {
    const res = await handleConversationPaneChoiceAnswer('abc', { selectedIndex: -1, signature: SIGNATURE })
    expect(jsonOf(res).error).toMatch(/selectedIndex/)
  })

  it('rejects a missing signature', async () => {
    const res = await handleConversationPaneChoiceAnswer('abc', { selectedIndex: 0 })
    expect(jsonOf(res).error).toMatch(/signature/)
  })

  it('404s when the conversation does not exist', async () => {
    vi.mocked(getConversationByName).mockReturnValue(null as never)
    const res = await handleConversationPaneChoiceAnswer('ghost', { selectedIndex: 0, signature: SIGNATURE })
    expect(jsonOf(res).error).toMatch(/not found/i)
  })

  it('409s when the tmux session is not running', async () => {
    vi.mocked(tmuxSessionExists).mockResolvedValue(false)
    const res = await handleConversationPaneChoiceAnswer('abc', { selectedIndex: 0, signature: SIGNATURE }, {
      sessionExists: async () => false,
    })
    expect(jsonOf(res).error).toMatch(/not running/i)
  })
})

describe('handleConversationPaneChoiceAnswer — menu state gates', () => {
  const base = { selectedIndex: 0, signature: SIGNATURE }

  it('409s with menu-gone when no menu is on screen', async () => {
    const res = await handleConversationPaneChoiceAnswer('abc', base, {
      capture: async () => 'session resumed, working away',
    })
    expect(jsonOf(res).code).toBe('menu-gone')
  })

  it('409s with menu-changed when the on-screen menu drifted from the card', async () => {
    const drifted = MENU.replace("Don't ask me again", 'Never ask again')
    const res = await handleConversationPaneChoiceAnswer('abc', base, {
      capture: async () => drifted,
    })
    expect(jsonOf(res).code).toBe('menu-changed')
  })

  it('rejects an out-of-range selection', async () => {
    const res = await handleConversationPaneChoiceAnswer('abc', { selectedIndex: 7, signature: SIGNATURE }, {
      capture: async () => MENU,
    })
    expect(jsonOf(res).error).toMatch(/out of range/)
  })
})

describe('handleConversationPaneChoiceAnswer — delivery', () => {
  it('sends Down×N + Enter for the chosen option and confirms dismissal', async () => {
    const sent: string[] = []
    let captures = 0
    const res = await handleConversationPaneChoiceAnswer('abc', { selectedIndex: 2, signature: SIGNATURE }, {
      capture: async () => { captures += 1; return captures === 1 ? MENU : 'resumed' },
      sendKey: async (_s, key) => { sent.push(key) },
      sleep: async () => {},
    })
    expect(sent).toEqual(['Down', 'Down', 'Enter'])
    expect(jsonOf(res).ok).toBe(true)
    expect(jsonOf(res).answeredLabel).toBe("Don't ask me again")
  })

  it('sends a bare Enter for the option already holding the cursor', async () => {
    const sent: string[] = []
    let captures = 0
    await handleConversationPaneChoiceAnswer('abc', { selectedIndex: 0, signature: SIGNATURE }, {
      capture: async () => { captures += 1; return captures === 1 ? MENU : 'resumed' },
      sendKey: async (_s, key) => { sent.push(key) },
      sleep: async () => {},
    })
    expect(sent).toEqual(['Enter'])
  })

  it('409s with delivery-unconfirmed when the menu survives the keystrokes', async () => {
    const res = await handleConversationPaneChoiceAnswer('abc', { selectedIndex: 1, signature: SIGNATURE }, {
      capture: async () => MENU, // menu never dismisses
      sendKey: async () => {},
      sleep: async () => {},
    })
    expect(jsonOf(res).code).toBe('delivery-unconfirmed')
  })
})
