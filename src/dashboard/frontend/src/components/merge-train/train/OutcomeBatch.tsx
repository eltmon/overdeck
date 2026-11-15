/**
 * The merged batch in the hero slot (PAN-5364 FR-4..FR-6): when no live batch
 * remains and nothing happened after the last merge, the card leads with that
 * merge — "merged to main · <sha> · <ago>" over its batch card — and the
 * rebuilds that merge voided fold into one line under it, each still reachable
 * through **show**.
 */
import { useState } from 'react';
import type { UatGenerationPayload } from './boardTypes';
import { BatchCard } from './BatchCard';
import { batchMergedAt } from './batchSections';
import { OlderBatchRow } from './OlderBatchRow';
import { HIDE_LABEL, SHOW_LABEL, foldedRebuildsLine, outcomeLine } from './trainCopy';
import { useNow } from './useMergeTrainBoard';

export interface OutcomeBatchProps {
  gen: UatGenerationPayload;
  /** Voided batches whose `voidedBy` is this batch, chain order. */
  folded: readonly UatGenerationPayload[];
  projectKey: string;
  projectName: string;
  mergeEnabled?: boolean;
  onNavigateIssue?: (issueId: string) => void;
}

export function OutcomeBatch({ gen, folded, projectKey, projectName, mergeEnabled = true, onNavigateIssue }: OutcomeBatchProps) {
  const now = useNow(60_000);
  const [foldedOpen, setFoldedOpen] = useState(false);
  return (
    <>
      <p className="font-mono text-[12px] text-foreground" data-testid={`outcome-line-${projectKey}`}>
        {outcomeLine(gen, batchMergedAt(gen), now)}
      </p>
      <BatchCard gen={gen} projectKey={projectKey} projectName={projectName} mergeEnabled={mergeEnabled} onNavigateIssue={onNavigateIssue} />
      {folded.length > 0 && (
        <div className="space-y-1.5" data-testid={`outcome-folded-${projectKey}`}>
          <p className="text-[11px] text-muted-foreground">
            {foldedRebuildsLine(folded.map((g) => g.name))}{' '}
            <button
              type="button"
              aria-expanded={foldedOpen}
              onClick={() => setFoldedOpen((open) => !open)}
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              {foldedOpen ? HIDE_LABEL : SHOW_LABEL}
            </button>
          </p>
          {foldedOpen && folded.map((g) => (
            <OlderBatchRow key={g.name} gen={g}>
              <BatchCard gen={g} projectKey={projectKey} projectName={projectName} mergeEnabled={mergeEnabled} onNavigateIssue={onNavigateIssue} />
            </OlderBatchRow>
          ))}
        </div>
      )}
    </>
  );
}
