/**
 * Shared controls for the skill overrides panel and the skill packs section:
 * one switch, one Inherit | On | Off group, and one collapsible group header,
 * so skills and packs read as the same kind of list.
 */
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SkillSwitchProps {
  checked: boolean;
  label: string;
  disabled?: boolean;
  /** Core skills: shown on, never changeable. */
  locked?: boolean;
  onToggle: () => void;
}

export function SkillSwitch({ checked, label, disabled = false, locked = false, onToggle }: SkillSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || locked}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed',
        checked ? (locked ? 'switch-track-locked border-transparent' : 'switch-track-on border-transparent') : 'border-border bg-muted',
        disabled && !locked && 'opacity-60',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block h-3 w-3 rounded-full shadow-sm transition-transform duration-150',
          checked ? 'translate-x-[15px] bg-background' : 'translate-x-[2px] bg-muted-foreground',
        )}
      />
    </button>
  );
}

export interface LevelChoiceProps {
  label: string;
  current: boolean | null;
  inheritLabel: string;
  saving: boolean;
  onSet: (value: boolean | null) => void;
}

/** Inherit | On | Off at project and issue level. */
export function LevelChoice({ label, current, inheritLabel, saving, onSet }: LevelChoiceProps) {
  return (
    <div role="group" aria-label={label} className="inline-flex shrink-0 rounded-md border border-border bg-background p-0.5 text-xs">
      {([[null, inheritLabel], [true, 'On'], [false, 'Off']] as const).map(([value, text]) => (
        <button
          key={String(value)}
          type="button"
          aria-pressed={current === value}
          disabled={saving}
          onClick={() => onSet(value)}
          className={cn(
            'rounded-[4px] px-2 py-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:cursor-not-allowed',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            current === value && 'bg-muted text-foreground',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export interface GroupHeaderProps {
  title: string;
  /** Accessible name of the expand button; defaults to the title. */
  buttonLabel?: string;
  open: boolean;
  onToggle: () => void;
  /** Quiet text after the title: origin, license, a note. */
  hint?: ReactNode;
  /** Right-aligned count, e.g. "72 of 72 on". */
  count?: ReactNode;
  /** Right-edge control (a pack's switch). */
  control?: ReactNode;
  mono?: boolean;
  children?: ReactNode;
}

export function GroupHeader({ title, buttonLabel, open, onToggle, hint, count, control, mono = false, children }: GroupHeaderProps) {
  return (
    <div className="list-group-bar px-3 py-2">
      <div className="flex min-h-7 items-center gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-label={buttonLabel}
          onClick={onToggle}
          className="-mx-1 flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left text-[13px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150', open && 'rotate-90')} />
          <span className={cn('truncate', mono && 'font-mono')}>{title}</span>
        </button>
        {hint && <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">{hint}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {count && <span className="font-mono-ui text-xs tabular-nums text-muted-foreground">{count}</span>}
          {control}
        </span>
      </div>
      {children}
    </div>
  );
}

/** Save failure on its own line, with Retry that resends the same change. */
export function RowError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p className="mt-1 flex items-center gap-2 text-xs text-destructive" role="alert">
      Save failed: {message}
      <button type="button" className="underline underline-offset-2" onClick={onRetry}>Retry</button>
    </p>
  );
}
