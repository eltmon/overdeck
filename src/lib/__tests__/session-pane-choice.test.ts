import { describe, expect, it, vi } from 'vitest'

import { paneChoiceMenuSignature, parsePaneChoiceMenu } from '../pane-choice-menu.js'
import { answerSessionPaneChoice, captureSessionPaneChoice } from '../session-pane-choice.js'

const MENU = [
  'This session is 4h 5m old and 146.9k tokens.',
  '',
  'Resuming the full session will consume a substantial portion of your usage limits.',
  '',
  '❯ 1. Resume from summary (recommended)',
  '  2. Resume full session as-is',
  "  3. Don't ask me again",
  '',
  'Enter to confirm · Esc to cancel',
].join('\n')

const SIGNATURE = paneChoiceMenuSignature(parsePaneChoiceMenu(MENU)!)
const SESSION = 'agent-pan-3228'

function answerDeps(capture: () => Promise<string>) {
  return {
    capture,
    sessionExists: vi.fn(async () => true),
    sendKey: vi.fn(async () => undefined),
    sleep: vi.fn(async () => undefined),
  }
}

describe('captureSessionPaneChoice', () => {
  it('returns the parsed menu payload for a blocking choice', async () => {
    const result = await captureSessionPaneChoice(SESSION, async () => MENU)

    expect(result).toMatchObject({
      signature: SIGNATURE,
      options: [
        { number: 1, label: 'Resume from summary', recommended: true },
        { number: 2, label: 'Resume full session as-is', recommended: false },
        { number: 3, label: "Don't ask me again", recommended: false },
      ],
      selectedIndex: 0,
    })
    expect(result?.title).toContain('This session is 4h 5m old')
  })

  it('returns null when no menu is present or capture fails', async () => {
    await expect(captureSessionPaneChoice(SESSION, async () => 'working')).resolves.toBeNull()
    await expect(captureSessionPaneChoice(SESSION, async () => {
      throw new Error('capture failed')
    })).resolves.toBeNull()
  })
})

describe('answerSessionPaneChoice', () => {
  it('rejects invalid answer bodies', async () => {
    await expect(answerSessionPaneChoice(SESSION, {
      selectedIndex: -1,
      signature: SIGNATURE,
    })).resolves.toEqual({
      body: { error: 'selectedIndex must be an integer 0-8' },
      status: 400,
    })
    await expect(answerSessionPaneChoice(SESSION, {
      selectedIndex: 0,
      signature: '',
    })).resolves.toEqual({
      body: { error: 'signature is required' },
      status: 400,
    })
  })

  it('returns menu-gone when the current pane has no menu', async () => {
    const result = await answerSessionPaneChoice(
      SESSION,
      { selectedIndex: 0, signature: SIGNATURE },
      answerDeps(async () => 'working'),
    )

    expect(result).toEqual({
      body: { error: 'The choice menu is no longer on screen', code: 'menu-gone' },
      status: 409,
    })
  })

  it('returns menu-changed when the signature drifted', async () => {
    const result = await answerSessionPaneChoice(
      SESSION,
      { selectedIndex: 0, signature: SIGNATURE },
      answerDeps(async () => MENU.replace("Don't ask me again", 'Never ask again')),
    )

    expect(result.body.code).toBe('menu-changed')
    expect(result.status).toBe(409)
  })

  it('returns delivery-unconfirmed when the menu survives keystrokes', async () => {
    const result = await answerSessionPaneChoice(
      SESSION,
      { selectedIndex: 1, signature: SIGNATURE },
      answerDeps(async () => MENU),
    )

    expect(result.body.code).toBe('delivery-unconfirmed')
    expect(result.status).toBe(409)
  })

  it('sends the selected keystrokes and returns the answered label after dismissal', async () => {
    let captures = 0
    const deps = answerDeps(async () => {
      captures += 1
      return captures === 1 ? MENU : 'working'
    })

    const result = await answerSessionPaneChoice(
      SESSION,
      { selectedIndex: 2, signature: SIGNATURE },
      deps,
    )

    expect(deps.sendKey.mock.calls.map(([, key]) => key)).toEqual(['Down', 'Down', 'Enter'])
    expect(result).toEqual({
      body: { ok: true, answeredLabel: "Don't ask me again" },
    })
  })
})
