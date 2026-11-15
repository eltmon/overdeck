/**
 * `deriveNarrative` (PAN-5310 FR-3): a closed issue's narrative reads plainly
 * — shipped, still has an open PR, or just closed — and never falls through
 * to the working/planning branches below it.
 */
import { describe, expect, it } from 'vitest'
import { deriveNarrative } from './StatusNarrative'
import type { DerivedIssueState } from '../../../types'

function closedIssue(overrides: Partial<DerivedIssueState> = {}): DerivedIssueState {
  return { issueId: 'PAN-1', state: 'closed', ...overrides }
}

describe('deriveNarrative for a closed issue (PAN-5310)', () => {
  it('reads shipped for a closed issue with a merged PR (ac1)', () => {
    const model = deriveNarrative({
      hasPlan: true,
      issue: closedIssue({ pr: { url: 'u', number: 5, reviewState: 'approved', checks: 'green', mergeable: true, merged: true } }),
      ci: undefined,
      plan: undefined,
      workRunning: false,
    })
    expect(model.headline).toBe('Shipped — this change is on main')
    expect(model.needsYou).toBe(false)
  })

  it('names the still-open PR for a closed issue (ac2)', () => {
    const model = deriveNarrative({
      hasPlan: true,
      issue: closedIssue({ pr: { url: 'u', number: 614, reviewState: 'review-requested', checks: 'pending', mergeable: null } }),
      ci: undefined,
      plan: undefined,
      workRunning: false,
    })
    expect(model.headline).toBe('Closed, but pull request #614 is still open — close or merge it')
    expect(model.needsYou).toBe(true)
  })

  it('reads Closed for a closed issue with no PR, never the working headline (ac3)', () => {
    const model = deriveNarrative({
      hasPlan: true,
      issue: closedIssue(),
      ci: undefined,
      plan: { done: 0, total: 13 },
      workRunning: true,
    })
    expect(model.headline).toBe('Closed')
  })

  it('reads Closed from trackerClosed alone, never the planning headline (ac4)', () => {
    const model = deriveNarrative({
      hasPlan: false,
      issue: undefined,
      ci: undefined,
      plan: undefined,
      workRunning: false,
      trackerClosed: true,
    })
    expect(model.headline).toBe('Closed')
  })

  it('keeps the working headline for a working issue (ac5)', () => {
    const model = deriveNarrative({
      hasPlan: true,
      issue: { issueId: 'PAN-1', state: 'working' },
      ci: undefined,
      plan: undefined,
      workRunning: true,
    })
    expect(model.headline.startsWith('The crew is writing code')).toBe(true)
  })
})
