/**
 * A run of identical voided rebuilds as one older row (PAN-5364 FR-8):
 * "8 rebuilds voided, <oldest> to <newest>, same members". **show** expands it
 * into one `OlderBatchRow` per batch, so every batch stays reachable.
 */
import { useState } from 'react';
import type { UatGenerationPayload } from './boardTypes';
import { BatchCard } from './BatchCard';
import { OlderBatchRow } from './OlderBatchRow';
import { HIDE_LABEL, SHOW_LABEL, identicalRunLine, shortName } from './trainCopy';

export interface OlderBatchRunProps {
  /** The run's batches in chain order (newest first). */
  gens: readonly UatGenerationPayload[];
  projectKey: string;
  projectName: string;
  mergeEnabled?: boolean;
  onNavigateIssue?: (issueId: string) => void;
}

export function OlderBatchRun({ gens, projectKey, projectName, mergeEnabled = true, onNavigateIssue }: OlderBatchRunProps) {
  const [open, setOpen] = useState(false);
  const testId = `older-batch-run-${shortName(gens[0]?.name ?? '')}`;
  if (open) {
    return (
      <div data-testid={testId} className="space-y-1.5">
        {gens.map((g) => (
          <OlderBatchRow key={g.name} gen={g}>
            <BatchCard gen={g} projectKey={projectKey} projectName={projectName} mergeEnabled={mergeEnabled} onNavigateIssue={onNavigateIssue} />
          </OlderBatchRow>
        ))}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {HIDE_LABEL}
        </button>
      </div>
    );
  }
  return (
    <div
      data-testid={testId}
      className="flex flex-wrap items-center gap-x-1 rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground"
    >
      <span>{identicalRunLine(gens)}</span>
      <button
        type="button"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className="ml-1 underline-offset-2 hover:text-foreground hover:underline"
      >
        {SHOW_LABEL}
      </button>
    </div>
  );
}
