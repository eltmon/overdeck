import { describe, expect, it } from 'vitest'
import { appendPaneDetectionKind, isOwnActiveSpecialist, type PendingInputKind } from '../agent-enrichment.js'

describe('appendPaneDetectionKind', () => {
  it('adds rateLimit for a rate_limit pane detection', () => {
    const kinds: PendingInputKind[] = []
    appendPaneDetectionKind({ reason: 'rate_limit', prompt: 'Switch model?' }, kinds)
    expect(kinds).toEqual(['rateLimit'])
  })

  it('adds sessionResume for a session_resume pane detection', () => {
    const kinds: PendingInputKind[] = []
    appendPaneDetectionKind({ reason: 'session_resume', prompt: 'Resume?' }, kinds)
    expect(kinds).toEqual(['sessionResume'])
  })

  it('does not duplicate an existing kind', () => {
    const kinds: PendingInputKind[] = ['sessionResume']
    appendPaneDetectionKind({ reason: 'session_resume', prompt: 'Resume?' }, kinds)
    expect(kinds).toEqual(['sessionResume'])
  })

  it('does nothing for other pane reasons', () => {
    const kinds: PendingInputKind[] = []
    appendPaneDetectionKind({ reason: 'tool_permission', prompt: 'Allow?' }, kinds)
    expect(kinds).toEqual([])
  })

  it('does nothing when detection is null', () => {
    const kinds: PendingInputKind[] = []
    appendPaneDetectionKind(null, kinds)
    expect(kinds).toEqual([])
  })
})

describe('isOwnActiveSpecialist', () => {
  it('returns true for review, test, and ship roles', () => {
    expect(isOwnActiveSpecialist('review')).toBe(true)
    expect(isOwnActiveSpecialist('test')).toBe(true)
    expect(isOwnActiveSpecialist('ship')).toBe(true)
  })

  it('returns false for work, plan, flywheel, and undefined roles', () => {
    expect(isOwnActiveSpecialist('work')).toBe(false)
    expect(isOwnActiveSpecialist('plan')).toBe(false)
    expect(isOwnActiveSpecialist('flywheel')).toBe(false)
    expect(isOwnActiveSpecialist(undefined)).toBe(false)
  })
})
