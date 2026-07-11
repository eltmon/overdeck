/**
 * PAN-1862 (FR-12): fire a desktop notification for activity entries flagged
 * `desktop: true` — operator-facing warnings that shouldn't wait for the
 * operator to be looking at the Activity panel (e.g. a review convoy fork
 * cache miss: the optimization didn't land and reviews proceed at full cost).
 *
 * Same Notification pattern as usePendingInputDialogs (#1102): tag-deduped by
 * entry id, permission-gated, click focuses the dashboard. Entries seen before
 * the hook mounts (snapshot backlog) are not announced — only live arrivals.
 */
import { useEffect, useRef } from 'react';
import { useDashboardStore } from '../../lib/store';

interface DesktopActivityEntry {
  id: string;
  message?: string;
  source?: string;
  desktop?: boolean;
}

export function useDesktopActivityNotifications(): void {
  const recentActivity = useDashboardStore((s) => s.recentActivity) as unknown as DesktopActivityEntry[];
  const announcedRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);

  useEffect(() => {
    if (!Array.isArray(recentActivity)) return;
    if (!primedRef.current) {
      // First render: swallow the snapshot backlog so a reload doesn't replay
      // old warnings as fresh desktop notifications.
      for (const entry of recentActivity) {
        if (entry?.id) announcedRef.current.add(entry.id);
      }
      primedRef.current = true;
      return;
    }
    for (const entry of recentActivity) {
      if (!entry?.desktop || !entry.id || announcedRef.current.has(entry.id)) continue;
      announcedRef.current.add(entry.id);
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification('Overdeck', { body: entry.message ?? 'Overdeck notification', tag: entry.id });
          n.onclick = (): void => { window.focus(); n.close(); };
        } catch { /* ignore */ }
      }
    }
  }, [recentActivity]);
}
