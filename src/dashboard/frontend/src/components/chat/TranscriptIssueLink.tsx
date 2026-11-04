import { useContext, type MouseEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resolveTrackerIssueId, type TrackerIssueProject, type TrackerIssueUrlRef } from '@overdeck/contracts';
import { useDashboardStore } from '../../lib/store';
import { IssueDrawerAvailableContext } from '../drawer/issueDrawerAvailableContext';

/**
 * PAN-4714: a tracker issue link inside a conversation transcript opens that
 * issue's drawer on a plain click. Modified clicks, middle-click and the context
 * menu keep the browser's new-tab behaviour; a link no registered project
 * resolves stays a plain link. In a host that doesn't mount `<IssueDrawer />`
 * (the standalone pop-outs, `/m`), `IssueDrawerAvailableContext` is `false`
 * and the link stays a plain anchor — a review fix after PAN-4714's first
 * cycle found the click was otherwise swallowed there.
 *
 * PAN-4717: the drawer opens even for an issue absent from the dashboard
 * snapshot. The server backfills aged-out closed issues (PAN-3659), but a
 * current-cycle-filtered or unresolvable issue never hydrates — so the link
 * always passes its own href through to openIssue, stored as
 * drawer.trackerUrl, letting the drawer's tracker button still work.
 */
export function TranscriptIssueLink({ href, issueRef, className, children }: {
  href: string;
  issueRef: TrackerIssueUrlRef;
  className?: string;
  children: ReactNode;
}) {
  const drawerAvailable = useContext(IssueDrawerAvailableContext);
  const openIssue = useDashboardStore((s) => s.openIssue);
  const { data } = useQuery<unknown>({
    queryKey: ['registered-projects'],
    queryFn: async () => {
      const res = await fetch('/api/registered-projects');
      if (!res.ok) throw new Error('Failed to fetch registered projects');
      return res.json();
    },
    staleTime: 60_000,
    enabled: drawerAvailable,
  });
  if (!drawerAvailable) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  const projects = Array.isArray(data) ? (data as TrackerIssueProject[]) : [];
  const issueId = resolveTrackerIssueId(issueRef, projects);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!issueId || event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openIssue(issueId, 'overview', href);
  };
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}
      data-issue-id={issueId ?? undefined} onClick={onClick}>
      {children}
    </a>
  );
}
