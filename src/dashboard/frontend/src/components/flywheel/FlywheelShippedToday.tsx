/**
 * The Shipped-today timeline (PAN-5283 FR-10): today's PR merges on the
 * default branch, successful `pan reload` deploys and release tags, newest
 * first, each linked to its PR or release. The status route derives the list
 * (`src/lib/flywheel/health.ts`); this component only renders it.
 */
import type { FlywheelShippedEvent } from '@overdeck/contracts';

import { clockTime } from './FlywheelHealthStrip';

const LINK_CLASS = 'text-foreground underline decoration-muted-foreground/60 underline-offset-2 hover:decoration-foreground';

function EventText({ event }: { event: FlywheelShippedEvent }) {
  switch (event.kind) {
    case 'merge': {
      const { merge } = event;
      const name = merge.issueId ?? `PR #${merge.prNumber}`;
      return (
        <>
          merged{' '}
          {merge.prUrl ? (
            <a href={merge.prUrl} target="_blank" rel="noreferrer noopener" className={`font-mono ${LINK_CLASS}`} data-testid="flywheel-shipped-merge-link">
              {name}
            </a>
          ) : (
            <span className="font-mono text-foreground">{name}</span>
          )}{' '}
          {merge.title ?? merge.subject}
        </>
      );
    }
    case 'deploy':
      return <>deployed ({event.trigger}){event.issueId ? <> for <span className="font-mono">{event.issueId}</span></> : null}</>;
    case 'release':
      return (
        <>
          released{' '}
          {event.url ? (
            <a href={event.url} target="_blank" rel="noreferrer noopener" className={`font-mono ${LINK_CLASS}`}>{event.tag}</a>
          ) : (
            <span className="font-mono text-foreground">{event.tag}</span>
          )}
        </>
      );
  }
}

export function FlywheelShippedToday({ events }: { events: readonly FlywheelShippedEvent[] }) {
  const sorted = [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <section aria-label="Shipped today" data-testid="flywheel-shipped-today">
      <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Shipped today</h3>
      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing shipped yet today.</p>
      ) : (
        <ol className="space-y-0.5 text-xs">
          {sorted.map((event, index) => (
            <li key={`${event.kind}-${event.at}-${index}`} className="flex min-w-0 gap-2" data-testid={`flywheel-shipped-${event.kind}`}>
              <span className="shrink-0 font-mono text-muted-foreground" title={event.at}>{clockTime(event.at)}</span>
              <span className="min-w-0 break-words text-muted-foreground"><EventText event={event} /></span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
