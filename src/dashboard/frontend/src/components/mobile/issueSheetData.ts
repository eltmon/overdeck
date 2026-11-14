/** Pure data helpers for the issue sheet (PAN-5219 WI-5). No React. */
import { PHONE_ISSUE_EVENT_LABELS, type PhoneIssueEvent } from '@overdeck/contracts';

/** D-5: same local calendar day as `now` shows a time; otherwise a date and time. Null for an unparsable `at`. */
export function formatEventTime(at: string, now: Date): string | null {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** D-4/D-5: the "What happened" line for a notification's event. */
export function eventLine(
  event: { kind: PhoneIssueEvent; at: string | null },
  prNumber: number | null,
  now: Date,
): string {
  const label = event.kind === 'merge.completed' && prNumber !== null
    ? `Merged PR #${prNumber}`
    : PHONE_ISSUE_EVENT_LABELS[event.kind];
  const time = event.at ? formatEventTime(event.at, now) : null;
  return time ? `${label} at ${time}` : label;
}
