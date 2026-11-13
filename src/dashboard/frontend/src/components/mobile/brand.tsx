/**
 * Shared brand pieces for the phone screens (PAN-5208): the `/m` web shell and the phone app's
 * shell screens import these so both surfaces speak one visual language.
 *
 * Token classes only, so the pieces render under every theme scope (Broadsheet and Ledger, light
 * and dark). The one exception is `MARK_CLASSES`: the control-ring mark's own brand colors from
 * `logo/overdeck-dark.svg` / `logo/overdeck-light.svg`, which live only here.
 *
 * `lucide-react` resolves only from `src/dashboard/frontend/node_modules`, so files under
 * `apps/mobile/src` import their icons from this module, never from `lucide-react` directly.
 */
import type { ReactNode } from 'react';

import { OverdeckMark } from '../OverdeckMark';

export { Plus as PlusIcon, Settings as SettingsIcon } from 'lucide-react';

/** The control-ring mark's brand colors, light then dark (PAN-5208 D-13). */
export const MARK_CLASSES = {
  ring: 'stroke-[#4f46e5] dark:stroke-[#6366f1]',
  hub: 'fill-[#4f46e5] dark:fill-[#6366f1]',
  satellite: 'fill-[#818cf8] dark:fill-[#a5b4fc]',
  wordmark: 'text-[#2d2d2d] dark:text-[#f5f0ea]',
} as const;

/** The settled mark plus the "Overdeck" wordmark, sized by the height in `className` (for example `h-6`). */
export function OverdeckLockup({ className = '' }: { className?: string }) {
  return (
    <span data-component="overdeck-lockup" className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 40 40" aria-hidden="true" className="h-full w-auto shrink-0" fill="none">
        <circle cx="20" cy="20" r="12.5" strokeWidth="4" fill="none" className={MARK_CLASSES.ring} />
        <circle cx="20" cy="20" r="4.5" className={MARK_CLASSES.hub} />
        <circle cx="30.8" cy="13.2" r="3.4" className={MARK_CLASSES.satellite} />
      </svg>
      <span className={`font-display text-lg font-[600] leading-none tracking-[0.02em] ${MARK_CLASSES.wordmark}`}>Overdeck</span>
    </span>
  );
}

/**
 * A faint control-ring mark centered behind a landing page's content (PAN-5208 FR-9). Place it
 * first inside a `relative` wrapper, before the scroller, so it never scrolls and never takes taps.
 */
export function LogoWatermark() {
  return (
    <div
      aria-hidden="true"
      data-component="logo-watermark"
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
    >
      <OverdeckMark className="h-auto w-[min(78vw,360px)] text-primary opacity-[0.05] dark:opacity-[0.04]" />
    </div>
  );
}

/** A centered empty state: the title, then a one-line detail. */
export function MobileEmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div data-component="mobile-empty-state" className="flex flex-col items-center gap-1 px-6 py-16 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

/** A tappable list row: title and secondary line on the left, age on the right. */
export const MOBILE_ROW_CLASS = 'flex min-h-14 w-full items-start justify-between gap-3 px-4 py-3 text-left active:bg-muted';
export const MOBILE_ROW_TITLE_CLASS = 'block truncate text-[15px] font-medium text-foreground';
export const MOBILE_ROW_META_CLASS = 'block text-xs text-muted-foreground';
export const MOBILE_ROW_AGE_CLASS = 'shrink-0 text-xs tabular-nums text-muted-foreground';

/** The phone screens' top bar, with the safe-area inset above it. */
export function MobileScreenHeader({ leading, title, trailing }: { leading?: ReactNode; title?: string; trailing?: ReactNode }) {
  return (
    <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-border bg-card/80 px-4 pt-[env(safe-area-inset-top)] backdrop-blur">
      {leading}
      {title ? <h1 className="text-base font-medium text-foreground">{title}</h1> : null}
      {trailing ? <div className="ml-auto flex items-center gap-1">{trailing}</div> : null}
    </header>
  );
}
