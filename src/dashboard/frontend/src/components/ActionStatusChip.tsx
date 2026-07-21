/**
 * Small status chip for a memory observation's lifecycle token (e.g. `blocked`,
 * `done`, `in_progress`). The memory extractor stores a terse lifecycle token in
 * `actionStatus` and the human-readable outcome in `summary`; activity feeds show
 * the `summary` as the headline and this chip carries the at-a-glance status.
 *
 * Styling intentionally matches the existing tag pills (neutral, bordered) to
 * respect the dashboard color-restraint rules — status is conveyed by the word,
 * not by decorative color.
 */
export function ActionStatusChip({ status, className = '' }: { status: string; className?: string }) {
  return (
    <span
      data-testid="action-status-chip"
      className={`shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground ${className}`.trim()}
    >
      {status}
    </span>
  );
}
