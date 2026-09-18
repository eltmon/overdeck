/**
 * PAN-3766 follow-up — answer an ohmypi `ask` modal from the dashboard.
 *
 * The conversation message route cannot answer a pi ask: the control channel's
 * steer/prompt lands in pi's input queue, but the modal holds the UI, so the
 * answer is swallowed and the agent stays parked. The only way through is to
 * drive the modal itself with keystrokes, exactly like the codex-approval and
 * pane-choice paths do for their native menus.
 *
 * Safety model mirrors answerSessionPaneChoice: re-verify the live state before
 * touching the session (pending ask in the transcript, modal footer and
 * question text on screen, cursor position parsed from the pane), then confirm
 * the modal is gone afterwards. Any drift returns 409 and the operator answers
 * in the terminal instead.
 */
import { Effect } from 'effect'

import { scanPendingInputsPromise, type PendingInputsScan } from './agent-enrichment.js'
import { resolvePiSessionPath } from '../dashboard/server/routes/jsonl-resolver.js'
import { capturePaneText, sendRawKeystroke, sessionExists, tmuxExecAsync, exactPaneTarget } from './tmux.js'
import { randomUUID } from 'node:crypto'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PANE_CAPTURE_LINES = 90
const KEYSTROKE_GAP_MS = 60
const DELIVERY_CONFIRM_WAIT_MS = 700

/** The modal footer hint — the same signature the pane detector keys on. */
const PI_ASK_FOOTER_RE = /Enter\s+select\b.*Esc\s+cancel/i
/** Cursor on a numbered option: "❯ ○ 1 · Label" (boxed) or "❯ 1 - Label". */
const PI_ASK_CURSOR_NUMBERED_RE = /❯\s*○?\s*(\d+)\s*[·.\-]/
const PI_ASK_CURSOR_OTHER_RE = /❯\s*○?\s*Other\b/i

export interface PiAskModalDeps {
  capture?: (sessionName: string, lines: number) => Promise<string>
  sendKey?: (sessionName: string, key: string) => Promise<void>
  sendText?: (sessionName: string, text: string) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  sessionExists?: (sessionName: string) => Promise<boolean>
  resolveTranscript?: (sessionName: string) => Promise<string | null>
  scanTranscript?: (jsonlPath: string) => Promise<PendingInputsScan>
}

export interface PiAskModalResult {
  body: Record<string, unknown>
  status?: number
}

/** Strip box-drawing chrome and collapse whitespace so wrapped pane lines compare cleanly. */
function normalizePaneText(text: string): string {
  return text
    .replace(/[╭╮╰╯│├┤┌┐└┘─┬┴┼]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Paste text into the modal's Other input — no Enter; the caller sends that separately. */
async function pasteTextIntoSession(sessionName: string, text: string): Promise<void> {
  const sendId = randomUUID()
  const tmpFile = join(tmpdir(), `pan-pi-ask-${sendId}.txt`)
  const bufferName = `pan-pi-ask-${sendId}`
  try {
    await writeFile(tmpFile, text, 'utf-8')
    await tmuxExecAsync(['load-buffer', '-b', bufferName, tmpFile], { encoding: 'utf-8' })
    await tmuxExecAsync(['paste-buffer', '-b', bufferName, '-p', '-t', exactPaneTarget(sessionName)], { encoding: 'utf-8' })
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
}

/**
 * The cursor's current item position (0-based): numbered options come first,
 * then "Other (type your own)" as the final item. Null when unparseable.
 */
function piAskCursorPosition(pane: string, optionCount: number): number | null {
  const lines = pane.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    const numbered = PI_ASK_CURSOR_NUMBERED_RE.exec(line)
    if (numbered) {
      const n = Number(numbered[1])
      if (n >= 1 && n <= optionCount) return n - 1
      return null
    }
    if (PI_ASK_CURSOR_OTHER_RE.test(line)) return optionCount
  }
  return null
}

export async function answerPiAskModal(
  sessionName: string,
  body: Record<string, unknown>,
  deps: PiAskModalDeps = {},
): Promise<PiAskModalResult> {
  try {
    const toolUseId = typeof body['toolUseId'] === 'string' ? body['toolUseId'] : ''
    if (!toolUseId) return { body: { error: 'toolUseId is required' }, status: 400 }
    const answers = body['answers']
    if (!Array.isArray(answers) || answers.length !== 1 || typeof answers[0] !== 'string' || !answers[0].trim()) {
      return { body: { error: 'answers must contain exactly one non-empty string' }, status: 400 }
    }
    const answer = answers[0].trim()

    const isSessionRunning = deps.sessionExists
      ?? ((name: string) => Effect.runPromise(sessionExists(name)))
    if (!(await isSessionRunning(sessionName))) {
      return { body: { error: 'Conversation session is not running' }, status: 409 }
    }

    const resolveTranscript = deps.resolveTranscript ?? ((name: string) => resolvePiSessionPath(name))
    const scanTranscript = deps.scanTranscript ?? scanPendingInputsPromise
    const transcript = await resolveTranscript(sessionName)
    const scan = transcript ? await scanTranscript(transcript) : null
    const pending = scan?.askUserQuestions.find((q) => q.toolId === toolUseId)
    if (!pending) {
      return { body: { error: 'The question is no longer pending — it was answered or superseded', code: 'ask-gone' }, status: 409 }
    }
    if (pending.questions.length !== 1) {
      return {
        body: { error: 'This ask has multiple questions; answer it in the terminal', code: 'multi-question-unsupported' },
        status: 409,
      }
    }
    const question = pending.questions[0]!

    const capture = deps.capture ?? capturePaneText
    const sendKey = deps.sendKey
      ?? ((name: string, key: string) => Effect.runPromise(sendRawKeystroke(name, key, 'pi-ask-answer')))
    const sendText = deps.sendText ?? pasteTextIntoSession
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

    // Drift guard: the modal must still be on screen, showing this question.
    const pane = await capture(sessionName, PANE_CAPTURE_LINES)
    if (!PI_ASK_FOOTER_RE.test(pane)) {
      return { body: { error: 'The ask modal is no longer on screen', code: 'modal-gone' }, status: 409 }
    }
    const paneNorm = normalizePaneText(pane)
    const questionNorm = normalizePaneText(question.question).slice(0, 40)
    if (questionNorm.length >= 12 && !paneNorm.includes(questionNorm)) {
      return { body: { error: 'The ask modal changed since the dialog was rendered — refresh and re-answer', code: 'modal-changed' }, status: 409 }
    }

    // Map the answer to a modal item. A label matching an option picks that
    // option; anything else is free text routed through "Other (type your own)".
    const optionIndex = question.options.findIndex((o) => o.label.trim() === answer)
    const isCustomText = optionIndex < 0
    const targetPosition = isCustomText ? question.options.length : optionIndex

    const cursor = piAskCursorPosition(pane, question.options.length)
    if (cursor === null) {
      return { body: { error: 'Could not read the modal cursor — answer it from the terminal', code: 'cursor-unknown' }, status: 409 }
    }

    const delta = targetPosition - cursor
    const navKey = delta > 0 ? 'Down' : 'Up'
    for (let i = 0; i < Math.abs(delta); i++) {
      await sendKey(sessionName, navKey)
      await sleep(KEYSTROKE_GAP_MS)
    }
    await sendKey(sessionName, 'Enter')
    if (isCustomText) {
      await sleep(KEYSTROKE_GAP_MS * 3)
      await sendText(sessionName, answer)
      await sleep(KEYSTROKE_GAP_MS)
      await sendKey(sessionName, 'Enter')
    }

    await sleep(DELIVERY_CONFIRM_WAIT_MS)
    const after = await capture(sessionName, PANE_CAPTURE_LINES)
    if (PI_ASK_FOOTER_RE.test(after)) {
      return { body: { error: 'Keystrokes were sent but the modal is still on screen — answer it from the terminal', code: 'delivery-unconfirmed' }, status: 409 }
    }
    return { body: { ok: true, answeredLabel: isCustomText ? answer : question.options[optionIndex]!.label } }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[sessions] pi-ask answer failed:', message)
    return { body: { error: 'Internal server error' }, status: 500 }
  }
}
