import type { UpdatePhase } from '@overdeck/contracts';

const TOOLTIP = 'Click to update Overdeck to the latest version.';

export function VersionUpdateButton({ currentVersion, phase = 'idle', onOpen }: { currentVersion: string; phase?: UpdatePhase; onOpen: () => void }) {
  const decorated = ['checking', 'available', 'ready', 'error'].includes(phase);
  return (
    <span className="group relative inline-flex shrink-0">
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-normal text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Overdeck version ${currentVersion}. ${TOOLTIP}`}
        aria-describedby="overdeck-update-tooltip"
        title={TOOLTIP}
      >
        v{currentVersion}
        {decorated && <span className={`h-1.5 w-1.5 rounded-full ${phase === 'error' ? 'bg-destructive' : phase === 'ready' ? 'bg-success' : 'bg-primary'}`} aria-label={`Update status: ${phase}`} />}
      </button>
      <span id="overdeck-update-tooltip" role="tooltip" className="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden w-56 rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md group-hover:block group-focus-within:block">
        {TOOLTIP}
      </span>
    </span>
  );
}
