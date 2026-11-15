/**
 * One non-hero batch of a project's chain (PAN-4753 WI-10, FR-7): a single
 * collapsed line "Older batch <name> · voided" that expands to the full
 * `BatchCard`, so a superseded or voided batch and its reason are never
 * hidden.
 */
import { useState, type ReactNode } from 'react';
import type { UatGenerationPayload } from './boardTypes';
import { HIDE_OLDER_LABEL, SHOW_LABEL, olderBatchStatus, shortName } from './trainCopy';

export function OlderBatchRow({ gen, children }: { gen: UatGenerationPayload; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div data-testid={`older-batch-${shortName(gen.name)}`} className="space-y-1">
        {children}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {HIDE_OLDER_LABEL}
        </button>
      </div>
    );
  }
  return (
    <div
      data-testid={`older-batch-${shortName(gen.name)}`}
      className="flex flex-wrap items-center gap-x-1 rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground"
    >
      <span>Older batch</span>
      <span className="font-mono text-foreground">{shortName(gen.name)}</span>
      <span>· {olderBatchStatus(gen.status)}</span>
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
