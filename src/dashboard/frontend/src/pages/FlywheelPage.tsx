import { useEffect, useState } from 'react';
import type { FlywheelStatus } from '@panctl/contracts';
import { FlywheelConversationPane } from '../components/flywheel/FlywheelConversationPane';
import { FlywheelStatusDetails } from '../components/flywheel/FlywheelStatusDetails';
import { subscribeFlywheelStatus } from '../lib/wsTransport';

interface FlywheelPageProps {
  onOpenSettings?: () => void;
  onNavigateAgent?: (agentId: string) => void;
}

function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function FlywheelPage({ onOpenSettings, onNavigateAgent }: FlywheelPageProps) {
  const [status, setStatus] = useState<FlywheelStatus | null>(null);

  useEffect(() => subscribeFlywheelStatus(setStatus), []);

  return (
    <div
      aria-label="Flywheel page"
      className="grid h-full w-full grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] overflow-hidden bg-background"
    >
      <section className="min-w-0 overflow-y-auto border-r border-border" aria-label="Flywheel status pane">
        <header className="sticky top-0 z-10 border-b border-border bg-card/60 px-6 py-4 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Fix-All Flywheel</h1>
              <p className="mt-1 text-sm text-muted-foreground">Autonomous pipeline sweep across active Panopticon work.</p>
              <a
                href="https://github.com/eltmon/panopticon-cli/blob/main/docs/FLYWHEEL.md"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
              >
                Flywheel docs
              </a>
            </div>
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-right">
              <div className="flex items-center justify-end gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span className={status ? 'h-2 w-2 rounded-full bg-success' : 'h-2 w-2 rounded-full bg-muted-foreground'} />
                {status ? 'Live run' : 'Idle'}
              </div>
              <div className="mt-1 font-mono text-sm text-foreground">{status?.runId ?? 'No run'}</div>
            </div>
          </div>
          {status && (
            <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-md border border-border bg-background p-3">
                <dt className="uppercase tracking-wide text-muted-foreground">Elapsed</dt>
                <dd className="mt-1 font-medium text-foreground">{formatElapsed(status.elapsedMs)}</dd>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <dt className="uppercase tracking-wide text-muted-foreground">Ticks</dt>
                <dd className="mt-1 font-medium text-foreground">{status.ticks}</dd>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <dt className="uppercase tracking-wide text-muted-foreground">Last tick</dt>
                <dd className="mt-1 font-mono text-foreground">{new Date(status.lastTickAt).toLocaleTimeString()}</dd>
              </div>
            </dl>
          )}
        </header>

        <div className="p-6">
          {status ? (
            <FlywheelStatusDetails status={status} onNavigateAgent={onNavigateAgent} />
          ) : (
            <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
              <div>
                <p className="text-base font-medium text-foreground">No active run — <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">pan flywheel start</code> to begin.</p>
                <p className="mt-2 text-sm text-muted-foreground">The status pane will update as soon as the orchestrator emits its first snapshot.</p>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="min-w-0 overflow-hidden" aria-label="Flywheel conversation column">
        <FlywheelConversationPane onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
}
