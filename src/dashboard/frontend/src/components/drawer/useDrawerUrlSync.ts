/**
 * useDrawerUrlSync — keeps drawer state in sync with URL search params.
 *
 * Opening sets `?issue=<id>&tab=<tab>` via history.replaceState.
 * Closing removes both params.
 * Initial load with `?issue=<id>` opens drawer on mount.
 */

import { useEffect, useRef } from 'react';
import { useDashboardStore } from '../../lib/store';

export function useDrawerUrlSync() {
  const issueId = useDashboardStore((s) => s.drawerIssueId);
  const drawerTab = useDashboardStore((s) => s.drawerTab);
  const openDrawerIssue = useDashboardStore((s) => s.openDrawerIssue);
  const closeDrawerIssue = useDashboardStore((s) => s.closeDrawerIssue);

  const hasHydrated = useRef(false);

  // Hydrate from URL on mount
  useEffect(() => {
    if (hasHydrated.current) return;
    hasHydrated.current = true;
    const params = new URLSearchParams(window.location.search);
    const issueFromUrl = params.get('issue');
    const tabFromUrl = params.get('tab');
    if (issueFromUrl) {
      openDrawerIssue(issueFromUrl, tabFromUrl ?? undefined);
    }
  }, [openDrawerIssue]);

  // Sync drawer state → URL
  useEffect(() => {
    if (!hasHydrated.current) return;
    const url = new URL(window.location.href);
    if (issueId) {
      url.searchParams.set('issue', issueId);
      if (drawerTab && drawerTab !== 'overview') {
        url.searchParams.set('tab', drawerTab);
      } else {
        url.searchParams.delete('tab');
      }
    } else {
      url.searchParams.delete('issue');
      url.searchParams.delete('tab');
    }
    window.history.replaceState(window.history.state, '', url);
  }, [issueId, drawerTab]);

  // Handle browser back/forward — close drawer when ?issue is removed
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const issueFromUrl = params.get('issue');
      if (!issueFromUrl) {
        closeDrawerIssue();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [closeDrawerIssue]);
}
