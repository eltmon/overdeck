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
 *
 * Degraded mode (PAN-4279): EventRouter never shows a blocking overlay. It
 * feeds the connection store (`streamLive`, `serverReachable` via
 * `/api/health` probes, `lastLiveAt`) and the one `DegradedModeBanner` reports
 * the outage. Bootstrap is bounded by `BOOTSTRAP_TIMEOUT_MS` and retries with
 * backoff forever; the banner's Retry (`requestReconnect`) always starts a
 * fresh attempt, abandoning any attempt still in flight.
 */

import { useEffect, useRef } from 'react'
import { useDashboardStore } from '../lib/store'
import { createRecoveryCoordinator, type RecoveryCoordinator } from '../lib/recoveryCoordinator'
import { getTransport, resetTransport, type PanRpcProtocolClient } from '../lib/wsTransport'
import type { DomainEvent, DashboardSnapshot } from '@overdeck/contracts'
import { WS_METHODS } from '@overdeck/contracts'
import { Stream } from 'effect'
import { loadSnapshotCacheEntry } from '../lib/snapshotCache'
import { dispatchBackendReconnected, dispatchBackendReconnecting } from '../lib/backendConnectionEvents'
import { probeServerHealth, useConnectionState } from '../lib/connectionState'

const SNAPSHOT_FALLBACK_INTERVAL_MS = 2_000
const STREAM_STALENESS_TIMEOUT_MS = 35_000
export const BOOTSTRAP_TIMEOUT_MS = 20_000
export const EVENT_ROUTER_RECONNECT_BASE_DELAY_MS = 2_000
export const EVENT_ROUTER_RECONNECT_MAX_DELAY_MS = 30_000
export const EVENT_ROUTER_RECONNECT_JITTER_RATIO = 0.2

type SequencedDomainEvent = Exclude<DomainEvent, { type: 'system.heartbeat' }>

function isSequencedDomainEvent(event: DomainEvent): event is SequencedDomainEvent {
  return 'sequence' in event
}

export function eventRouterReconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const safeAttempt = Math.max(1, Math.floor(attempt))
  const baseDelay = Math.min(
    EVENT_ROUTER_RECONNECT_BASE_DELAY_MS * 2 ** (safeAttempt - 1),
    EVENT_ROUTER_RECONNECT_MAX_DELAY_MS,
  )
  const jitter = 1 + ((random() * 2 - 1) * EVENT_ROUTER_RECONNECT_JITTER_RATIO)
  return Math.min(EVENT_ROUTER_RECONNECT_MAX_DELAY_MS, Math.round(baseDelay * jitter))
}

// ─── EventRouter component ────────────────────────────────────────────────────

export function EventRouter() {
  const syncSnapshot = useDashboardStore((s) => s.syncSnapshot)
  const applyEvents = useDashboardStore((s) => s.applyEvents)
  const seedRecentActivity = useDashboardStore((s) => s.seedRecentActivity)
  const recovery = useRef<RecoveryCoordinator | null>(null)
  const pendingBatch = useRef<SequencedDomainEvent[]>([])
  const flushScheduled = useRef(false)

  useEffect(() => {
    const coordinator = createRecoveryCoordinator()
    recovery.current = coordinator
    const connection = useConnectionState.getState()
    let bootstrapInFlight = false
    // Resolves true on success, false on failure, null when superseded.
    let bootstrapPromise: Promise<boolean | null> | null = null
    // Bumped by every bootstrap attempt, forced reconnect and unmount; an
    // attempt whose generation is no longer current never touches state.
    let generation = 0
    let disposed = false
    // Only the most recent health probe may write reachability.
    let probeSeq = 0
    let bootstrapComplete = false
    let reconnecting = false
    let fallbackInterval: ReturnType<typeof setInterval> | null = null
    let stalenessTimeout: ReturnType<typeof setTimeout> | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempt = 0
    // Consecutive staleness-watchdog firings with no domain event in between.
    // Drives PAN-3778 escalation: strike 1 resubscribes only the domain
    // stream on the live socket; strike 2+ falls back to a full transport
    // reset (the socket itself is presumed wedged).
    let stalenessStrikes = 0
    let unsubscribe: (() => void) | null = null

    function stopFallbackPoller() {
      if (fallbackInterval) clearInterval(fallbackInterval)
      fallbackInterval = null
    }

    // Polls until the first bootstrap succeeds — no give-up window (PAN-4279).
    function startFallbackPoller() {
      stopFallbackPoller()
      fallbackInterval = setInterval(() => {
        if (bootstrapComplete) {
          stopFallbackPoller()
          return
        }
        // A scheduled reconnect owns recovery: it resets the transport, which
        // a poll over a wedged transport would never do.
        if (reconnectTimeout) return
        bootstrap().catch(console.error)
      }, SNAPSHOT_FALLBACK_INTERVAL_MS)
    }

    function stopStalenessWatchdog() {
      if (stalenessTimeout) clearTimeout(stalenessTimeout)
      stalenessTimeout = null
    }

    function stopScheduledReconnect() {
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }

    // The stream is down: data is stale until the next bootstrap. Probe HTTP
    // so the phase reads `delayed` (server answers) rather than `unreachable`.
    function markStreamDown() {
      connection.setStreamLive(false)
      const seq = ++probeSeq
      void probeServerHealth().then((reachable) => {
        if (!disposed && seq === probeSeq) connection.setServerReachable(reachable)
      })
    }

    function markBackendReconnecting() {
      reconnecting = true
      dispatchBackendReconnecting()
      markStreamDown()
    }

    function bootstrapWithReconnectRetry() {
      void bootstrap().then((succeeded) => {
        if (succeeded === false) scheduleReconnectDomainStream()
      })
    }

    // Banner Retry: abandon any in-flight attempt (it may never settle — a hung
    // session fetch or getSnapshot) and start over on a fresh transport.
    function forceReconnect() {
      generation += 1
      bootstrapInFlight = false
      bootstrapPromise = null
      reconnectAttempt = 0
      reconnectDomainStream({ fullReset: true })
    }

    function reconnectDomainStream(options?: { fullReset?: boolean }) {
      if (bootstrapInFlight) return
      const fullReset = options?.fullReset ?? true
      stopScheduledReconnect()
      markBackendReconnecting()
      unsubscribe?.()
      unsubscribe = null
      // PAN-3778: a full transport reset kills EVERY subscription on the
      // shared socket, and each one (the conversation stream in particular)
      // replays its full snapshot on resubscribe — heavy enough to starve the
      // domain stream past the staleness watchdog again, locking the tab in a
      // self-sustaining reconnect loop. The first staleness recovery therefore
      // resubscribes only the domain stream on the live socket; the reset is
      // reserved for repeated staleness (socket presumed wedged), bootstrap
      // failures, and the explicit Retry button.
      if (fullReset) resetTransport()
      subscribeToDomainEvents()
      bootstrapWithReconnectRetry()
    }

    function scheduleReconnectDomainStream(options?: { fullReset?: boolean }) {
      if (reconnectTimeout || bootstrapInFlight) return
      reconnectAttempt += 1
      const delayMs = eventRouterReconnectDelayMs(reconnectAttempt)
      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null
        reconnectDomainStream(options)
      }, delayMs)
    }

    function resetStalenessWatchdog() {
      stopStalenessWatchdog()
      stalenessTimeout = setTimeout(() => {
        stalenessStrikes += 1
        console.warn(`[EventRouter] domain event stream stale — scheduling reconnect (strike ${stalenessStrikes})`)
        // Transient blip: announce via the reconnecting event (non-blocking
        // banner in BackendConnectionBoundary) — never the full-screen overlay.
        markBackendReconnecting()
        scheduleReconnectDomainStream({ fullReset: stalenessStrikes > 1 })
      }, STREAM_STALENESS_TIMEOUT_MS)
    }

    // ── Instant render: load from localStorage cache ─────────────────────────
    const cached = loadSnapshotCacheEntry()
    if (cached) {
      syncSnapshot(cached.data)
      connection.markSnapshotCached(Date.parse(cached.timestamp))
    }

    // ── Activity backfill: HTTP fetch of persisted activity entries ──────────
    async function seedRecentActivityFromApi() {
      try {
        const res = await fetch('/api/activity')
        if (!res.ok) return
        const entries = await res.json()
        if (Array.isArray(entries)) seedRecentActivity(entries)
      } catch {
        // Non-fatal — live events still stream in over the WS.
      }
    }

    // ── Bootstrap: fetch initial snapshot ───────────────────────────────────
    function bootstrap(): Promise<boolean | null> {
      if (bootstrapPromise) return bootstrapPromise

      const gen = ++generation
      bootstrapInFlight = true
      bootstrapPromise = (async () => {
        coordinator.beginSnapshotRecovery('bootstrap')
        // getSnapshot has no timeout of its own, and the transport awaits an
        // untimed session fetch first; a hung attempt must not pin
        // bootstrapInFlight forever (PAN-4279).
        let timeout: ReturnType<typeof setTimeout> | undefined
        try {
          const snapshot = await Promise.race([
            getTransport().request((client) =>
              (client as PanRpcProtocolClient)[WS_METHODS.getSnapshot]({}),
            ) as Promise<DashboardSnapshot>,
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error(`getSnapshot timed out after ${BOOTSTRAP_TIMEOUT_MS}ms`)),
                BOOTSTRAP_TIMEOUT_MS,
              )
            }),
          ])
          if (gen !== generation) return null
          syncSnapshot(snapshot)
          // Snapshot carries recent activity now; keep the HTTP backfill as a
          // non-fatal compatibility path for older cached/server payloads.
          void seedRecentActivityFromApi()
          bootstrapComplete = true
          stopFallbackPoller()
          connection.setServerReachable(true)
          connection.setStreamLive(true)
          const needsReplay = coordinator.completeSnapshotRecovery(snapshot.sequence)
          if (needsReplay) {
            await replay(snapshot.sequence)
          }
          if (reconnecting) {
            reconnecting = false
            reconnectAttempt = 0
            stopScheduledReconnect()
            dispatchBackendReconnected()
          }
          return true
        } catch (err) {
          if (gen !== generation) return null
          console.error('[EventRouter] bootstrap failed:', err)
          coordinator.failRecovery()
          markStreamDown()
          return false
        } finally {
          clearTimeout(timeout)
          if (gen === generation) {
            bootstrapInFlight = false
            bootstrapPromise = null
          }
        }
      })()
      return bootstrapPromise
    }

    // ── Replay: fetch missed events ──────────────────────────────────────────
    async function replay(fromSequence: number) {
      coordinator.beginReplayRecovery()
      try {
        const events = await getTransport().request((client) =>
          (client as PanRpcProtocolClient)[WS_METHODS.replayEvents]({ fromSequence }),
        )
        const typed = (events as DomainEvent[]).filter(isSequencedDomainEvent)
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
      if (applyBatch.length > 0) {
        applyEvents(applyBatch)
        // Freshness stamp: live data just landed.
        if (useConnectionState.getState().streamLive) connection.setStreamLive(true)
      }
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
        drainDeferredEvents()
      }, 16)
    }

    // ── Event handler ─────────────────────────────────────────────────────────
    function handleEvent(event: DomainEvent) {
      stalenessStrikes = 0
      resetStalenessWatchdog()
      if (reconnecting) {
        // A live event proves the stream is back, but the banner only clears
        // after a successful snapshot bootstrap. Never cancel the pending
        // recovery here: heartbeats arrive every 15s, so cancelling it left
        // `reconnecting` latched with nothing scheduled to clear it, and the
        // tab showed "Connection lost — reconnecting…" forever after a
        // dashboard restart. With nothing scheduled or in flight, bootstrap now.
        if (!reconnectTimeout && !bootstrapInFlight) bootstrapWithReconnectRetry()
      } else {
        reconnectAttempt = 0
        stopScheduledReconnect()
      }
      if (!isSequencedDomainEvent(event)) return

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
    function subscribeToDomainEvents() {
      unsubscribe?.()
      unsubscribe = getTransport().subscribe(
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
            bootstrapWithReconnectRetry()
          },
          // Retries never block the UI: the degraded-mode banner reports them,
          // and the health probe decides between `delayed` and `unreachable`.
          onRetry: () => {
            markBackendReconnecting()
          },
        },
      )
      resetStalenessWatchdog()
    }

    connection.registerReconnect(forceReconnect)
    subscribeToDomainEvents()
    bootstrapWithReconnectRetry()
    startFallbackPoller()

    return () => {
      disposed = true
      generation += 1
      connection.registerReconnect(null)
      stopFallbackPoller()
      stopStalenessWatchdog()
      stopScheduledReconnect()
      unsubscribe?.()
    }
  }, [syncSnapshot, applyEvents, seedRecentActivity])

  return null
}
