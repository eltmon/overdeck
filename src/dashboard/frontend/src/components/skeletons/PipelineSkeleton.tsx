/** Shimmer skeleton for the Pipeline view — matches TopBar, MetricStrip, filter row, and phase sections. */
export function PipelineSkeleton() {
  const phases = ['Ship', 'Review', 'Work', 'Plan'];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* TopBar */}
      <div className="flex h-[52px] shrink-0 items-center gap-[12px] border-b border-border bg-background px-[22px]">
        <div className="min-w-0 space-y-[4px]">
          <div className="h-[8px] w-[80px] animate-pulse rounded bg-muted" />
          <div className="h-[14px] w-[100px] animate-pulse rounded bg-muted" />
        </div>
        <div className="flex-1 h-[32px] min-w-[280px] animate-pulse rounded-[var(--radius-lg)] bg-muted" />
        <div className="h-[32px] w-[120px] animate-pulse rounded-[var(--radius-lg)] bg-muted" />
        <div className="ml-auto h-[32px] w-[110px] animate-pulse rounded-[var(--radius-lg)] bg-muted" />
      </div>

      {/* MetricStrip — 5 tiles */}
      <div className="flex shrink-0 border-b border-border bg-background">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex-1 border-r border-border last:border-r-0 px-[18px] py-[12px] space-y-[6px]">
            <div className="h-[10px] w-[70px] animate-pulse rounded bg-muted" />
            <div className="h-[20px] w-[40px] animate-pulse rounded bg-muted" />
            <div className="h-[9px] w-[55px] animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Filter row pills */}
      <div className="flex shrink-0 items-center gap-[8px] border-b border-border bg-background px-[22px] py-[10px]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`h-[28px] animate-pulse rounded-[var(--radius-sm)] bg-muted ${i === 0 ? 'w-[40px]' : 'w-[56px]'}`} />
        ))}
        <div className="ml-auto flex gap-[6px]">
          <div className="h-[28px] w-[70px] animate-pulse rounded-[var(--radius-sm)] bg-muted" />
          <div className="h-[28px] w-[60px] animate-pulse rounded-[var(--radius-sm)] bg-muted" />
        </div>
      </div>

      {/* Phase sections */}
      <div className="flex-1 overflow-auto">
        {phases.map((phase) => (
          <section key={phase}>
            {/* Phase header */}
            <div className="flex items-center gap-[10px] border-b border-border px-[22px] py-[12px]">
              <div className="h-[8px] w-[8px] animate-pulse rounded-full bg-muted" />
              <div className="h-[14px] w-[60px] animate-pulse rounded bg-muted" />
              <div className="h-[16px] w-[24px] animate-pulse rounded-[var(--radius-sm)] bg-muted" />
            </div>

            {/* Row placeholders */}
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-[10px] border-b border-border px-[22px] py-[12px]"
              >
                <div className="h-[10px] w-[10px] animate-pulse rounded bg-muted shrink-0" />
                <div className="h-[12px] flex-1 animate-pulse rounded bg-muted" />
                <div className="h-[18px] w-[90px] animate-pulse rounded bg-muted" />
                <div className="h-[10px] w-[55px] animate-pulse rounded bg-muted" />
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
