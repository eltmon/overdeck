/**
 * The strike lane (PAN-4753 WI-10): open strike PRs, rendered above the queue
 * because strikes go to the front of the train (D1).
 *
 * Merge (the operator-started strike door, `POST /api/merge-train/strikes/:id/merge`)
 * shows on `waiting-uat`, `ready` and `reviewing`; Retry on `failed`. There
 * is no action on `checks-pending` (the door refuses red or pending checks),
 * `flagged` (D1: a flagged strike stops), `queued`, `merging` or `blocked`.
 * Merging while the bot review runs asks first.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '../../DialogProvider';
import { postJson } from '../mergeTrainApi';
import type { StrikeState, TrainStrike } from './boardTypes';
import { BlockerList } from './BlockerList';
import { Pill, ROW_BORDER, type Tone } from './CarStatusPill';
import { MergeStepTracker } from './MergeStepTracker';
import { STRIKE_PILL, STRIKE_REVIEW_CONFIRM, mergingPill, strikeLaneHeading, strikeMergeConfirm } from './trainCopy';
import { useInvalidateBoard, type LiveMergeRun } from './useMergeTrainBoard';

export const STRIKE_TONE: Record<StrikeState, Tone> = {
  'checks-pending': 'info',
  reviewing: 'info',
  flagged: 'destructive',
  'waiting-uat': 'warning',
  queued: 'info',
  merging: 'info',
  failed: 'destructive',
  blocked: 'destructive',
  ready: 'success',
};

const MERGE_STATES: ReadonlySet<StrikeState> = new Set(['waiting-uat', 'ready', 'reviewing']);
const ACTION_CLASS = 'shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50';

function StrikeRow({ strike, run, onNavigateIssue }: {
  strike: TrainStrike;
  run?: LiveMergeRun;
  onNavigateIssue?: (issueId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const confirm = useConfirm();
  const invalidate = useInvalidateBoard();
  const step = run?.step ?? strike.step;
  const notes = run?.notes ?? strike.notes;

  const merge = useMutation({
    mutationFn: () => postJson<{ success?: boolean; error?: string }>(`/api/merge-train/strikes/${encodeURIComponent(strike.issueId)}/merge`),
    onSuccess: () => { toast.success(`Merging strike ${strike.issueId}`); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Strike merge failed'),
  });

  const onMerge = async () => {
    const copy = strike.state === 'reviewing' ? STRIKE_REVIEW_CONFIRM : strikeMergeConfirm(strike.issueId, strike.prNumber);
    if (await confirm(copy)) merge.mutate();
  };

  const canMerge = MERGE_STATES.has(strike.state);
  const canRetry = strike.state === 'failed';
  const hasDetail = strike.state === 'flagged' || strike.blockers.length > 0 || strike.state === 'merging' || strike.state === 'failed' || !!notes;
  const pillText = strike.state === 'merging' ? mergingPill(step) : STRIKE_PILL[strike.state];

  return (
    <div
      data-testid={`strike-${strike.issueId}`}
      data-state={strike.state}
      className={`rounded-md border border-border border-l-2 bg-card ${ROW_BORDER[STRIKE_TONE[strike.state] === 'success' ? 'muted' : STRIKE_TONE[strike.state]]}`}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 px-2 py-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${strike.issueId}`}
          disabled={!hasDetail}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-[11rem] flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          {hasDetail
            ? (expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />)
            : <span className="w-3.5 shrink-0" />}
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{strike.issueId}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={strike.title}>{strike.title}</span>
        </button>
        <a href={strike.prUrl} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-[11px] text-primary-ink hover:underline">
          #{strike.prNumber} ↗
        </a>
        <Pill tone={STRIKE_TONE[strike.state]} spin={strike.state === 'merging'} testId={`strike-pill-${strike.issueId}`}>{pillText}</Pill>
        {canMerge && (
          <button type="button" className={ACTION_CLASS} disabled={merge.isPending} onClick={() => void onMerge()} data-testid={`strike-merge-${strike.issueId}`}>
            {merge.isPending ? 'Merging…' : 'Merge'}
          </button>
        )}
        {canRetry && (
          <button type="button" className={ACTION_CLASS} disabled={merge.isPending} onClick={() => merge.mutate()} data-testid={`strike-retry-${strike.issueId}`}>
            {merge.isPending ? 'Retrying…' : 'Retry'}
          </button>
        )}
      </div>
      {expanded && hasDetail && (
        <div className="space-y-2 border-t border-border px-3 py-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-x-3 text-muted-foreground">
            <span className="font-mono">{strike.branch}</span>
            {onNavigateIssue && (
              <button type="button" onClick={() => onNavigateIssue(strike.issueId)} className="text-primary-ink hover:underline">Open issue</button>
            )}
          </div>
          {strike.state === 'flagged' && strike.reviewSummary && (
            <p className="whitespace-pre-wrap leading-snug text-destructive-foreground" data-testid={`strike-review-summary-${strike.issueId}`}>
              {strike.reviewSummary}
            </p>
          )}
          <BlockerList blockers={strike.blockers} />
          {(strike.state === 'merging' || strike.state === 'failed')
            ? <MergeStepTracker step={step} failed={strike.state === 'failed'} notes={notes} />
            : notes && <p className="leading-snug text-muted-foreground">{notes}</p>}
        </div>
      )}
    </div>
  );
}

export function StrikeLane({ strikes, runs, onNavigateIssue }: {
  strikes: readonly TrainStrike[];
  runs?: ReadonlyMap<string, LiveMergeRun>;
  onNavigateIssue?: (issueId: string) => void;
}) {
  if (strikes.length === 0) return null;
  return (
    <section data-testid="strike-lane" className="space-y-1.5">
      <h4 className="text-[12px] font-medium text-foreground">{strikeLaneHeading(strikes.length)}</h4>
      {strikes.map((strike) => (
        <StrikeRow key={strike.issueId} strike={strike} run={runs?.get(strike.issueId.toUpperCase())} onNavigateIssue={onNavigateIssue} />
      ))}
    </section>
  );
}
