import { describe, expect, it } from 'vitest'
import {
  buildAwaitingInputActivityMessage,
  isAwaitingInputRisingEdge,
  shouldForceReemitPendingInput,
} from '../agent-enrichment-service.js'
import type { AgentEnrichment } from '../../../../lib/agent-enrichment.js'

function makeEnrichment(
  pendingInputCount: number,
  pendingInputKinds: string[] = [],
  overrides: Partial<AgentEnrichment> = {},
): AgentEnrichment {
  return {
    role: 'work',
    hasPendingQuestion: pendingInputCount > 0,
    pendingQuestionCount: 0,
    pendingInputCount,
    pendingInputKinds: pendingInputKinds as AgentEnrichment['pendingInputKinds'],
    resolution: 'working',
    resolutionCount: 0,
    ...overrides,
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

describe('shouldForceReemitPendingInput', () => {
  it('returns true for stopped status with pendingAskUserQuestion', () => {
    const enrichment = makeEnrichment(0, [], { pendingAskUserQuestion: { toolUseId: 't1' } as any })
    expect(shouldForceReemitPendingInput('stopped', enrichment)).toBe(true)
  })

  it('returns true for stopped status with pendingProposedPlan', () => {
    const enrichment = makeEnrichment(0, [], { pendingProposedPlan: { toolUseId: 't2' } as any })
    expect(shouldForceReemitPendingInput('stopped', enrichment)).toBe(true)
  })

  it('returns true for stopped status with pendingInputCount > 0', () => {
    const enrichment = makeEnrichment(1, ['askUserQuestion'])
    expect(shouldForceReemitPendingInput('stopped', enrichment)).toBe(true)
  })

  it('returns false for running and starting status regardless of pending payload', () => {
    const enrichment = makeEnrichment(2, ['askUserQuestion', 'plan'], {
      pendingAskUserQuestion: { toolUseId: 't1' } as any,
      pendingProposedPlan: { toolUseId: 't2' } as any,
    })
    expect(shouldForceReemitPendingInput('running', enrichment)).toBe(false)
    expect(shouldForceReemitPendingInput('starting', enrichment)).toBe(false)
  })

  it('returns false for stopped status with empty enrichment', () => {
    const enrichment = makeEnrichment(0)
    expect(shouldForceReemitPendingInput('stopped', enrichment)).toBe(false)
  })
})

describe('forced re-emission does not re-trigger awaiting-input rising edge', () => {
  it('returns false when previous equals current with pendingInputCount > 0', () => {
    const enrichment = makeEnrichment(2, ['askUserQuestion'])
    expect(isAwaitingInputRisingEdge(enrichment, enrichment)).toBe(false)
  })
})
