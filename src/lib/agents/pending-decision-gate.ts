import { Effect } from 'effect'

import { countPendingAskUserQuestionsForCurrentAgentSession as countPendingAskUserQuestionsForCurrentAgentSessionEffect } from '../agent-enrichment.js'
import {
  detectAwaitingInputForAgent as detectAwaitingInputForAgentEffect,
  type AwaitingInputDetection,
  type AwaitingInputReason,
} from '../agent-input-detection.js'
import { TmuxError } from '../errors.js'
import { sessionExists as sessionExistsEffect } from '../tmux.js'

export interface PendingOperatorDecision {
  source: 'pane' | 'jsonl-auq'
  reason: AwaitingInputReason | 'ask_user_question'
  prompt?: string
}

export const DESTRUCTIVE_RECOVERY_BLOCKING_REASONS: ReadonlySet<AwaitingInputReason> = new Set([
  'tool_permission',
  'user_question',
  'disambiguation',
  'confirmation',
  'planning_done',
  'session_resume',
])

export interface PendingOperatorDecisionDeps {
  sessionExists?: (agentId: string) => Promise<boolean>
  detectAwaitingInputForAgent?: (agentId: string) => Promise<AwaitingInputDetection | null>
  countPendingAskUserQuestionsForCurrentAgentSession?: (agentId: string) => Promise<number>
  warn?: (message: string) => void
}

export async function detectPendingOperatorDecision(
  agentId: string,
  deps: PendingOperatorDecisionDeps = {},
): Promise<PendingOperatorDecision | null> {
  const sessionExists = deps.sessionExists
    ?? ((id: string) => Effect.runPromise(sessionExistsEffect(id)))
  const detectAwaitingInputForAgent = deps.detectAwaitingInputForAgent
    ?? ((id: string) => Effect.runPromise(detectAwaitingInputForAgentEffect(id)))
  const countPendingAskUserQuestionsForCurrentAgentSession = deps.countPendingAskUserQuestionsForCurrentAgentSession
    ?? ((id: string) => Effect.runPromise(countPendingAskUserQuestionsForCurrentAgentSessionEffect(id)))
  const warn = deps.warn ?? console.warn

  let liveSession = false
  try {
    liveSession = await sessionExists(agentId)
  } catch (error) {
    if (!(error instanceof TmuxError)) throw error
    warn(`[agents] Pending operator decision pane check failed open for ${agentId}: ${error.message}`)
  }

  if (liveSession) {
    try {
      const detection = await detectAwaitingInputForAgent(agentId)
      if (detection && DESTRUCTIVE_RECOVERY_BLOCKING_REASONS.has(detection.reason)) {
        return {
          source: 'pane',
          reason: detection.reason,
          prompt: detection.prompt,
        }
      }
    } catch (error) {
      if (!(error instanceof TmuxError)) throw error
      warn(`[agents] Pending operator decision pane check failed open for ${agentId}: ${error.message}`)
    }
  }

  const pendingAskUserQuestions = await countPendingAskUserQuestionsForCurrentAgentSession(agentId)
  if (pendingAskUserQuestions > 0) {
    return {
      source: 'jsonl-auq',
      reason: 'ask_user_question',
    }
  }

  return null
}
