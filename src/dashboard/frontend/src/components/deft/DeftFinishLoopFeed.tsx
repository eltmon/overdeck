/**
 * Deft's finish-loop progress in the Activity tab (PAN-4849 WI-17), from
 * `.deft-cache/finish-loop-progress.jsonl`, which only `deft pr:finish-loop`
 * writes. Newest first.
 */
import { formatDeftTime } from './DeftDecisionsTab';
import { useDeftIssueState } from './queries';

const SHOWN_ENTRIES = 20;

export function DeftFinishLoopFeed({ issueId }: { issueId: string }) {
  const { data: state } = useDeftIssueState(issueId);
  const entries = (state?.finishLoop ?? []).slice(-SHOWN_ENTRIES).reverse();
  if (entries.length === 0) return null;
  return (
    <section data-section="Deft finish loop" className="mb-3 rounded border border-border px-3 py-2">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Deft finish loop</h3>
      <ul className="space-y-1">
        {entries.map((entry, index) => (
          <li key={`${entry.ts}-${index}`} data-testid="deft-finish-loop-entry" className="text-[12px] text-foreground">
            <span className="font-mono text-[11px] text-muted-foreground">{formatDeftTime(entry.ts)}</span>
            <span className="ml-2 font-medium">{entry.phase}</span>
            <span className="ml-1 font-mono text-muted-foreground">#{entry.iteration}</span>
            <span className="ml-2">{entry.message}</span>
            {entry.prNumber !== null ? <span className="ml-2 text-muted-foreground">PR #{entry.prNumber}</span> : null}
            {entry.haltReason ? <span className="ml-2 text-muted-foreground">halted: {entry.haltReason}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
