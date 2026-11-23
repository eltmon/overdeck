/**
 * PAN-5609 D-7/D-8 — the conversation-search indexing indicator's visibility
 * state machine, kept outside React so it is testable with plain `vi.useFakeTimers()`
 * and compatible with `useSyncExternalStore` (no `setState` in an effect).
 */
import { useSyncExternalStore } from 'react'
import type { ConversationSearchActivityKind, ConversationSearchActivitySnapshot } from '@overdeck/contracts'
import { useDashboardStore } from '../../lib/store'

/** D-7: a startup or full-reindex run shows at once; an incremental or catch-up run waits this long. */
export const INCREMENTAL_SHOW_DELAY_MS = 3_000
/** D-7: once a run ends, the indicator stays visible this long before hiding. */
export const HIDE_LINGER_MS = 2_000

export interface IndicatorView {
  visible: boolean
  snapshot: ConversationSearchActivitySnapshot | null
}

export interface IndicatorVisibility {
  update(snapshot: ConversationSearchActivitySnapshot | null): void
  /** Same object until visible or snapshot changes. */
  getView(): IndicatorView
  subscribe(listener: () => void): () => void
  /** Clears any pending show/linger timer. */
  dispose(): void
}

function isImmediateKind(kind: ConversationSearchActivityKind): boolean {
  return kind === 'startup' || kind === 'full-reindex'
}

function isGatedKind(kind: ConversationSearchActivityKind): boolean {
  return kind === 'incremental' || kind === 'catch-up'
}

export function createIndicatorVisibility(): IndicatorVisibility {
  let snapshot: ConversationSearchActivitySnapshot | null = null
  let visible = false
  let showTimer: ReturnType<typeof setTimeout> | null = null
  let lingerTimer: ReturnType<typeof setTimeout> | null = null
  let view: IndicatorView = { visible: false, snapshot: null }
  const listeners = new Set<() => void>()

  function clearShowTimer(): void {
    if (showTimer === null) return
    clearTimeout(showTimer)
    showTimer = null
  }

  function clearLingerTimer(): void {
    if (lingerTimer === null) return
    clearTimeout(lingerTimer)
    lingerTimer = null
  }

  function notify(): void {
    for (const listener of listeners) listener()
  }

  /** Replaces `view` only when visibility or the snapshot reference actually changed. */
  function syncView(): boolean {
    if (visible === view.visible && snapshot === view.snapshot) return false
    view = { visible, snapshot }
    return true
  }

  function armShowTimer(): void {
    if (showTimer !== null) return
    showTimer = setTimeout(() => {
      showTimer = null
      if (snapshot?.active) {
        visible = true
        if (syncView()) notify()
      }
    }, INCREMENTAL_SHOW_DELAY_MS)
  }

  function armLingerTimer(): void {
    if (lingerTimer !== null) return
    lingerTimer = setTimeout(() => {
      lingerTimer = null
      if (!snapshot?.active) {
        visible = false
        if (syncView()) notify()
      }
    }, HIDE_LINGER_MS)
  }

  function applyRules(): void {
    if (snapshot !== null && snapshot.active && snapshot.kind !== null) {
      const kind = snapshot.kind
      if (isImmediateKind(kind)) {
        clearShowTimer()
        clearLingerTimer()
        visible = true
        return
      }
      if (isGatedKind(kind)) {
        if (visible) {
          clearLingerTimer()
          return
        }
        armShowTimer()
        return
      }
    }
    // null, not active, or an unexpected null kind while active
    if (visible) {
      armLingerTimer()
    } else {
      clearShowTimer()
    }
  }

  return {
    update(next) {
      if (next === snapshot) return
      snapshot = next
      applyRules()
      if (syncView()) notify()
    },
    getView() {
      return view
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      clearShowTimer()
      clearLingerTimer()
      listeners.clear()
    },
  }
}

// ─── Module singleton bound to the dashboard store ─────────────────────────────

let instance: IndicatorVisibility | null = null
let storeUnsubscribe: (() => void) | null = null
let subscriberCount = 0

function ensureInstance(): IndicatorVisibility {
  instance ??= createIndicatorVisibility()
  return instance
}

function subscribeToStore(listener: () => void): () => void {
  const visibility = ensureInstance()
  if (subscriberCount === 0) {
    visibility.update(useDashboardStore.getState().conversationSearchActivity ?? null)
    storeUnsubscribe = useDashboardStore.subscribe((state, prev) => {
      if (state.conversationSearchActivity !== prev.conversationSearchActivity) {
        visibility.update(state.conversationSearchActivity ?? null)
      }
    })
  }
  subscriberCount += 1
  const unsubscribeListener = visibility.subscribe(listener)
  return () => {
    unsubscribeListener()
    subscriberCount -= 1
    if (subscriberCount === 0) {
      storeUnsubscribe?.()
      storeUnsubscribe = null
    }
  }
}

function getSnapshotView(): IndicatorView {
  return ensureInstance().getView()
}

/** Module singleton bound to `useDashboardStore`; starts on first subscribe, stops on last unsubscribe. */
export function useIndexingIndicatorView(): IndicatorView {
  return useSyncExternalStore(subscribeToStore, getSnapshotView)
}

// ─── Labels (D-10) ──────────────────────────────────────────────────────────────

export function kindLabel(kind: ConversationSearchActivityKind | null): string {
  switch (kind) {
    case 'startup':
      return 'Startup sweep'
    case 'catch-up':
      return 'Catch-up after watcher restart'
    case 'incremental':
      return 'New transcript changes'
    case 'full-reindex':
      return 'Full reindex'
    default:
      return ''
  }
}

export function chipText(snapshot: ConversationSearchActivitySnapshot | null): string {
  if (!snapshot || snapshot.filesScanned <= 0) return 'Indexing'
  return `Indexing ${snapshot.filesIndexed.toLocaleString()}/${snapshot.filesScanned.toLocaleString()}`
}

export function formatIndexingElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const totalMinutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (totalMinutes < 60) return `${totalMinutes}m ${String(seconds).padStart(2, '0')}s`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${String(minutes).padStart(2, '0')}m`
}
