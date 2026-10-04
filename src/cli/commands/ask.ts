/**
 * `pan ask <ISSUE> "<question>" --option <a> --option <b>` — PAN-4383.
 *
 * A work agent blocked on an operator decision records it in the issue's
 * pipeline journal. The dashboard derives Needs-you, derived attention, God
 * View and the parked row from that entry; the answer arrives as a message in
 * the agent's session. `--withdraw` closes the agent's open request.
 */
import { existsSync } from 'node:fs'

import { exitCli } from '../exit.js'
import {
  readOpenOperatorDecision,
  requestOperatorDecision,
  withdrawOperatorDecision,
} from '../../lib/cloister/operator-decision.js'
import { resolveBareNumericId } from '../../lib/issue-id.js'
import { getIssueWorkspacePath } from '../../lib/overdeck/issue-projects.js'

const MIN_OPTIONS = 2
const MAX_OPTIONS = 4

export interface AskCommandOptions {
  option?: string[]
  context?: string
  withdraw?: boolean
}

export interface AskCommandDeps {
  getIssueWorkspacePath?: (issueId: string) => string | null
  log?: (message: string) => void
  error?: (message: string) => void
  exit?: (code: number) => Promise<void>
}

/** The commander action. Commander appends its `Command` as a trailing argument, so deps are never read from here. */
export async function askCommand(
  id: string,
  question: string | undefined,
  options: AskCommandOptions = {},
): Promise<void> {
  await runAskCommand(id, question, options)
}

export async function runAskCommand(
  id: string,
  question: string | undefined,
  options: AskCommandOptions = {},
  deps: AskCommandDeps = {},
): Promise<void> {
  const resolveWorkspace = deps.getIssueWorkspacePath ?? getIssueWorkspacePath
  const log = deps.log ?? console.log
  const error = deps.error ?? console.error
  const exit = deps.exit ?? (async (code: number) => { await exitCli(code) })

  const issueId = (resolveBareNumericId(id) ?? id).toUpperCase()
  const workspace = resolveWorkspace(issueId)
  if (!workspace || !existsSync(workspace)) {
    error(`No workspace for ${issueId}`)
    await exit(1)
    return
  }
  const agentId = (process.env.OVERDECK_AGENT_ID?.trim() || `agent-${issueId}`).toLowerCase()
  const open = readOpenOperatorDecision(workspace)

  if (options.withdraw) {
    if (!open) {
      error(`No open decision for ${issueId}`)
      await exit(1)
      return
    }
    withdrawOperatorDecision(workspace, open)
    log(`Withdrew ${open.questionId}.`)
    return
  }

  const text = question?.trim() ?? ''
  if (!text) {
    error('pan ask needs a non-empty question.')
    await exit(1)
    return
  }
  const choices = (options.option ?? []).map((label) => label.trim())
  if (choices.length < MIN_OPTIONS || choices.length > MAX_OPTIONS || choices.some((label) => !label)) {
    error(`pan ask needs ${MIN_OPTIONS}-${MAX_OPTIONS} non-empty --option values.`)
    await exit(1)
    return
  }

  if (open) log(`Superseding ${open.questionId}.`)
  const context = options.context?.trim()
  const decision = requestOperatorDecision(workspace, {
    issueId,
    agentId,
    question: text,
    options: choices,
    ...(context ? { context } : {}),
  })
  log(
    `Asked the operator (${decision.questionId}). It is in the dashboard's Needs-you now. `
    + 'Stop and wait: the answer arrives as a message in this session.',
  )
}
