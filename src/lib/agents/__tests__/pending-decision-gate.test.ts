import { describe, expect, it, vi } from 'vitest'

import { TmuxError } from '../../errors.js'
import {
  DESTRUCTIVE_RECOVERY_BLOCKING_REASONS,
  detectPendingOperatorDecision,
  type PendingOperatorDecisionDeps,
} from '../pending-decision-gate.js'

function createDeps(overrides: PendingOperatorDecisionDeps = {}): PendingOperatorDecisionDeps {
  return {
    sessionExists: vi.fn(async () => true),
    detectAwaitingInputForAgent: vi.fn(async () => null),
    countPendingAskUserQuestionsForCurrentAgentSession: vi.fn(async () => 0),
    warn: vi.fn(),
    ...overrides,
  }
}

describe('detectPendingOperatorDecision', () => {
  it('returns a pane decision for a live blocking permission prompt', async () => {
    const deps = createDeps({
      detectAwaitingInputForAgent: vi.fn(async () => ({
        reason: 'tool_permission',
        prompt: 'Allow this Bash command?',
      })),
    })

    await expect(detectPendingOperatorDecision('agent-pan-3228', deps)).resolves.toEqual({
      source: 'pane',
      reason: 'tool_permission',
      prompt: 'Allow this Bash command?',
    })
    expect(deps.countPendingAskUserQuestionsForCurrentAgentSession).not.toHaveBeenCalled()
  })

  it('does not treat rate limits as destructive-recovery blockers', async () => {
    const deps = createDeps({
      detectAwaitingInputForAgent: vi.fn(async () => ({
        reason: 'rate_limit',
        prompt: 'Keep current model or switch?',
      })),
    })

    await expect(detectPendingOperatorDecision('agent-pan-3228', deps)).resolves.toBeNull()
    expect(DESTRUCTIVE_RECOVERY_BLOCKING_REASONS.has('rate_limit')).toBe(false)
  })

  it('returns null when neither detector finds pending operator input', async () => {
    await expect(detectPendingOperatorDecision('agent-pan-3228', createDeps())).resolves.toBeNull()
  })

  it('finds unanswered AskUserQuestion state even without a live tmux session', async () => {
    const detectAwaitingInputForAgent = vi.fn(async () => null)
    const deps = createDeps({
      sessionExists: vi.fn(async () => false),
      detectAwaitingInputForAgent,
      countPendingAskUserQuestionsForCurrentAgentSession: vi.fn(async () => 1),
    })

    await expect(detectPendingOperatorDecision('agent-pan-3228', deps)).resolves.toEqual({
      source: 'jsonl-auq',
      reason: 'ask_user_question',
    })
    expect(detectAwaitingInputForAgent).not.toHaveBeenCalled()
  })

  it('fails open on TmuxError and continues to the JSONL detector', async () => {
    const warning = vi.fn()
    const deps = createDeps({
      detectAwaitingInputForAgent: vi.fn(async () => {
        throw new TmuxError({
          command: 'capture-pane',
          message: 'capture failed',
        })
      }),
      warn: warning,
    })

    await expect(detectPendingOperatorDecision('agent-pan-3228', deps)).resolves.toBeNull()
    expect(deps.countPendingAskUserQuestionsForCurrentAgentSession).toHaveBeenCalledWith('agent-pan-3228')
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('Pending operator decision pane check failed open for agent-pan-3228'),
    )
  })
})
