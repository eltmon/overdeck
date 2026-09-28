import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { fetchWithTimeout } from '../../lib/apiFetch';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import type { GauntletRunLane, GauntletRunSessionFeedEntry } from './types';

interface GauntletRunFeedCardProps {
  entry: GauntletRunSessionFeedEntry;
  onSelect: (entryId: string) => void;
  now?: Date;
}

/** Same dot tokens as ConversationFeedCard, plus destructive for a failed run (running is not green). */
const STATE_DOT_COLORS: Record<GauntletRunSessionFeedEntry['state'], string> = {
  'needs-you': 'bg-warning',
  failed: 'bg-destructive',
  working: 'bg-info',
  idle: 'bg-muted-foreground/60',
  stopped: 'bg-muted-foreground/60',
};

/** The `GET /api/lanes` fields the card reads (LaneView, src/lib/lanes/views.ts). */
interface LaneDetail {
  name: string;
  projectKey: string | null;
  archived: boolean;
  key: string;
  role: string;
  git: { branch: string | null; head: string | null; ahead: number | null; dirty: boolean } | null;
}

async function fetchRunLanes(run: string): Promise<LaneDetail[]> {
  const res = await fetchWithTimeout(`/api/lanes?run=${encodeURIComponent(run)}`);
  if (!res.ok) throw new Error('Failed to fetch lanes');
  const body = (await res.json()) as { lanes: LaneDetail[] };
  return body.lanes;
}

/**
 * PAN-4301 run card: one card per gauntlet run. The main area opens the
 * orchestrator conversation; the expand control lists the lanes and fetches
 * their git facts once (no polling).
 */
export function GauntletRunFeedCard({ entry, onSelect, now = new Date() }: GauntletRunFeedCardProps) {
  const [expanded, setExpanded] = useState(false);
  const details = useQuery({
    queryKey: ['lanes', entry.projectKey, entry.run],
    queryFn: () => fetchRunLanes(entry.run),
    enabled: expanded,
    staleTime: 60_000,
  });

  const projectLanes = (details.data ?? []).filter((lane) => lane.projectKey === entry.projectKey);
  const detailByName = new Map(projectLanes.map((lane) => [lane.name, lane]));
  const cardLaneNames = new Set(entry.lanes.map((lane) => lane.name));
  const archivedLanes = projectLanes.filter((lane) => lane.archived && !cardLaneNames.has(lane.name));

  return (
    <div className="w-full rounded-lg border border-border bg-card text-xs">
      <div className="flex items-start">
        <button
          type="button"
          className="min-w-0 flex-1 rounded-lg p-2.5 text-left transition-colors hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
          onClick={() => onSelect(entry.id)}
        >
          <div className="flex items-start gap-2">
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT_COLORS[entry.state]}`} />
            <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-foreground">
                  {`${entry.run.toUpperCase()} · ${entry.projectKey ?? 'no project'}`}
                </span>
                <time dateTime={entry.timestamp} className="shrink-0 text-[10px] text-muted-foreground">
                  {formatRelativeTime(entry.timestamp, now)}
                </time>
              </div>
              <p className="mt-1 text-muted-foreground">{entry.countsLine}</p>
              <p className="mt-1 line-clamp-2 text-muted-foreground">{`latest: ${entry.latest.text}`}</p>
              {entry.orchestratorName && (
                <p className="mt-1 truncate text-muted-foreground">
                  {`launched from ${entry.orchestratorTitle ?? entry.orchestratorName}`}
                </p>
              )}
            </div>
          </div>
        </button>
        <button
          type="button"
          data-testid="gauntlet-run-expand"
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide lanes' : 'Show lanes'}
          className="m-1.5 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      </div>
      {expanded && (
        <div className="space-y-0.5 border-t border-border px-2.5 py-2">
          {entry.lanes.map((lane) => (
            <LaneRow key={lane.name} lane={lane} detail={detailByName.get(lane.name)} now={now} />
          ))}
          {details.isError && <p className="pt-1 text-[10px] text-muted-foreground">Lane details unavailable</p>}
          {archivedLanes.length > 0 && (
            <div className="pt-1">
              <p className="text-[10px] text-muted-foreground">archived</p>
              {archivedLanes.map((lane) => (
                <button
                  key={lane.name}
                  type="button"
                  data-testid={`gauntlet-run-archived-${lane.name}`}
                  className="block w-full truncate rounded px-1 py-0.5 text-left text-muted-foreground/70 hover:bg-accent/40"
                  onClick={() => pushRoute(`/conv/${encodeURIComponent(lane.name)}`)}
                >
                  {`${lane.key} · ${lane.role}`}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LaneRow({ lane, detail, now }: { lane: GauntletRunLane; detail: LaneDetail | undefined; now: Date }) {
  const judge = lane.role === 'critic' || lane.role === 'verifier';
  const label = `${lane.key}${lane.iteration != null ? ` i${lane.iteration}` : ''} · ${lane.activity}`
    + `${lane.report ? ` · ${lane.report.status}` : ''}${lane.report?.verdict ? ` · ${lane.report.verdict}` : ''}`;
  const git = detail?.git;
  return (
    <button
      type="button"
      data-testid={`gauntlet-run-lane-${lane.name}`}
      className={`flex w-full min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-accent/40 ${judge ? 'pl-3' : ''}`}
      onClick={() => pushRoute(`/conv/${encodeURIComponent(lane.name)}`)}
    >
      <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
      {git?.head && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {`${git.branch ?? 'detached'}@${git.head.slice(0, 8)}${git.ahead != null && git.ahead > 0 ? ` +${git.ahead}` : ''}${git.dirty ? ' dirty' : ''}`}
        </span>
      )}
      <time dateTime={lane.report?.at ?? lane.createdAt} className="shrink-0 text-[10px] text-muted-foreground">
        {formatRelativeTime(lane.report?.at ?? lane.createdAt, now)}
      </time>
    </button>
  );
}

/** Same client-side navigation as SessionFeedSidebar's pushRoute. */
function pushRoute(path: string) {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
