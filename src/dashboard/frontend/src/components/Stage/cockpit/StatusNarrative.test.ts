/**
 * PAN-5279 · the Details narrative for an open epic between slices. An epic
 * lands in slices, so one merged slice is progress, never "Shipped".
 */
import { describe, expect, it } from 'vitest'

import { deriveNarrative } from './StatusNarrative'
import type { DerivedIssueState } from '../../../types'

const epic: DerivedIssueState = {
  issueId: 'PAN-4753',
  state: 'planned',
  mergedSlice: { number: 5254, url: 'https://github.com/eltmon/overdeck/pull/5254' },
}

describe('deriveNarrative', () => {
  it('deriveNarrative does not say Shipped for an open epic with remaining plan items', () => {
    const model = deriveNarrative({ hasPlan: true, issue: epic, ci: undefined, plan: { done: 2, total: 13 }, workRunning: false })
    expect(model.headline).not.toMatch(/Shipped/)
    expect(model.headline).toBe('Slice merged (#5254) — 2 of 13 tasks done')
    expect(model.next).not.toMatch(/closing the issue out/)
  })

  it('names the slice when the plan has no counts', () => {
    const model = deriveNarrative({ hasPlan: true, issue: epic, ci: undefined, plan: undefined, workRunning: false })
    expect(model.headline).toBe('Slice merged (#5254) — more slices to land')
  })

  it('shows the crew at work once the next slice is running', () => {
    const model = deriveNarrative({ hasPlan: true, issue: { ...epic, state: 'working' }, ci: undefined, plan: { done: 2, total: 13 }, workRunning: true })
    expect(model.headline).toBe('The crew is writing code — 2 of 13 tasks done')
  })

  it('still says Shipped for a merged non-epic issue', () => {
    const model = deriveNarrative({ hasPlan: true, issue: { issueId: 'PAN-1', state: 'merged' }, ci: undefined, plan: undefined, workRunning: false })
    expect(model.headline).toBe('Shipped — this change is on main')
  })
})
