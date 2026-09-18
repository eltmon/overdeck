/**
 * RailCard — the collapsible card primitive for the Flywheel control rail (PAN-1694 v3).
 *
 * Every rail section (Merge queue, Merge policy, Pending auto-merges, Run status)
 * is one of these: an uppercase header with icon + count + chevron, and a body
 * that collapses. Matches `.card`/`.chead`/`.cbody` in the approved v3 mockup
 * (docs/design/flywheel-redesign-mockup-v3.html).
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface RailCardProps {
  icon?: ReactNode;
  label: string;
  /** Right-aligned summary text in the header, e.g. "3 ready" or "3 auto · 2 hold". */
  count?: ReactNode;
  defaultCollapsed?: boolean;
  ariaLabel?: string;
  children: ReactNode;
}

export function RailCard({ icon, label, count, defaultCollapsed = false, ariaLabel, children }: RailCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section className="shrink-0 border-b border-border" aria-label={ariaLabel ?? label}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left hover:bg-accent/40"
      >
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-foreground">
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {icon}
          {label}
        </span>
        {count != null && <span className="text-[10px] font-semibold text-muted-foreground">{count}</span>}
      </button>
      {!collapsed && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}
