/**
 * Unit tests for read model validator functions (PAN-434)
 *
 * These pure functions map untyped bootstrap data (from lib modules) to strict
 * typed literals. They're the gatekeeper between "dirty" external data and the
 * clean read model state.
 */

import { describe, it, expect } from 'vitest'
import {
  toAgentStatus,
  toRole,
  toAgentResolution,
  toSpecialistAgentName,
  toSpecialistLifecycleState,
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

// ─── toRole ──────────────────────────────────────────────────────────────────

describe('toRole', () => {
  it('passes through valid roles', () => {
    expect(toRole('plan')).toBe('plan')
    expect(toRole('work')).toBe('work')
    expect(toRole('review')).toBe('review')
    expect(toRole('test')).toBe('test')
    expect(toRole('ship')).toBe('ship')
    expect(toRole('flywheel')).toBe('flywheel')
    // PAN-1506: strike is a valid Role per packages/contracts. Dropping it
    // here caused strike agents to render with role=undefined in the
    // dashboard, which the frontend's Strike filter then could not match.
    expect(toRole('strike')).toBe('strike')
  })

  it('returns undefined for legacy phases and invalid values', () => {
    expect(toRole('planning')).toBeUndefined()
    expect(toRole('implementation')).toBeUndefined()
    expect(toRole('review-response')).toBeUndefined()
    expect(toRole('merge')).toBeUndefined()
    expect(toRole('WORK')).toBeUndefined()
    expect(toRole(null)).toBeUndefined()
    expect(toRole(undefined)).toBeUndefined()
    expect(toRole('')).toBeUndefined()
  })
})

// ─── toSpecialistAgentName ─────────────────────────────────────────────────────────

describe('toSpecialistAgentName', () => {
  it('passes through valid specialist names', () => {
    expect(toSpecialistAgentName('review-agent')).toBe('review-agent')
    expect(toSpecialistAgentName('test-agent')).toBe('test-agent')
    expect(toSpecialistAgentName('merge-agent')).toBe('merge-agent')
    expect(toSpecialistAgentName('inspect-agent')).toBe('inspect-agent')
    expect(toSpecialistAgentName('uat-agent')).toBe('uat-agent')
  })

  it('returns undefined for invalid values', () => {
    expect(toSpecialistAgentName('deploy-agent')).toBeUndefined()
    expect(toSpecialistAgentName('REVIEW-AGENT')).toBeUndefined()
    expect(toSpecialistAgentName(null)).toBeUndefined()
    expect(toSpecialistAgentName(undefined)).toBeUndefined()
    expect(toSpecialistAgentName('')).toBeUndefined()
  })
})

// ─── toSpecialistLifecycleState ────────────────────────────────────────────────────────

describe('toSpecialistLifecycleState', () => {
  it('passes through valid states', () => {
    expect(toSpecialistLifecycleState('active')).toBe('active')
    expect(toSpecialistLifecycleState('sleeping')).toBe('sleeping')
    expect(toSpecialistLifecycleState('uninitialized')).toBe('uninitialized')
  })

  it('returns "uninitialized" for invalid values', () => {
    expect(toSpecialistLifecycleState('idle')).toBe('uninitialized')
    expect(toSpecialistLifecycleState('ACTIVE')).toBe('uninitialized')
    expect(toSpecialistLifecycleState(null)).toBe('uninitialized')
    expect(toSpecialistLifecycleState(undefined)).toBe('uninitialized')
    expect(toSpecialistLifecycleState('')).toBe('uninitialized')
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

