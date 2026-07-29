import { Effect } from 'effect'

import {
  buildChoiceKeystrokes,
  paneChoiceMenuSignature,
  parsePaneChoiceMenu,
  type PaneChoiceConfidence,
} from './pane-choice-menu.js'
import { capturePaneText, sendRawKeystroke, sessionExists } from './tmux.js'

const PANE_CAPTURE_LINES = 90
const KEYSTROKE_GAP_MS = 60
const DELIVERY_CONFIRM_WAIT_MS = 700

export interface PendingPaneChoiceOption {
  number: number
  label: string
  recommended: boolean
}

export interface PendingPaneChoice {
  /** Stable identity of the parsed menu — answers must match what is on screen. */
  signature: string
  title: string
  contextLines: string[]
  options: PendingPaneChoiceOption[]
  selectedIndex: number
  footerHint: string | null
  confidence: PaneChoiceConfidence
}

export interface SessionPaneChoiceDeps {
  capture?: (sessionName: string, lines: number) => Promise<string>
  sendKey?: (sessionName: string, key: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  sessionExists?: (sessionName: string) => Promise<boolean>
}

export interface SessionPaneChoiceAnswer {
  selectedIndex: number
  signature: string
}

export interface SessionPaneChoiceResult {
  body: Record<string, unknown>
  status?: number
}

export async function captureSessionPaneChoice(
  sessionName: string,
  capture: (sessionName: string, lines: number) => Promise<string> = capturePaneText,
): Promise<PendingPaneChoice | null> {
  let pane: string
  try {
    pane = await capture(sessionName, PANE_CAPTURE_LINES)
  } catch {
    return null
  }
  const menu = parsePaneChoiceMenu(pane)
  if (!menu) return null
  return {
    signature: paneChoiceMenuSignature(menu),
    title: menu.title,
    contextLines: menu.contextLines,
    options: menu.options.map((option) => ({
      number: option.number,
      label: option.label,
      recommended: option.recommended,
    })),
    selectedIndex: menu.selectedIndex,
    footerHint: menu.footerHint,
    confidence: menu.confidence,
  }
}

export async function answerSessionPaneChoice(
  sessionName: string,
  body: Record<string, unknown> | SessionPaneChoiceAnswer,
  deps: SessionPaneChoiceDeps = {},
): Promise<SessionPaneChoiceResult> {
  try {
    const selectedIndex = Number(body.selectedIndex)
    const signature = typeof body.signature === 'string' ? body.signature : ''
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 8) {
      return { body: { error: 'selectedIndex must be an integer 0-8' }, status: 400 }
    }
    if (!signature) {
      return { body: { error: 'signature is required' }, status: 400 }
    }

    const isSessionRunning = deps.sessionExists
      ?? ((name: string) => Effect.runPromise(sessionExists(name)))
    if (!(await isSessionRunning(sessionName))) {
      return { body: { error: 'Conversation session is not running' }, status: 409 }
    }

    const capture = deps.capture ?? capturePaneText
    const sendKey = deps.sendKey
      ?? ((name: string, key: string) => Effect.runPromise(sendRawKeystroke(name, key, 'pane-choice')))
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

    const pane = await capture(sessionName, PANE_CAPTURE_LINES)
    const menu = parsePaneChoiceMenu(pane)
    if (!menu) {
      return { body: { error: 'The choice menu is no longer on screen', code: 'menu-gone' }, status: 409 }
    }
    if (paneChoiceMenuSignature(menu) !== signature) {
      return { body: { error: 'The choice menu changed since the card was rendered — refresh and re-answer', code: 'menu-changed' }, status: 409 }
    }
    if (selectedIndex >= menu.options.length) {
      return { body: { error: `selectedIndex out of range (0-${menu.options.length - 1})` }, status: 400 }
    }

    const keys = buildChoiceKeystrokes(menu, selectedIndex)
    for (const key of keys) {
      await sendKey(sessionName, key)
      await sleep(KEYSTROKE_GAP_MS)
    }

    await sleep(DELIVERY_CONFIRM_WAIT_MS)
    const after = parsePaneChoiceMenu(await capture(sessionName, PANE_CAPTURE_LINES))
    if (after && paneChoiceMenuSignature(after) === signature) {
      return { body: { error: 'Keystrokes were sent but the menu is still on screen — answer it from the terminal', code: 'delivery-unconfirmed' }, status: 409 }
    }
    return { body: { ok: true, answeredLabel: menu.options[selectedIndex]!.label } }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[sessions] pane-choice answer failed:', message)
    return { body: { error: 'Internal server error' }, status: 500 }
  }
}
