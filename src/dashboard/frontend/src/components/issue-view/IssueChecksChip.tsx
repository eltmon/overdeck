/**
 * PAN-5244 · the drawer's PR checks chip.
 *
 * Shown in the pipeline strip when the issue has a PR. A click opens the
 * verification gates in a popover; the gates mount only while it is open.
 */
import { useRef, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';

import { cn } from '../../lib/utils';
import { MenuOverlay, PopoverSurface } from '../shared/ContextMenu';
import { VerificationGates } from './VerificationGates';

type Checks = 'green' | 'red' | 'pending';

const CHECKS: Record<Checks, { label: string; status: 'passed' | 'failed' | 'running' }> = {
  green: { label: 'Checks pass', status: 'passed' },
  red: { label: 'Checks failed', status: 'failed' },
  pending: { label: 'Checks running', status: 'running' },
};

export function IssueChecksChip({ issueId, checks }: { issueId: string; checks: Checks | undefined }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (!checks) return null;
  const { label, status } = CHECKS[checks];
  return (
    <div
      data-component="checks-chip"
      className="relative inline-flex"
      onKeyDown={(event) => {
        // The gates popover has nothing focusable, so focus stays on the chip:
        // handle Escape here, or it reaches the drawer and closes it.
        if (open && event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        data-testid="drawer-checks-chip"
        data-status={status}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Show the verification gates"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex h-[26px] items-center gap-[6px] whitespace-nowrap rounded-[var(--radius)] border border-border px-[9px] text-[12px] font-medium text-body-foreground transition-colors hover:bg-accent',
          open && 'bg-accent text-foreground',
        )}
      >
        {checks === 'green' ? <Check aria-hidden className="h-[14px] w-[14px] text-success-foreground" />
          : checks === 'red' ? <X aria-hidden className="h-[14px] w-[14px] text-destructive-foreground" />
          : <Loader2 aria-hidden className="h-[14px] w-[14px] animate-spin text-info-foreground motion-reduce:animate-none" />}
        {label}
      </button>
      {open && (
        <>
          <MenuOverlay onClick={() => setOpen(false)} />
          <PopoverSurface
            aria-label="Verification gates"
            data-testid="drawer-checks-popover"
            onClose={() => setOpen(false)}
            returnFocusRef={triggerRef}
            className="absolute right-0 top-full z-[1000] mt-1 w-[300px]"
          >
            <VerificationGates issueId={issueId} />
          </PopoverSurface>
        </>
      )}
    </div>
  );
}
