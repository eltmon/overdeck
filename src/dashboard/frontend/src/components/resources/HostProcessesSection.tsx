import type { HostProcessResource } from '../../types';

interface HostProcessesSectionProps {
  processes: HostProcessResource[];
  filter: string;
  onFocusRow: (id: string) => void;
}

export function HostProcessesSection({ processes, filter, onFocusRow }: HostProcessesSectionProps) {
  const rows = processes.filter((process) => matches(process, filter));
  if (rows.length === 0) return null;

  return (
    <section className="mb-6" aria-label="Host processes">
      <h2 className="mb-2 font-['DM_Mono'] text-xs uppercase text-muted-foreground">Host processes · {rows.length}</h2>
      <div className="divide-y divide-border border border-border">
        {rows.map((process) => {
          const retained = Boolean(process.retainedUntil);
          return (
            <button
              key={process.id}
              type="button"
              className={`grid w-full grid-cols-[1fr_140px_140px_1fr] items-center gap-3 bg-background px-4 py-3 text-left text-sm hover:bg-muted/40 focus:bg-muted focus:outline-none ${retained ? 'opacity-60' : ''}`}
              onFocus={() => onFocusRow(`process:${process.id}`)}
            >
              <span>
                <span className="block font-medium text-foreground">{process.label}</span>
                <span className="block text-xs text-muted-foreground">{process.owner.label} · {process.pidCount} pids</span>
              </span>
              <span className="font-['DM_Mono'] text-xs text-muted-foreground">{retained ? `0% now · ${process.peakCpuPercent}% peak` : `${process.cpuPercent}% CPU`}</span>
              <span className="font-['DM_Mono'] text-xs text-muted-foreground">{formatBytes(retained ? process.peakMemoryBytes : process.memoryBytes)}</span>
              <span className="text-xs text-muted-foreground">{process.note ?? ''}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function matches(process: HostProcessResource, filter: string) {
  const query = filter.trim().toLowerCase();
  if (!query) return true;
  return [process.id, process.family, process.label, process.owner.label, process.note]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${bytes} B`;
}
