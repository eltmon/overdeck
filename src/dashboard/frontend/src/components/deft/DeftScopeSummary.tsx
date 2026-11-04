/**
 * A Deft issue's board-card line (PAN-4849 WI-8, PAN-4820 AD-20): a neutral
 * `Deft` chip and one count per non-empty scope folder. The card stays in
 * its usual board column; the folder-to-column mapping is shown here.
 */
import type { DeftIssueSummary, DeftScopeFolder } from '@overdeck/contracts';
import { CockpitPill } from '../Stage/cockpit/CockpitCard';
import { useDeftIssueSummary } from './queries';

/** AD-20 labels in board order. */
export const DEFT_FOLDER_LABELS: Array<[DeftScopeFolder, string]> = [
  ['active', 'In progress'],
  ['pending', 'Planned'],
  ['proposed', 'Proposed'],
  ['completed', 'Done'],
  ['cancelled', 'Cancelled'],
];

export function deftScopeLine(counts: DeftIssueSummary['scopeCounts']): string {
  return DEFT_FOLDER_LABELS
    .filter(([folder]) => (counts[folder] ?? 0) > 0)
    .map(([folder, label]) => `${label} ${counts[folder]}`)
    .join(' · ');
}

export function DeftScopeSummary({ issueId }: { issueId: string }) {
  const { isDeft, summary } = useDeftIssueSummary(issueId);
  if (!isDeft || !summary) return null;
  const line = deftScopeLine(summary.scopeCounts);
  return (
    <div data-testid={`deft-scope-summary-${issueId}`} className="mb-2 flex flex-wrap items-center gap-1.5">
      <CockpitPill tone="muted">Deft</CockpitPill>
      {line ? <span className="font-mono text-[11px] text-muted-foreground">{line}</span> : null}
    </div>
  );
}
