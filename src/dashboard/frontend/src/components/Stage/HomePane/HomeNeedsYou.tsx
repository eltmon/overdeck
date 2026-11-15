import { forwardRef } from 'react'
import type { NeedsYouItem, NeedsYouKind } from '../../../lib/selectors/needsYou'

const TAG: Record<NeedsYouKind, string> = {
  'pending-input': 'waiting on you',
  issue: 'needs you',
  flywheel: 'flywheel',
  decision: 'decision',
}

const ACTION: Record<NeedsYouKind, string> = {
  'pending-input': 'Answer',
  issue: 'Open',
  flywheel: 'Open Flywheel',
  decision: 'Decide',
}

function itemId(item: NeedsYouItem): string {
  return item.key.startsWith('issue:') ? item.key.slice('issue:'.length) : ''
}

export interface HomeNeedsYouProps {
  items: readonly NeedsYouItem[]
}

/**
 * PAN-5294 G-D12 — the project Home's Needs you panel: one amber-bordered
 * card with a row per item (id, title, kind tag, the ask, one action). It
 * renders nothing when nothing is waiting.
 */
export const HomeNeedsYou = forwardRef<HTMLElement, HomeNeedsYouProps>(function HomeNeedsYou({ items }, ref) {
  if (items.length === 0) return null

  return (
    <section ref={ref} aria-label="Needs you" className="flex flex-col gap-2.5">
      <h3 className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-state-needs-you" />
        Needs you
      </h3>
      <div className="overflow-hidden rounded-[10px] border badge-border-state-needs-you bg-card">
        {items.map((item) => (
          <div
            key={item.key}
            data-testid="needs-you-row"
            data-kind={item.kind}
            className="grid items-center gap-3 border-b border-border px-3.5 py-2 last:border-b-0"
            style={{ gridTemplateColumns: '92px minmax(0,1fr) 130px minmax(0,240px) 120px' }}
          >
            <span className="truncate font-mono text-[12px] text-muted-foreground">{itemId(item)}</span>
            <span className="truncate text-[13px] text-foreground" title={item.title}>{item.title}</span>
            <span className="min-w-0">
              <span className="inline-block max-w-full truncate rounded-md border badge-bg-state-needs-you badge-border-state-needs-you px-2 py-0.5 text-[11px] text-state-needs-you">
                {TAG[item.kind]}
              </span>
            </span>
            <span className="truncate text-[12px] text-muted-foreground" title={item.ask}>{item.ask}</span>
            <span className="text-right">
              <button
                type="button"
                onClick={() => item.open()}
                className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2.5 text-[12px] text-foreground hover:bg-accent"
              >
                {ACTION[item.kind]}
              </button>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
})
