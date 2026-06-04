import type { ReactNode } from 'react'

export type CockpitTone =
  | 'info'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'review'
  | 'cost'
  | 'muted'

const DOT_CLASS: Record<CockpitTone, string> = {
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  review: 'bg-signal-review',
  cost: 'bg-signal-cost',
  muted: 'bg-muted-foreground',
}

/**
 * CockpitCard — the one section-card shell every issue-cockpit scan card uses,
 * so spacing/border/radius/header are defined once (Command Deck remodel S3).
 * House recipe: `rounded-[18px] border border-border bg-card`. The header is a
 * tone dot + title (Space Grotesk) with an optional right-aligned slot.
 */
export function CockpitCard({
  tone,
  title,
  right,
  children,
  className = '',
}: {
  tone: CockpitTone
  title: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-[18px] border border-border bg-card p-4 shadow-sm ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-[7px] w-[7px] rounded-full ${DOT_CLASS[tone]}`} />
        <h3 className="font-display text-[13px] font-semibold text-foreground">{title}</h3>
        {right != null && <div className="ml-auto flex items-center gap-2">{right}</div>}
      </div>
      {children}
    </div>
  )
}

// Explicit, literal class strings — Tailwind purges interpolated utilities, so
// each tone's text/badge classes must appear verbatim in source.
const PILL_CLASS: Record<CockpitTone, string> = {
  info: 'text-info-foreground badge-bg-info badge-border-info',
  success: 'text-success-foreground badge-bg-success badge-border-success',
  warning: 'text-warning-foreground badge-bg-warning badge-border-warning',
  destructive: 'text-destructive-foreground badge-bg-destructive badge-border-destructive',
  review: 'text-signal-review-foreground badge-bg-signal-review badge-border-signal-review',
  cost: 'text-signal-cost-foreground badge-bg-signal-cost badge-border-signal-cost',
  muted: 'text-muted-foreground badge-bg-muted badge-border-muted',
}

/** A small uppercase pill used across cockpit cards for statuses. */
export function CockpitPill({
  tone,
  children,
  className = '',
}: {
  tone: CockpitTone
  children: ReactNode
  className?: string
}) {
  const toneClass = PILL_CLASS[tone]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-[7px] py-[2px] text-[10px] font-semibold uppercase tracking-[0.05em] ${toneClass} ${className}`}
    >
      {children}
    </span>
  )
}
