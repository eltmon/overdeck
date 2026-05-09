/**
 * Recovery Coordinator — sequence gap detection and replay orchestration (PAN-428 B4)
 *
 * State machine that classifies incoming domain events as:
 * - "apply"   — sequential event, safe to apply immediately
 * - "ignore"  — stale event already applied
 * - "defer"   — recovery in-flight, queue for later
 * - "recover" — sequence gap detected, trigger snapshot+replay
 *
 * Modeled on T3Code's OrchestrationRecovery pattern.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type RecoveryPhaseKind = 'snapshot' | 'replay'
type RecoveryReason = 'bootstrap' | 'sequence-gap' | 'replay-failed'

export interface RecoveryPhase {
  kind: RecoveryPhaseKind
  reason: RecoveryReason
}

export interface RecoveryState {
  /** Last confirmed sequence number applied to the store */
  latestSequence: number
  /** Highest sequence number ever observed (may be ahead of latestSequence) */
  highestObservedSequence: number
  /** True once the initial snapshot has been loaded */
  bootstrapped: boolean
  /** True if a replay is queued after the current snapshot phase */
  pendingReplay: boolean
  /** Currently active recovery phase, or null */
  inFlight: RecoveryPhase | null
}

export type EventClassification = 'apply' | 'ignore' | 'defer' | 'recover'

export interface RecoveryCoordinator {
  getState(): RecoveryState
  /** Classify an incoming event sequence number */
  classifyDomainEvent(sequence: number): EventClassification
  /** Advance latestSequence after a batch of events has been applied */
  markEventBatchApplied(upToSequence: number): void
  /** Called before initiating a snapshot fetch */
  beginSnapshotRecovery(reason: RecoveryReason): void
  /** Called after snapshot fetch completes. Returns whether a replay is also needed. */
  completeSnapshotRecovery(snapshotSequence: number): boolean
  /** Called before initiating an event replay */
  beginReplayRecovery(): void
  /** Called after replay completes. Returns whether another replay is still needed. */
  completeReplayRecovery(): boolean
  /** Called when a recovery phase fails */
  failRecovery(): void
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createRecoveryCoordinator(): RecoveryCoordinator {
  let state: RecoveryState = {
    latestSequence: 0,
    highestObservedSequence: 0,
    bootstrapped: false,
    pendingReplay: false,
    inFlight: null,
  }
  let replayStartSequence: number | null = null

  function getState(): RecoveryState {
    return { ...state }
  }

  function classifyDomainEvent(sequence: number): EventClassification {
    // In-memory-only events (sequence === -1, emitted via emitOnly()) are
    // ephemeral and not part of the persistent log — always apply immediately.
    if (sequence === -1) return 'apply'

    // Track the highest sequence seen
    if (sequence > state.highestObservedSequence) {
      state = { ...state, highestObservedSequence: sequence }
    }

    // Already applied
    if (sequence <= state.latestSequence) return 'ignore'

    // Not bootstrapped or recovery in-flight — defer
    if (!state.bootstrapped || state.inFlight !== null) {
      state = { ...state, pendingReplay: true }
      return 'defer'
    }

    // Sequential — apply immediately
    if (sequence === state.latestSequence + 1) return 'apply'

    // Gap detected — need recovery
    state = { ...state, pendingReplay: true }
    return 'recover'
  }

  function markEventBatchApplied(upToSequence: number): void {
    if (upToSequence > state.latestSequence) {
      state = { ...state, latestSequence: upToSequence }
    }
  }

  function beginSnapshotRecovery(reason: RecoveryReason): void {
    if (state.inFlight) return // Only one recovery at a time
    state = { ...state, inFlight: { kind: 'snapshot', reason } }
  }

  function completeSnapshotRecovery(snapshotSequence: number): boolean {
    state = {
      ...state,
      latestSequence: snapshotSequence,
      bootstrapped: true,
      inFlight: null,
    }
    const needsReplay = state.pendingReplay || state.highestObservedSequence > snapshotSequence
    if (!needsReplay) {
      state = { ...state, pendingReplay: false }
    }
    return needsReplay
  }

  function beginReplayRecovery(): void {
    if (state.inFlight) return
    replayStartSequence = state.latestSequence
    state = {
      ...state,
      pendingReplay: false,
      inFlight: { kind: 'replay', reason: 'sequence-gap' },
    }
  }

  function completeReplayRecovery(): boolean {
    const madeProgress =
      replayStartSequence !== null && state.latestSequence > replayStartSequence
    replayStartSequence = null

    // If we're still behind the highest observed, another replay is needed
    const needsAnotherReplay =
      madeProgress && state.highestObservedSequence > state.latestSequence

    state = {
      ...state,
      inFlight: null,
      pendingReplay: needsAnotherReplay,
    }
    return needsAnotherReplay
  }

  function failRecovery(): void {
    // Reset bootstrapped on failure so we re-snapshot on next retry
    state = {
      ...state,
      bootstrapped: false,
      inFlight: null,
      pendingReplay: true,
    }
  }

  return {
    getState,
    classifyDomainEvent,
    markEventBatchApplied,
    beginSnapshotRecovery,
    completeSnapshotRecovery,
    beginReplayRecovery,
    completeReplayRecovery,
    failRecovery,
  }
}
