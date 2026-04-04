/**
 * Unit tests for the RecoveryCoordinator (PAN-428 B4)
 */

import { describe, it, expect } from 'vitest'
import { createRecoveryCoordinator } from '../lib/recoveryCoordinator'

describe('RecoveryCoordinator', () => {
  it('starts in unbootstrapped state', () => {
    const c = createRecoveryCoordinator()
    const s = c.getState()
    expect(s.bootstrapped).toBe(false)
    expect(s.latestSequence).toBe(0)
    expect(s.inFlight).toBeNull()
  })

  it('classifyDomainEvent returns "defer" before bootstrap', () => {
    const c = createRecoveryCoordinator()
    expect(c.classifyDomainEvent(1)).toBe('defer')
    expect(c.classifyDomainEvent(2)).toBe('defer')
  })

  it('classifyDomainEvent returns "ignore" for already-applied sequences', () => {
    const c = createRecoveryCoordinator()
    c.beginSnapshotRecovery('bootstrap')
    c.completeSnapshotRecovery(5)
    expect(c.classifyDomainEvent(3)).toBe('ignore')
    expect(c.classifyDomainEvent(5)).toBe('ignore')
  })

  it('classifyDomainEvent returns "apply" for sequential events after bootstrap', () => {
    const c = createRecoveryCoordinator()
    c.beginSnapshotRecovery('bootstrap')
    c.completeSnapshotRecovery(5)
    expect(c.classifyDomainEvent(6)).toBe('apply')
  })

  it('classifyDomainEvent returns "recover" on sequence gap', () => {
    const c = createRecoveryCoordinator()
    c.beginSnapshotRecovery('bootstrap')
    c.completeSnapshotRecovery(5)
    // Gap: expecting 6, got 8
    expect(c.classifyDomainEvent(8)).toBe('recover')
  })

  it('classifyDomainEvent returns "defer" when recovery in-flight', () => {
    const c = createRecoveryCoordinator()
    c.beginSnapshotRecovery('bootstrap')
    c.completeSnapshotRecovery(5)
    c.beginReplayRecovery()
    expect(c.classifyDomainEvent(6)).toBe('defer')
  })

  it('completeSnapshotRecovery signals replay needed when events were observed above snapshot', () => {
    const c = createRecoveryCoordinator()
    c.beginSnapshotRecovery('bootstrap')
    // Simulate an event at seq 10 arriving before snapshot completes
    c.classifyDomainEvent(10)
    const needsReplay = c.completeSnapshotRecovery(5)
    expect(needsReplay).toBe(true)
  })

  it('completeSnapshotRecovery signals no replay when snapshot is current', () => {
    const c = createRecoveryCoordinator()
    c.beginSnapshotRecovery('bootstrap')
    const needsReplay = c.completeSnapshotRecovery(5)
    expect(needsReplay).toBe(false)
  })

  it('markEventBatchApplied advances latestSequence', () => {
    const c = createRecoveryCoordinator()
    c.beginSnapshotRecovery('bootstrap')
    c.completeSnapshotRecovery(5)
    c.markEventBatchApplied(8)
    expect(c.getState().latestSequence).toBe(8)
  })

  it('failRecovery resets bootstrapped and allows re-snapshot', () => {
    const c = createRecoveryCoordinator()
    c.beginSnapshotRecovery('bootstrap')
    c.completeSnapshotRecovery(5)
    c.failRecovery()
    const s = c.getState()
    expect(s.bootstrapped).toBe(false)
    expect(s.inFlight).toBeNull()
    expect(s.pendingReplay).toBe(true)
  })

  it('beginSnapshotRecovery is idempotent while in-flight', () => {
    const c = createRecoveryCoordinator()
    c.beginSnapshotRecovery('bootstrap')
    c.beginSnapshotRecovery('bootstrap') // second call
    expect(c.getState().inFlight).not.toBeNull()
    // Still just one in-flight
    expect(c.getState().inFlight!.kind).toBe('snapshot')
  })

  it('full bootstrap flow: snapshot → apply sequential events', () => {
    const c = createRecoveryCoordinator()
    // Before bootstrap, events are deferred
    expect(c.classifyDomainEvent(1)).toBe('defer')

    // Bootstrap
    c.beginSnapshotRecovery('bootstrap')
    c.completeSnapshotRecovery(0)

    // After bootstrap, sequential events apply
    expect(c.classifyDomainEvent(1)).toBe('apply')
    c.markEventBatchApplied(1)
    expect(c.classifyDomainEvent(2)).toBe('apply')
    c.markEventBatchApplied(2)
    expect(c.getState().latestSequence).toBe(2)
  })
})
