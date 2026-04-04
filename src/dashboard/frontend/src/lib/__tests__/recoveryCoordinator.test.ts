/**
 * Unit tests for RecoveryCoordinator (PAN-434)
 *
 * Covers the sequence gap detection and replay orchestration state machine.
 * All tests use pure function calls — no mocks needed.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createRecoveryCoordinator, type RecoveryCoordinator } from '../recoveryCoordinator'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bootstrapped(sequence = 10): RecoveryCoordinator {
  const c = createRecoveryCoordinator()
  c.beginSnapshotRecovery('bootstrap')
  c.completeSnapshotRecovery(sequence)
  return c
}

// ─── Initial state ────────────────────────────────────────────────────────────

describe('createRecoveryCoordinator — initial state', () => {
  it('starts unbootstrapped with sequence 0', () => {
    const c = createRecoveryCoordinator()
    const s = c.getState()
    expect(s.bootstrapped).toBe(false)
    expect(s.latestSequence).toBe(0)
    expect(s.highestObservedSequence).toBe(0)
    expect(s.pendingReplay).toBe(false)
    expect(s.inFlight).toBeNull()
  })
})

// ─── classifyDomainEvent ─────────────────────────────────────────────────────

describe('classifyDomainEvent — before bootstrap', () => {
  it('defers all events before bootstrap', () => {
    const c = createRecoveryCoordinator()
    expect(c.classifyDomainEvent(1)).toBe('defer')
    expect(c.classifyDomainEvent(5)).toBe('defer')
    expect(c.classifyDomainEvent(100)).toBe('defer')
  })

  it('sets pendingReplay when deferring', () => {
    const c = createRecoveryCoordinator()
    c.classifyDomainEvent(1)
    expect(c.getState().pendingReplay).toBe(true)
  })

  it('tracks highestObservedSequence while deferring', () => {
    const c = createRecoveryCoordinator()
    c.classifyDomainEvent(5)
    c.classifyDomainEvent(3)
    c.classifyDomainEvent(8)
    expect(c.getState().highestObservedSequence).toBe(8)
  })
})

describe('classifyDomainEvent — after bootstrap', () => {
  it('applies sequential events', () => {
    const c = bootstrapped(10)
    expect(c.classifyDomainEvent(11)).toBe('apply')
  })

  it('ignores already-applied events', () => {
    const c = bootstrapped(10)
    expect(c.classifyDomainEvent(10)).toBe('ignore')
    expect(c.classifyDomainEvent(5)).toBe('ignore')
    expect(c.classifyDomainEvent(1)).toBe('ignore')
  })

  it('triggers recovery on sequence gap', () => {
    const c = bootstrapped(10)
    expect(c.classifyDomainEvent(12)).toBe('recover')
  })

  it('sets pendingReplay on gap', () => {
    const c = bootstrapped(10)
    c.classifyDomainEvent(15)
    expect(c.getState().pendingReplay).toBe(true)
  })

  it('defers events during in-flight recovery', () => {
    const c = bootstrapped(10)
    c.beginReplayRecovery()
    expect(c.classifyDomainEvent(11)).toBe('defer')
    expect(c.classifyDomainEvent(12)).toBe('defer')
  })

  it('applies next sequential after markEventBatchApplied advances', () => {
    const c = bootstrapped(10)
    c.markEventBatchApplied(15)
    expect(c.classifyDomainEvent(16)).toBe('apply')
    expect(c.classifyDomainEvent(14)).toBe('ignore')
  })
})

// ─── beginSnapshotRecovery / completeSnapshotRecovery ────────────────────────

describe('beginSnapshotRecovery', () => {
  it('sets inFlight to snapshot phase', () => {
    const c = createRecoveryCoordinator()
    c.beginSnapshotRecovery('bootstrap')
    expect(c.getState().inFlight).toEqual({ kind: 'snapshot', reason: 'bootstrap' })
  })

  it('is idempotent — second call is no-op', () => {
    const c = createRecoveryCoordinator()
    c.beginSnapshotRecovery('bootstrap')
    c.beginSnapshotRecovery('sequence-gap') // should not override
    expect(c.getState().inFlight?.reason).toBe('bootstrap')
  })
})

describe('completeSnapshotRecovery', () => {
  it('sets bootstrapped=true and clears inFlight', () => {
    const c = createRecoveryCoordinator()
    c.beginSnapshotRecovery('bootstrap')
    c.completeSnapshotRecovery(10)
    const s = c.getState()
    expect(s.bootstrapped).toBe(true)
    expect(s.inFlight).toBeNull()
    expect(s.latestSequence).toBe(10)
  })

  it('returns false (no replay needed) when no gap', () => {
    const c = createRecoveryCoordinator()
    c.beginSnapshotRecovery('bootstrap')
    const needsReplay = c.completeSnapshotRecovery(10)
    expect(needsReplay).toBe(false)
  })

  it('returns true (replay needed) when events arrived during recovery', () => {
    const c = createRecoveryCoordinator()
    c.classifyDomainEvent(15) // arrives while unbootstrapped → defer + pendingReplay
    c.beginSnapshotRecovery('bootstrap')
    const needsReplay = c.completeSnapshotRecovery(10)
    expect(needsReplay).toBe(true)
  })

  it('returns true when snapshot is behind highestObservedSequence', () => {
    const c = createRecoveryCoordinator()
    c.classifyDomainEvent(20) // observed seq 20
    c.beginSnapshotRecovery('bootstrap')
    const needsReplay = c.completeSnapshotRecovery(10) // snapshot only at 10
    expect(needsReplay).toBe(true)
  })
})

// ─── beginReplayRecovery / completeReplayRecovery ────────────────────────────

describe('beginReplayRecovery', () => {
  it('sets inFlight to replay phase', () => {
    const c = bootstrapped(10)
    c.beginReplayRecovery()
    expect(c.getState().inFlight).toEqual({ kind: 'replay', reason: 'sequence-gap' })
  })

  it('clears pendingReplay flag', () => {
    const c = bootstrapped(10)
    c.classifyDomainEvent(15) // creates gap, sets pendingReplay
    c.beginReplayRecovery()
    expect(c.getState().pendingReplay).toBe(false)
  })

  it('is idempotent while replay in-flight', () => {
    const c = bootstrapped(10)
    c.beginReplayRecovery()
    c.beginReplayRecovery() // second call no-op
    expect(c.getState().inFlight?.kind).toBe('replay')
  })
})

describe('completeReplayRecovery', () => {
  it('clears inFlight after replay completes', () => {
    const c = bootstrapped(10)
    c.beginReplayRecovery()
    c.markEventBatchApplied(15)
    c.completeReplayRecovery()
    expect(c.getState().inFlight).toBeNull()
  })

  it('returns false when caught up to highestObservedSequence', () => {
    const c = bootstrapped(10)
    c.classifyDomainEvent(15)
    c.beginReplayRecovery()
    c.markEventBatchApplied(15) // caught up
    const needsAnother = c.completeReplayRecovery()
    expect(needsAnother).toBe(false)
  })

  it('returns true when still behind highestObservedSequence', () => {
    const c = bootstrapped(10)
    c.classifyDomainEvent(20)
    c.beginReplayRecovery()
    c.markEventBatchApplied(15) // still behind 20
    const needsAnother = c.completeReplayRecovery()
    expect(needsAnother).toBe(true)
  })
})

// ─── failRecovery ─────────────────────────────────────────────────────────────

describe('failRecovery', () => {
  it('resets bootstrapped to false', () => {
    const c = bootstrapped(10)
    c.beginReplayRecovery()
    c.failRecovery()
    expect(c.getState().bootstrapped).toBe(false)
  })

  it('clears inFlight', () => {
    const c = bootstrapped(10)
    c.beginSnapshotRecovery('sequence-gap')
    c.failRecovery()
    expect(c.getState().inFlight).toBeNull()
  })

  it('sets pendingReplay so retry is triggered', () => {
    const c = bootstrapped(10)
    c.failRecovery()
    expect(c.getState().pendingReplay).toBe(true)
  })
})

// ─── Full happy-path sequence ─────────────────────────────────────────────────

describe('happy-path: bootstrap → stream events', () => {
  it('bootstraps and applies sequential events without recovery', () => {
    const c = createRecoveryCoordinator()

    // Phase 1: bootstrap
    c.beginSnapshotRecovery('bootstrap')
    const needsReplay = c.completeSnapshotRecovery(5)
    expect(needsReplay).toBe(false)
    expect(c.getState().bootstrapped).toBe(true)

    // Phase 2: sequential events come in
    expect(c.classifyDomainEvent(6)).toBe('apply')
    c.markEventBatchApplied(6)
    expect(c.classifyDomainEvent(7)).toBe('apply')
    c.markEventBatchApplied(7)

    expect(c.getState().latestSequence).toBe(7)
    expect(c.getState().inFlight).toBeNull()
  })
})

describe('gap-recovery sequence', () => {
  it('detects gap and signals recover, then resumes', () => {
    const c = bootstrapped(10)

    // Event 11 is sequential — applied
    expect(c.classifyDomainEvent(11)).toBe('apply')
    c.markEventBatchApplied(11)

    // Event 13 arrives — gap! (12 missing)
    expect(c.classifyDomainEvent(13)).toBe('recover')
    expect(c.getState().pendingReplay).toBe(true)

    // Replay: fetch events 11→13
    c.beginReplayRecovery()
    c.markEventBatchApplied(13)
    const needsAnother = c.completeReplayRecovery()
    expect(needsAnother).toBe(false)
    expect(c.getState().latestSequence).toBe(13)
    expect(c.getState().inFlight).toBeNull()
  })
})
