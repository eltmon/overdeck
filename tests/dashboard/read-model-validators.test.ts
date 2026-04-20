/**
 * Unit tests for read model validator functions (PAN-434)
 *
 * These pure functions map untyped bootstrap data (from lib modules) to strict
 * typed literals. They're the gatekeeper between "dirty" external data and the
 * clean read model state.
 */

import { describe, it, expect } from 'vitest'
import type { ReviewStatus } from '../../src/lib/review-status.js'
import {
  toAgentStatus,
  toAgentPhase,
  toAgentResolution,
  toSpecialistType,
  toSpecialistState,
  toReviewStatus,
  toTestStatus,
  toMergeStatus,
  toVerificationStatus,
  toReviewStatusSnapshot,
} from '../../src/dashboard/server/read-model.js'

// ─── toAgentStatus ────────────────────────────────────────────────────────────

describe('toAgentStatus', () => {
  it('passes through valid statuses', () => {
    expect(toAgentStatus('starting')).toBe('starting')
    expect(toAgentStatus('running')).toBe('running')
    expect(toAgentStatus('stopped')).toBe('stopped')
    expect(toAgentStatus('error')).toBe('error')
    expect(toAgentStatus('unknown')).toBe('unknown')
  })

  it('returns "unknown" for invalid values', () => {
    expect(toAgentStatus('idle')).toBe('unknown')
    expect(toAgentStatus('RUNNING')).toBe('unknown')
    expect(toAgentStatus(null)).toBe('unknown')
    expect(toAgentStatus(undefined)).toBe('unknown')
    expect(toAgentStatus(42)).toBe('unknown')
    expect(toAgentStatus('')).toBe('unknown')
  })
})

// ─── toAgentPhase ─────────────────────────────────────────────────────────────

describe('toAgentPhase', () => {
  it('passes through valid phases', () => {
    expect(toAgentPhase('planning')).toBe('planning')
    expect(toAgentPhase('exploration')).toBe('exploration')
    expect(toAgentPhase('implementation')).toBe('implementation')
    expect(toAgentPhase('testing')).toBe('testing')
    expect(toAgentPhase('documentation')).toBe('documentation')
    expect(toAgentPhase('pre_push')).toBe('pre_push')
    expect(toAgentPhase('post_push')).toBe('post_push')
  })

  it('passes through specialist/work-agent phases (review, review-response, merge)', () => {
    expect(toAgentPhase('review')).toBe('review')
    expect(toAgentPhase('review-response')).toBe('review-response')
    expect(toAgentPhase('merge')).toBe('merge')
  })

  it('returns undefined for invalid values', () => {
    expect(toAgentPhase('coding')).toBeUndefined()
    expect(toAgentPhase('IMPLEMENTATION')).toBeUndefined()
    expect(toAgentPhase(null)).toBeUndefined()
    expect(toAgentPhase(undefined)).toBeUndefined()
    expect(toAgentPhase('')).toBeUndefined()
  })

  // Regression: persisted review/merge phases must survive snapshot bootstrap.
  // Before the fix, VALID_AGENT_PHASES only contained work-agent phases
  // (planning…post_push), so toAgentPhase('review') returned undefined and the
  // phase was silently dropped when hydrating agent snapshots after a restart.
  it('regression: persisted review/merge phases are not silently dropped on bootstrap', () => {
    for (const phase of ['review', 'review-response', 'merge'] as const) {
      const result = toAgentPhase(phase)
      expect(result, `phase '${phase}' must not be dropped by toAgentPhase`).toBe(phase)
    }
  })
})

// ─── toSpecialistType ─────────────────────────────────────────────────────────

describe('toSpecialistType', () => {
  it('passes through valid specialist types', () => {
    expect(toSpecialistType('review-agent')).toBe('review-agent')
    expect(toSpecialistType('test-agent')).toBe('test-agent')
    expect(toSpecialistType('merge-agent')).toBe('merge-agent')
    expect(toSpecialistType('inspect-agent')).toBe('inspect-agent')
    expect(toSpecialistType('uat-agent')).toBe('uat-agent')
  })

  it('returns undefined for invalid values', () => {
    expect(toSpecialistType('deploy-agent')).toBeUndefined()
    expect(toSpecialistType('REVIEW-AGENT')).toBeUndefined()
    expect(toSpecialistType(null)).toBeUndefined()
    expect(toSpecialistType(undefined)).toBeUndefined()
    expect(toSpecialistType('')).toBeUndefined()
  })
})

// ─── toSpecialistState ────────────────────────────────────────────────────────

describe('toSpecialistState', () => {
  it('passes through valid states', () => {
    expect(toSpecialistState('active')).toBe('active')
    expect(toSpecialistState('sleeping')).toBe('sleeping')
    expect(toSpecialistState('uninitialized')).toBe('uninitialized')
  })

  it('returns "uninitialized" for invalid values', () => {
    expect(toSpecialistState('idle')).toBe('uninitialized')
    expect(toSpecialistState('ACTIVE')).toBe('uninitialized')
    expect(toSpecialistState(null)).toBe('uninitialized')
    expect(toSpecialistState(undefined)).toBe('uninitialized')
    expect(toSpecialistState('')).toBe('uninitialized')
  })
})

// ─── toReviewStatus ───────────────────────────────────────────────────────────

describe('toReviewStatus', () => {
  it('passes through valid review statuses', () => {
    expect(toReviewStatus('pending')).toBe('pending')
    expect(toReviewStatus('reviewing')).toBe('reviewing')
    expect(toReviewStatus('passed')).toBe('passed')
    expect(toReviewStatus('failed')).toBe('failed')
    expect(toReviewStatus('blocked')).toBe('blocked')
  })

  it('returns undefined for invalid values', () => {
    expect(toReviewStatus('in-progress')).toBeUndefined()
    expect(toReviewStatus('PASSED')).toBeUndefined()
    expect(toReviewStatus(null)).toBeUndefined()
    expect(toReviewStatus(undefined)).toBeUndefined()
    expect(toReviewStatus('')).toBeUndefined()
  })
})

// ─── toTestStatus ─────────────────────────────────────────────────────────────

describe('toTestStatus', () => {
  it('passes through valid test statuses', () => {
    expect(toTestStatus('pending')).toBe('pending')
    expect(toTestStatus('testing')).toBe('testing')
    expect(toTestStatus('passed')).toBe('passed')
    expect(toTestStatus('failed')).toBe('failed')
    expect(toTestStatus('skipped')).toBe('skipped')
    expect(toTestStatus('dispatch_failed')).toBe('dispatch_failed')
  })

  it('returns undefined for invalid values', () => {
    expect(toTestStatus('running')).toBeUndefined()
    expect(toTestStatus('PASSED')).toBeUndefined()
    expect(toTestStatus(null)).toBeUndefined()
    expect(toTestStatus(undefined)).toBeUndefined()
  })
})

// ─── toAgentResolution ────────────────────────────────────────────────────────

describe('toAgentResolution', () => {
  it('passes through valid resolutions', () => {
    expect(toAgentResolution('working')).toBe('working')
    expect(toAgentResolution('done')).toBe('done')
    expect(toAgentResolution('needs_input')).toBe('needs_input')
    expect(toAgentResolution('stuck')).toBe('stuck')
    expect(toAgentResolution('completed')).toBe('completed')
    expect(toAgentResolution('unclear')).toBe('unclear')
  })

  it('returns undefined for invalid values', () => {
    expect(toAgentResolution('idle')).toBeUndefined()
    expect(toAgentResolution('DONE')).toBeUndefined()
    expect(toAgentResolution(null)).toBeUndefined()
    expect(toAgentResolution(undefined)).toBeUndefined()
    expect(toAgentResolution('')).toBeUndefined()
  })
})

// ─── toMergeStatus ────────────────────────────────────────────────────────────

describe('toMergeStatus', () => {
  it('passes through valid merge statuses', () => {
    expect(toMergeStatus('pending')).toBe('pending')
    expect(toMergeStatus('merging')).toBe('merging')
    expect(toMergeStatus('merged')).toBe('merged')
    expect(toMergeStatus('failed')).toBe('failed')
  })

  it('returns undefined for invalid values', () => {
    expect(toMergeStatus('complete')).toBeUndefined()
    expect(toMergeStatus('MERGED')).toBeUndefined()
    expect(toMergeStatus(null)).toBeUndefined()
    expect(toMergeStatus(undefined)).toBeUndefined()
  })
})

describe('toVerificationStatus', () => {
  it('passes through valid verification statuses', () => {
    expect(toVerificationStatus('pending')).toBe('pending')
    expect(toVerificationStatus('running')).toBe('running')
    expect(toVerificationStatus('passed')).toBe('passed')
    expect(toVerificationStatus('failed')).toBe('failed')
    expect(toVerificationStatus('skipped')).toBe('skipped')
  })

  it('returns undefined for invalid values', () => {
    expect(toVerificationStatus('error')).toBeUndefined()
    expect(toVerificationStatus('FAILED')).toBeUndefined()
    expect(toVerificationStatus(null)).toBeUndefined()
    expect(toVerificationStatus(undefined)).toBeUndefined()
  })
})

// ─── toReviewStatusSnapshot ──────────────────────────────────────────────────

describe('toReviewStatusSnapshot', () => {
  it('preserves authoritative readyForMerge=false from persisted review status', () => {
    const status: Pick<ReviewStatus, 'issueId' | 'reviewStatus' | 'testStatus' | 'mergeStatus' | 'verificationStatus' | 'verificationNotes' | 'verificationCycleCount' | 'readyForMerge' | 'updatedAt' | 'prUrl'> = {
      issueId: 'PAN-486',
      reviewStatus: 'passed',
      testStatus: 'passed',
      mergeStatus: 'failed',
      verificationStatus: 'failed',
      verificationNotes: 'frontend-typecheck failed',
      verificationCycleCount: 2,
      readyForMerge: false,
      updatedAt: '2026-04-11T17:00:00.000Z',
      prUrl: 'https://github.com/eltmon/panopticon-cli/pull/486',
    }
    const snapshot = toReviewStatusSnapshot(status)

    expect(snapshot.readyForMerge).toBe(false)
    expect(snapshot.mergeStatus).toBe('failed')
    expect(snapshot.verificationStatus).toBe('failed')
    expect(snapshot.verificationNotes).toBe('frontend-typecheck failed')
    expect(snapshot.verificationCycleCount).toBe(2)
    expect(snapshot.prUrl).toContain('/pull/486')
  })
})
