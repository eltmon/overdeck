/**
 * Small shared pieces for the Flywheel page (PAN-3964). Badges follow the
 * style guide's formula — 8 % tint, 32 % border, theme radius via the
 * `badge-bg-*` class — and each tone means one thing:
 *   info    a machine is working (the loop is running, a tick is live)
 *   warning a human must act (paused, needs-you, breathing between ticks)
 *   destructive broken (stalled, unreachable)
 *   success an outcome (merged, green)
 *   neutral rest state
 */
import type { ReactNode } from 'react';

export type Tone = 'info' | 'warning' | 'destructive' | 'success' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
  info: 'badge-bg-info badge-border-info text-info-foreground',
  warning: 'badge-bg-warning badge-border-warning text-warning-foreground',
  destructive: 'badge-bg-destructive badge-border-destructive text-destructive-foreground',
  success: 'badge-bg-success badge-border-success text-success',
  neutral: 'badge-bg-muted badge-border-muted text-muted-foreground',
};

export function StatusBadge({ tone, children, title, testId }: { tone: Tone; children: ReactNode; title?: string; testId?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]}`}
      title={title}
      data-testid={testId}
      data-tone={tone}
    >
      {children}
    </span>
  );
}

/** On/off switch for the header policies; mirrors the Merge train section's switch. */
export function ToggleSwitch({ label, checked, disabled, title, onChange }: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground disabled:opacity-50"
    >
      <span className={`relative h-4 w-7 rounded-full border transition-colors ${checked ? 'border-primary/60 bg-primary/25' : 'border-border bg-muted'}`}>
        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all ${checked ? 'left-[14px] bg-primary' : 'left-0.5 bg-muted-foreground'}`} />
      </span>
      {label}
    </button>
  );
}

/** A titled card in the left rail (v1 `RailCard`, deleted in the PAN-3917 cut). */
export function RailCard({ label, ariaLabel, actions, children }: {
  label: string;
  ariaLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border px-4 py-3" aria-label={ariaLabel ?? label}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ title, detail }: { title: ReactNode; detail?: ReactNode }) {
  return (
    <div className="flex min-h-[160px] items-center justify-center rounded-md border border-dashed border-border p-6 text-center">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
      </div>
    </div>
  );
}
