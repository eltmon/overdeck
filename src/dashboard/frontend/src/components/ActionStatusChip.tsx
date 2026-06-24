export function ActionStatusChip({ status, className = '' }: { status: string; className?: string }) {
  return (
    <span
      data-testid="action-status-chip"
      className={`inline-flex h-5 max-w-full items-center rounded-sm border border-border bg-muted/40 px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground ${className}`}
      title={`Action status: ${status}`}
    >
      <span className="truncate">{status}</span>
    </span>
  );
}
