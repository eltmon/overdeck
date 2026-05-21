import { ShieldCheck } from 'lucide-react';

// TODO(PAN-1148): consolidate into VerbBadge
export function VerifyingOnMainBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-fuchsia-400/50 bg-fuchsia-950/70 font-bold uppercase tracking-wide text-fuchsia-200 ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'}`}
      title="Merged to main and awaiting final verification close-out"
      data-testid="verifying-on-main-badge"
    >
      <ShieldCheck className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      VERIFYING
    </span>
  );
}
