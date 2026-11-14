/**
 * One car in the merge-train queue (PAN-4753 WI-10, FR-20).
 *
 * Collapsed: chevron, order number, issue id, title, status pill and one
 * action (Cancel during the cooldown, Retry after a failure, Merge when ready
 * or waiting for a batch). Expanded: full title, branch, PR links, "ready N
 * ago", the editable merge policy, blockers, reviewer UAT notes, and the
 * 9-step tracker while merging or after a failure.
 *
 * R3 / D2: Merge on a car that belongs to a live batch first asks, naming the
 * batch it will void.
 */
import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '../../DialogProvider';
import { AutoMergeToggle } from '../../AutoMergeToggle';
import { postJson } from '../mergeTrainApi';
import type { TrainCar } from './boardTypes';
import { BlockerList } from './BlockerList';
import { CarStatusPill, ROW_BORDER, carTone } from './CarStatusPill';
import { MergeStepTracker } from './MergeStepTracker';
import {
  BLOCKED_BY_LABEL,
  MERGE_POLICY_LABEL,
  UAT_NOTES_LABEL,
  mergeAloneConfirm,
  mergeCarConfirm,
  readyAgo,
  retryCarConfirm,
} from './trainCopy';
import { deleteJson, useInvalidateBoard, useNow, type LiveMergeRun } from './useMergeTrainBoard';

export interface TrainCarRowProps {
  car: TrainCar;
  order: number;
  projectKey: string;
  projectName: string;
  /** The live merge run, which advances the step between board polls. */
  run?: LiveMergeRun;
  onNavigateIssue?: (issueId: string) => void;
}

type MergeNextResult = { outcomes?: Array<{ issueId: string; result: string; reason?: string }> };

const ACTION_CLASS = 'shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50';

export function TrainCarRow({ car, order, projectKey, projectName, run, onNavigateIssue }: TrainCarRowProps) {
  const [expanded, setExpanded] = useState(false);
  const confirm = useConfirm();
  const invalidate = useInvalidateBoard();
  const now = useNow(60_000, expanded);
  const step = run?.step ?? car.step;
  const notes = run?.notes ?? car.notes;
  const shown = { ...car, step };

  const cancel = useMutation({
    mutationFn: () => deleteJson(`/api/merge-train/auto-merge/${encodeURIComponent(car.issueId)}`),
    onSuccess: () => { toast.success(`Cancelled the auto-merge of ${car.issueId}`); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Cancel failed'),
  });
  const retry = useMutation({
    mutationFn: () => postJson<{ success?: boolean; error?: string }>(`/api/issues/${encodeURIComponent(car.issueId)}/merge`),
    onSuccess: () => { toast.success(`Retrying the merge of ${car.issueId}`); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Retry failed'),
  });
  const merge = useMutation({
    mutationFn: () => postJson<MergeNextResult>('/api/merge-train/merge-next', { n: 1, project: projectKey, issueId: car.issueId }),
    onSuccess: (data) => {
      const first = data.outcomes?.[0];
      if (first?.result === 'merged') toast.success(`Merged ${first.issueId} to main`);
      else toast.warning(`${first?.issueId ?? car.issueId} did not merge: ${first?.reason ?? 'unknown'}`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Merge failed'),
  });

  const onMerge = async () => {
    const copy = car.liveBatch ? mergeAloneConfirm(car.issueId, car.liveBatch) : mergeCarConfirm(car.issueId, projectName);
    if (await confirm(copy)) merge.mutate();
  };
  const onRetry = async () => {
    if (await confirm(retryCarConfirm(car.issueId))) retry.mutate();
  };

  let action: ReactNode = null;
  if (car.state === 'cooldown') {
    action = (
      <button type="button" className={ACTION_CLASS} disabled={cancel.isPending} onClick={() => cancel.mutate()} data-testid={`car-cancel-${car.issueId}`}>
        {cancel.isPending ? 'Cancelling…' : 'Cancel'}
      </button>
    );
  } else if (car.state === 'failed') {
    action = (
      <button type="button" className={ACTION_CLASS} disabled={retry.isPending} onClick={() => void onRetry()} data-testid={`car-retry-${car.issueId}`}>
        {retry.isPending ? 'Retrying…' : 'Retry'}
      </button>
    );
  } else if (car.state === 'ready' || car.state === 'held') {
    action = (
      <button type="button" className={ACTION_CLASS} disabled={merge.isPending} onClick={() => void onMerge()} data-testid={`car-merge-${car.issueId}`}>
        {merge.isPending ? 'Merging…' : 'Merge'}
      </button>
    );
  }

  const ago = readyAgo(car.readyAt, now);
  const showTracker = car.state === 'merging' || car.state === 'failed' || run?.failed === true;

  return (
    <div
      data-testid={`train-car-${car.issueId}`}
      data-state={car.state}
      className={`rounded-md border border-border border-l-2 bg-card ${ROW_BORDER[carTone(car.state)]}`}
    >
      <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${car.issueId}`}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="w-4 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{order}</span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{car.issueId}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={car.title}>{car.title}</span>
        </button>
        <CarStatusPill car={shown} />
        {action}
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-border px-3 py-2 text-[11px]" data-testid={`train-car-detail-${car.issueId}`}>
          <p className="text-[12px] leading-snug text-foreground">{car.title}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            <span className="font-mono">{car.branch}</span>
            {car.prs.map((pr) => pr.url
              ? <a key={pr.label} href={pr.url} target="_blank" rel="noreferrer" className="font-mono text-primary-ink hover:underline">{pr.label} ↗</a>
              : <span key={pr.label} className="font-mono">{pr.label}</span>)}
            {ago && <span>{ago}</span>}
            {onNavigateIssue && (
              <button type="button" onClick={() => onNavigateIssue(car.issueId)} className="text-primary-ink hover:underline">
                Open issue
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">{MERGE_POLICY_LABEL}</span>
            <AutoMergeToggle
              issueId={car.issueId}
              compact
              policy={car.policy}
              effectivePolicy={car.effectivePolicy}
              writable={car.policyWritable}
            />
          </div>
          {car.blockers.length > 0 && (
            <div className="space-y-1">
              <div className="text-muted-foreground">{BLOCKED_BY_LABEL}</div>
              <BlockerList blockers={car.blockers} />
            </div>
          )}
          {car.uatNotes && (
            <div className="space-y-1" data-testid={`car-uat-notes-${car.issueId}`}>
              <div className="text-muted-foreground">{UAT_NOTES_LABEL}</div>
              <p className="whitespace-pre-wrap rounded-md bg-muted px-2 py-1.5 leading-snug text-foreground">{car.uatNotes}</p>
            </div>
          )}
          {showTracker && <MergeStepTracker step={step} failed={car.state === 'failed' || run?.failed === true} notes={notes} />}
          {!showTracker && notes && <p className="leading-snug text-muted-foreground">{notes}</p>}
        </div>
      )}
    </div>
  );
}
