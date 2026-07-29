import { exitCli } from '../exit.js'
import {
  answerSessionPaneChoice,
  captureSessionPaneChoice,
  type PendingPaneChoice,
  type SessionPaneChoiceResult,
} from '../../lib/session-pane-choice.js'

export interface AnswerCommandDeps {
  captureSessionPaneChoice?: (sessionName: string) => Promise<PendingPaneChoice | null>
  answerSessionPaneChoice?: (
    sessionName: string,
    body: { selectedIndex: number; signature: string },
  ) => Promise<SessionPaneChoiceResult>
  log?: (message: string) => void
  error?: (message: string) => void
  exit?: (code: number) => Promise<void>
}

export function normalizeAnswerSessionId(id: string): string {
  const normalized = id.trim().toLowerCase()
  if (/^(?:agent|planning|strike|review|test|ship|inspect|conv)-/.test(normalized)) {
    return normalized
  }
  return `agent-${normalized}`
}

function paneChoiceErrorMessage(result: SessionPaneChoiceResult): string {
  const code = result.body['code']
  if (code === 'menu-gone') return 'The pending choice menu is no longer on screen.'
  if (code === 'menu-changed') return 'The pending choice menu changed before it was answered. Run pan answer again to inspect the current options.'
  if (code === 'delivery-unconfirmed') return 'The answer keystrokes were sent, but the menu did not dismiss. Open the terminal and answer it there.'
  const error = result.body['error']
  return typeof error === 'string' ? error : 'The pending choice could not be answered.'
}

export async function answerCommand(
  id: string,
  option: string | undefined,
  deps: AnswerCommandDeps = {},
): Promise<void> {
  const sessionName = normalizeAnswerSessionId(id)
  const capture = deps.captureSessionPaneChoice ?? captureSessionPaneChoice
  const answer = deps.answerSessionPaneChoice ?? answerSessionPaneChoice
  const log = deps.log ?? console.log
  const error = deps.error ?? console.error
  const exit = deps.exit ?? (async (code: number) => { await exitCli(code) })

  const paneChoice = await capture(sessionName)
  if (!paneChoice) {
    error(`No pending choice menu for ${id}`)
    await exit(1)
    return
  }

  if (option === undefined) {
    log(paneChoice.title)
    for (const line of paneChoice.contextLines) log(line)
    for (const item of paneChoice.options) {
      log(`${item.number}. ${item.label}${item.recommended ? ' (recommended)' : ''}`)
    }
    if (paneChoice.footerHint) log(paneChoice.footerHint)
    return
  }

  const optionNumber = Number(option)
  if (!Number.isInteger(optionNumber)) {
    error(`Option must be one of the numbered choices shown by 'pan answer ${id}'.`)
    await exit(1)
    return
  }
  const selectedIndex = paneChoice.options.findIndex((item) => item.number === optionNumber)
  if (selectedIndex < 0) {
    error(`Option ${option} is not present in the pending choice menu for ${id}.`)
    await exit(1)
    return
  }

  const result = await answer(sessionName, {
    selectedIndex,
    signature: paneChoice.signature,
  })
  if (result.status !== undefined || result.body['ok'] !== true) {
    error(paneChoiceErrorMessage(result))
    await exit(1)
    return
  }

  log(`Answered ${id}: ${String(result.body['answeredLabel'])}`)
}
