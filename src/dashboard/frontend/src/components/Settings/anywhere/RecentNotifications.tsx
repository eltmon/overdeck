/**
 * PAN-5111: "Recent notifications" under Settings → Anywhere → Phone
 * notifications. The last 50 pushes Overdeck sent, newest first: the title,
 * when it went out, how many targets it reached, and for a question or
 * approval whether it is still waiting, was answered through Overdeck, or left
 * Needs you without an answer sent from Overdeck.
 */
import { useQuery } from '@tanstack/react-query';

import { formatRelativeTime } from '../../../lib/dashboard-utils';
import { decisionSubjectPath, navigateToDecisionSubject, type DecisionSubjectTarget } from '../../../lib/navigateToDecision';
import { loadPushHistory, PUSH_HISTORY_QUERY_KEY, type PushHistoryEntry } from '../../push/pushApi';

const WITHDRAWN_HINT = 'It left Needs you without an answer sent from Overdeck: answered in the terminal, or the agent moved on.';

function deliveryText(entry: PushHistoryEntry): string {
  const ok = entry.deliveries.filter((d) => d.ok).length;
  const failed = entry.deliveries.filter((d) => !d.ok && d.reason !== 'skipped');
  const head = ok > 0 ? `Delivered to ${ok}` : 'Not delivered';
  const first = failed[0];
  if (!first) return head;
  return `${head}, ${failed.length} failed (${first.reason ?? 'error'}${first.status ? ` ${first.status}` : ''})`;
}

function stateText(state: PushHistoryEntry['state']): string | null {
  if (state === 'open') return 'Waiting';
  if (state === 'answered') return 'Answered';
  if (state === 'resolved-without-answer') return 'Answered or withdrawn';
  return null;
}

function openTarget(entry: PushHistoryEntry): DecisionSubjectTarget | null {
  if (entry.subject?.startsWith('conv:')) return { id: entry.subject.slice('conv:'.length), source: 'conversation' };
  if (entry.issueId && (entry.subject === null || entry.subject.startsWith('agent:'))) {
    return { id: entry.subject?.slice('agent:'.length) ?? entry.issueId, source: 'agent', issueId: entry.issueId };
  }
  return null;
}

function RecentNotificationRow({ entry }: { entry: PushHistoryEntry }) {
  const state = stateText(entry.state);
  const target = openTarget(entry);
  const href = target ? decisionSubjectPath(target) : null;
  return (
    <li data-push-id={entry.id} className="flex items-center justify-between gap-4 px-4 py-2 rounded-lg hover:bg-muted/30 transition-colors">
      <div className="min-w-0">
        <p className="text-sm text-foreground">
          <span>{entry.title}</span>
          <span className="text-xs text-muted-foreground"> · {formatRelativeTime(entry.ts)}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {deliveryText(entry)}
          {state ? (
            <>
              {' · '}
              <span title={entry.state === 'resolved-without-answer' ? WITHDRAWN_HINT : undefined}>{state}</span>
            </>
          ) : null}
        </p>
      </div>
      {target && href ? (
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            navigateToDecisionSubject(target);
          }}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors"
        >
          Open
        </a>
      ) : null}
    </li>
  );
}

export function RecentNotifications() {
  const { data, isLoading, error } = useQuery({
    queryKey: PUSH_HISTORY_QUERY_KEY,
    queryFn: loadPushHistory,
    refetchInterval: 10_000,
  });
  const entries = data ?? [];
  return (
    <section data-component="recent-notifications" className="mt-4">
      <h4 className="text-sm font-medium text-foreground mb-1">Recent notifications</h4>
      {isLoading ? (
        <p className="text-xs text-muted-foreground px-4 py-2">Loading recent notifications…</p>
      ) : error ? (
        <p className="text-xs text-destructive px-4 py-2">Could not load recent notifications: {(error as Error).message}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground px-4 py-2">No notifications sent yet.</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((entry) => <RecentNotificationRow key={entry.id} entry={entry} />)}
        </ul>
      )}
    </section>
  );
}
