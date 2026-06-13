import { describe, expect, it } from 'vitest'
import {
  buildAwaitingInputActivityMessage,
  isAwaitingInputRisingEdge,
} from '../agent-enrichment-service.js'
import type { AgentEnrichment } from '../../../../lib/agent-enrichment.js'

function makeEnrichment(pendingInputCount: number, pendingInputKinds: string[] = []): AgentEnrichment {
  return {
    role: 'work',
    hasPendingQuestion: pendingInputCount > 0,
    pendingQuestionCount: 0,
    pendingInputCount,
    pendingInputKinds: pendingInputKinds as AgentEnrichment['pendingInputKinds'],
    resolution: 'working',
    resolutionCount: 0,
  }
}

describe('isAwaitingInputRisingEdge', () => {
  it('returns true when pendingInputCount rises from 0 to greater than 0', () => {
    expect(isAwaitingInputRisingEdge(makeEnrichment(0), makeEnrichment(1, ['askUserQuestion']))).toBe(true)
  })

  it('returns true on the first enrichment when already blocked (absent previous treated as 0)', () => {
    expect(isAwaitingInputRisingEdge(undefined, makeEnrichment(2, ['rateLimit']))).toBe(true)
  })

  it('returns false when pendingInputCount stays at 0', () => {
    expect(isAwaitingInputRisingEdge(makeEnrichment(0), makeEnrichment(0))).toBe(false)
  })

  it('returns false when pendingInputCount stays above 0', () => {
    expect(isAwaitingInputRisingEdge(makeEnrichment(1, ['askUserQuestion']), makeEnrichment(1, ['askUserQuestion']))).toBe(false)
  })

  it('returns false when pendingInputCount decreases', () => {
    expect(isAwaitingInputRisingEdge(makeEnrichment(2, ['askUserQuestion']), makeEnrichment(0))).toBe(false)
  })
})

describe('buildAwaitingInputActivityMessage', () => {
  it('includes agent id, issue id, and kinds', () => {
    expect(buildAwaitingInputActivityMessage('agent-pan-123', 'PAN-123', ['rateLimit'])).toBe(
      'agent-pan-123 on PAN-123 is waiting for rateLimit',
    )
  })

  it('joins multiple kinds with commas', () => {
    expect(buildAwaitingInputActivityMessage('agent-pan-123', 'PAN-123', ['askUserQuestion', 'rateLimit'])).toBe(
      'agent-pan-123 on PAN-123 is waiting for askUserQuestion, rateLimit',
    )
  })

  it('omits issue id when undefined', () => {
    expect(buildAwaitingInputActivityMessage('agent-pan-123', undefined, ['rateLimit'])).toBe(
      'agent-pan-123 is waiting for rateLimit',
    )
  })

  it('falls back to generic input when kinds array is empty', () => {
    expect(buildAwaitingInputActivityMessage('agent-pan-123', 'PAN-123', [])).toBe(
      'agent-pan-123 on PAN-123 is waiting for input',
    )
  })
})
