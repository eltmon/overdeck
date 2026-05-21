import { AlertTriangle, Brush, CheckCircle2, ClipboardList, Rocket, Search, ShipWheel } from 'lucide-react';
import type { ComponentType } from 'react';
import type { MemoryObservation, MemoryStatus, MemoryStatusPhase } from '@panctl/contracts';
import type { Issue } from '../../types';

export interface WorkspaceStatusStats {
  additions: number;
  deletions: number;
  commits: number;
  prs: number;
}

interface WorkspaceStatusCardProps {
  issue: Pick<Issue, 'identifier' | 'title' | 'description'>;
  status?: MemoryStatus;
  observations: readonly MemoryObservation[];
  stats: WorkspaceStatusStats;
  onOpenWorkspaceHome: () => void;
  now?: Date;
}

const PHASE_CONFIG: Record<MemoryStatusPhase, { label: string; color: string; icon: ComponentType<{ className?: string }> }> = {
  exploring: { label: 'Exploring', color: 'var(--primary)', icon: Search },
  planning: { label: 'Planning', color: 'var(--signal-review, var(--primary))', icon: ClipboardList },
  building: { label: 'Building', color: 'var(--success, #10b981)', icon: Brush },
  verifying: { label: 'Verifying', color: 'var(--warning, #f59e0b)', icon: CheckCircle2 },
  cleaning: { label: 'Cleaning', color: 'var(--muted-foreground)', icon: ShipWheel },
  shipping: { label: 'Shipping', color: 'var(--primary)', icon: Rocket },
};

function recentActionObservations(observations: readonly MemoryObservation[]): MemoryObservation[] {
  return observations
    .filter((observation) => observation.actionStatus !== null)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 3);
}

function isStale(observation: MemoryObservation | undefined, now: Date): boolean {
  if (!observation) return false;
  const timestamp = Date.parse(observation.timestamp);
  return !Number.isNaN(timestamp) && now.getTime() - timestamp > 60 * 60 * 1000;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold" style={{ color: tone ?? 'var(--foreground)' }}>{value}</span>
    </div>
  );
}

export function WorkspaceStatusCard({
  issue,
  status,
  observations,
  stats,
  onOpenWorkspaceHome,
  now = new Date(),
}: WorkspaceStatusCardProps) {
  const phase = status?.phase ?? 'exploring';
  const phaseConfig = PHASE_CONFIG[phase];
  const PhaseIcon = phaseConfig.icon;
  const recent = recentActionObservations(observations);
  const stale = isStale(recent[0], now);
  const headline = status?.headline || issue.title;
  const summary = status?.summary || issue.description || 'No workspace status summary yet.';

  return (
    <button
      type="button"
      data-testid="workspace-status-card"
      onClick={onOpenWorkspaceHome}
      className="w-full text-left bg-card border border-border rounded-lg p-3 hover:border-primary/50 hover:bg-popover transition-colors"
      aria-label={`Open ${issue.identifier} workspace overview`}
    >
      <div className="flex items-start gap-3">
        <div
          data-testid="workspace-status-phase-icon"
          data-phase={phase}
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border"
          style={{ color: phaseConfig.color, borderColor: phaseConfig.color, background: 'color-mix(in srgb, currentColor 10%, transparent)' }}
        >
          <PhaseIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground" title={headline}>{headline}</h3>
            <span
              data-testid="workspace-status-phase-label"
              className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: phaseConfig.color, borderColor: phaseConfig.color }}
            >
              {phaseConfig.label}
            </span>
            {stale && (
              <span data-testid="workspace-status-stale" className="ml-auto flex shrink-0 items-center gap-1 text-[10px] font-semibold text-warning">
                <AlertTriangle className="h-3 w-3" />
                Stale
              </span>
            )}
          </div>
          <p
            data-testid="workspace-status-summary"
            className="mt-1 text-xs text-muted-foreground"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {summary}
          </p>
        </div>
      </div>

      <ul data-testid="workspace-status-observations" className="mt-3 space-y-1 text-xs text-muted-foreground">
        {recent.length === 0 ? (
          <li className="text-muted-foreground/70">No recent action status.</li>
        ) : recent.map((observation) => (
          <li key={observation.id} className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0 truncate">{observation.actionStatus}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 grid grid-cols-4 gap-3 border-t border-border pt-3">
        <Stat label="Additions" value={`+${stats.additions}`} tone="var(--success, #10b981)" />
        <Stat label="Deletions" value={`-${stats.deletions}`} tone="var(--destructive)" />
        <Stat label="Commits" value={stats.commits} />
        <Stat label="PRs" value={stats.prs} />
      </div>
    </button>
  );
}
