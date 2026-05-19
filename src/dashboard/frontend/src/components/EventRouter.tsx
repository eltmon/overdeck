/**
 * EventRouter — Root subscriber that connects WsTransport to the DashboardStore (PAN-428 B4)
 *
 * Mounts once at the app root. On connect:
 * 1. Fetches initial snapshot via getSnapshot RPC
 * 2. Subscribes to the domain event stream (subscribeDomainEvents)
 * 3. Routes each event through the recovery coordinator and into the store
 *
 * Event coalescing: rapid bursts of events are queued via queueMicrotask
 * and flushed to the store in one batch, preventing redundant React renders.
 */

import { useEffect, useRef } from 'react'
import { useDashboardStore } from '../lib/store'
import { createRecoveryCoordinator, type RecoveryCoordinator } from '../lib/recoveryCoordinator'
import { getTransport, type PanRpcProtocolClient } from '../lib/wsTransport'
import type { DomainEvent, DashboardSnapshot } from '@panctl/contracts'
import { WS_METHODS } from '@panctl/contracts'
import { Stream } from 'effect'
import { loadSnapshotFromCache } from '../lib/snapshotCache'

const SNAPSHOT_FALLBACK_INTERVAL_MS = 2_000
const SNAPSHOT_FALLBACK_WINDOW_MS = 3 * 60_000

// ─── EventRouter component ────────────────────────────────────────────────────

export function EventRouter() {
  const syncSnapshot = useDashboardStore((s) => s.syncSnapshot)
  const applyEvents = useDashboardStore((s) => s.applyEvents)
  const recovery = useRef<RecoveryCoordinator | null>(null)
  const pendingBatch = useRef<DomainEvent[]>([])
  const flushScheduled = useRef(false)

  useEffect(() => {
    const transport = getTransport()
    const coordinator = createRecoveryCoordinator()
    recovery.current = coordinator
    let bootstrapInFlight = false
    let bootstrapComplete = false
    let fallbackInterval: ReturnType<typeof setInterval> | null = null
    let fallbackTimeout: ReturnType<typeof setTimeout> | null = null

    function stopFallbackPoller() {
      if (fallbackInterval) clearInterval(fallbackInterval)
      if (fallbackTimeout) clearTimeout(fallbackTimeout)
      fallbackInterval = null
      fallbackTimeout = null
    }

    function startFallbackPoller() {
      stopFallbackPoller()
      fallbackInterval = setInterval(() => {
        if (bootstrapComplete) {
          stopFallbackPoller()
          return
        }
        bootstrap().catch(console.error)
      }, SNAPSHOT_FALLBACK_INTERVAL_MS)
      fallbackTimeout = setTimeout(stopFallbackPoller, SNAPSHOT_FALLBACK_WINDOW_MS)
    }

    // ── Instant render: load from localStorage cache ─────────────────────────
    const cached = loadSnapshotFromCache()
    if (cached) {
      syncSnapshot(cached)
    }

    // ── Bootstrap: fetch initial snapshot ───────────────────────────────────
    async function bootstrap() {
      if (bootstrapInFlight) return
      bootstrapInFlight = true
      coordinator.beginSnapshotRecovery('bootstrap')
      try {
        const snapshot = await transport.request((client) =>
          (client as PanRpcProtocolClient)[WS_METHODS.getSnapshot]({}),
        ) as DashboardSnapshot
        syncSnapshot(snapshot)
        bootstrapComplete = true
        stopFallbackPoller()
        const needsReplay = coordinator.completeSnapshotRecovery(snapshot.sequence)
        if (needsReplay) {
          await replay(snapshot.sequence)
        }
      } catch (err) {
        console.error('[EventRouter] bootstrap failed:', err)
        coordinator.failRecovery()
      } finally {
        bootstrapInFlight = false
      }
    }

    // ── Replay: fetch missed events ──────────────────────────────────────────
    async function replay(fromSequence: number) {
      coordinator.beginReplayRecovery()
      try {
        const events = await transport.request((client) =>
          (client as PanRpcProtocolClient)[WS_METHODS.replayEvents]({ fromSequence }),
        )
        const typed = events as DomainEvent[]
        if (typed.length > 0) {
          applyEvents(typed)
          coordinator.markEventBatchApplied(typed[typed.length - 1]!.sequence)
        }
        const needsAnotherReplay = coordinator.completeReplayRecovery()
        if (needsAnotherReplay) {
          await replay(coordinator.getState().latestSequence)
          return
        }
        drainDeferredEvents()
      } catch (err) {
        console.error('[EventRouter] replay failed:', err)
        coordinator.failRecovery()
      }
    }

    function drainDeferredEvents() {
      const deferred = pendingBatch.current.splice(0).sort((a, b) => a.sequence - b.sequence)
      const applyBatch: DomainEvent[] = []
      for (const event of deferred) {
        const classification = coordinator.classifyDomainEvent(event.sequence)
        if (classification === 'ignore') continue
        if (classification === 'apply') {
          applyBatch.push(event)
          coordinator.markEventBatchApplied(event.sequence)
          continue
        }
        pendingBatch.current.push(event)
        if (classification === 'recover') {
          replay(coordinator.getState().latestSequence).catch(console.error)
          break
        }
      }
      if (applyBatch.length > 0) applyEvents(applyBatch)
    }

    // ── Event coalescing ──────────────────────────────────────────────────────
    // Batch events across ~16 ms (one frame) instead of queueMicrotask.
    // WebSocket messages arrive in separate tasks; queueMicrotask flushes
    // too eagerly and causes a re-render per message. A small timeout
    // batches rapid bursts into a single store update + React render.
    function scheduleFlush() {
      if (flushScheduled.current) return
      flushScheduled.current = true
      setTimeout(() => {
        flushScheduled.current = false
        const batch = pendingBatch.current.splice(0)
        if (batch.length === 0) return
        applyEvents(batch)
        const lastSeq = batch[batch.length - 1]!.sequence
        coordinator.markEventBatchApplied(lastSeq)
      }, 16)
    }

    // ── Event handler ─────────────────────────────────────────────────────────
    function handleEvent(event: DomainEvent) {
      const classification = coordinator.classifyDomainEvent(event.sequence)
      if (classification === 'ignore') return
      if (classification === 'defer') {
        pendingBatch.current.push(event)
        return
      }
      if (classification === 'recover') {
        pendingBatch.current.push(event)
        const currentSeq = coordinator.getState().latestSequence
        replay(currentSeq).catch(console.error)
        return
      }
      // 'apply'
      pendingBatch.current.push(event)
      scheduleFlush()
    }

    // ── Subscribe to domain events ────────────────────────────────────────────
    const unsubscribe = transport.subscribe(
      (client) =>
        (client as PanRpcProtocolClient)[WS_METHODS.subscribeDomainEvents]({}) as unknown as Stream.Stream<DomainEvent, Error>,
      (event) => handleEvent(event as DomainEvent),
      {
        // When the WebSocket reconnects after a dashboard restart, re-fetch
        // the snapshot from the new server instance. Without this, the
        // frontend operates on a stale snapshot and conversations/sessions
        // that were being viewed vanish with "no longer exists" errors.
        onReconnect: () => {
          console.log('[EventRouter] transport reconnected — re-bootstrapping snapshot')
          bootstrap()
          // Broadcast to all useQuery consumers so they re-fetch stale data
          // (session trees, conversations, costs, etc.)
          window.dispatchEvent(new CustomEvent('panopticon:reconnected'))
        },
      },
    )

    bootstrap()
    startFallbackPoller()

    return () => {
      stopFallbackPoller()
      unsubscribe()
    }
  }, [syncSnapshot, applyEvents])

  return null
}
