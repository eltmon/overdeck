import { describe, expect, it } from 'vitest'
import {
  appendPaneDetectionKind,
  isBlockedOnPendingInput,
  isOwnActiveSpecialist,
  type PendingInputKind,
} from '../agent-enrichment.js'

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

  // PAN-3070 — the pane-detected permission prompt is the only evidence the
  // supervisor era produces, and it has to become a kind here or every consumer
  // of pendingInputKinds reports the frozen agent as working.
  it('adds permissionRequest for a tool_permission pane detection', () => {
    const kinds: PendingInputKind[] = []
    appendPaneDetectionKind({ reason: 'tool_permission', prompt: 'Allow?' }, kinds)
    expect(kinds).toEqual(['permissionRequest'])
  })

  it('does not duplicate an existing permissionRequest kind', () => {
    const kinds: PendingInputKind[] = ['permissionRequest']
    appendPaneDetectionKind({ reason: 'tool_permission', prompt: 'Allow?' }, kinds)
    expect(kinds).toEqual(['permissionRequest'])
  })

  it('does nothing for other pane reasons', () => {
    const kinds: PendingInputKind[] = []
    appendPaneDetectionKind({ reason: 'other', prompt: 'Waiting' }, kinds)
    expect(kinds).toEqual([])
  })

  it('does nothing when detection is null', () => {
    const kinds: PendingInputKind[] = []
    appendPaneDetectionKind(null, kinds)
    expect(kinds).toEqual([])
  })

  // PAN-3233 — question-family detections previously yielded no kind, making
  // the agent invisible to Decisions and unreapable.
  it.each(['user_question', 'confirmation', 'disambiguation', 'planning_done'] as const)(
    'adds paneQuestion for a %s detection',
    (reason) => {
      const kinds: PendingInputKind[] = []
      appendPaneDetectionKind({ reason, prompt: 'Which one?' }, kinds)
      expect(kinds).toEqual(['paneQuestion'])
    },
  )

  it('does not duplicate an existing paneQuestion kind', () => {
    const kinds: PendingInputKind[] = ['paneQuestion']
    appendPaneDetectionKind({ reason: 'user_question', prompt: 'Which one?' }, kinds)
    expect(kinds).toEqual(['paneQuestion'])
  })

  it('does not add paneQuestion when a JSONL askUserQuestion kind is already present', () => {
    const kinds: PendingInputKind[] = ['askUserQuestion']
    appendPaneDetectionKind({ reason: 'user_question', prompt: 'Which one?' }, kinds)
    expect(kinds).toEqual(['askUserQuestion'])
  })
})

describe('isBlockedOnPendingInput', () => {
  it('reports an agent parked on a tool-permission prompt as blocked', () => {
    expect(isBlockedOnPendingInput({
      hasPendingQuestion: true,
      pendingQuestionReason: 'tool_permission',
    })).toBe(true)
  })

  it('reports every other answerable blocking reason as blocked', () => {
    for (const reason of ['user_question', 'disambiguation', 'confirmation', 'planning_done', 'session_resume', 'rate_limit']) {
      expect(isBlockedOnPendingInput({ hasPendingQuestion: true, pendingQuestionReason: reason })).toBe(true)
    }
  })

  // PAN-1591 — the generic fallbacks set reason 'other' with no answerable
  // prompt behind them; treating those as blocked would report working agents
  // as stuck, which is the mirror image of the bug this fixes.
  it('does NOT treat the generic `other` fallback as blocked', () => {
    expect(isBlockedOnPendingInput({ hasPendingQuestion: true, pendingQuestionReason: 'other' })).toBe(false)
  })

  it('is false when nothing is pending', () => {
    expect(isBlockedOnPendingInput({ hasPendingQuestion: false, pendingQuestionReason: 'tool_permission' })).toBe(false)
    expect(isBlockedOnPendingInput({})).toBe(false)
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
