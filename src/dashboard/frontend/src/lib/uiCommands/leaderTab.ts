// Leader tab (PAN-5349 O-D5): the one dashboard tab that acts on a UI
// command is the tab focused most recently. Each tab records its focus in
// localStorage; a missing, stale or unreadable record makes every visible
// tab a fallback leader. Every storage access is in try/catch.

export type LeaderRole = 'leader' | 'follower' | 'fallback'

const STORAGE_KEY = 'overdeck.ui.leaderTab'
const STALE_MS = 24 * 60 * 60 * 1000

function randomTabId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

/** This tab's id, made once per page load. */
export const TAB_ID = randomTabId()

function readEntry(): { tabId: string; at: number } | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const { tabId, at } = parsed as Record<string, unknown>
    return typeof tabId === 'string' && typeof at === 'number' ? { tabId, at } : null
  } catch {
    return null
  }
}

/** Record this tab as the most recently focused one. */
export function markFocused(now: number = Date.now()): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabId: TAB_ID, at: now }))
  } catch {
    // Storage blocked: every tab falls back to the visibility rule.
  }
}

/** Remove the record, but only when this tab owns it. */
export function releaseLeadership(): void {
  try {
    if (readEntry()?.tabId === TAB_ID) window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked: nothing to release.
  }
}

/** This tab's role for a command arriving at `now`. */
export function leaderRole(now: number = Date.now()): LeaderRole {
  const entry = readEntry()
  if (!entry || now - entry.at > STALE_MS) return 'fallback'
  return entry.tabId === TAB_ID ? 'leader' : 'follower'
}

/** Track focus for the leader rule; returns a cleanup that removes the listeners. */
export function installLeaderTracking(): () => void {
  const onFocus = () => markFocused()
  const onVisibility = () => {
    if (document.visibilityState === 'visible') markFocused()
  }
  const onPageHide = () => releaseLeadership()
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
  if (document.hasFocus()) markFocused()
  return () => {
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onPageHide)
  }
}
