/**
 * The Flywheel lane board (PAN-5283 FR-7, D15). Seven lanes stack vertically
 * in pipeline order — Plan, Build, Checks, Review, Merge, Deploy, Done today —
 * so the board never scrolls sideways in the 360 px rail. In-flight cards come
 * from `status.inFlight`; Deploy and Done-today cards come from the merges the
 * status route found on the default branch today (D12). Every word on a card
 * is derived by the server: the blocker sentence, the activity label, the
 * owner. A raw journal event name is never rendered.
 */
import type {
  FlywheelBlocker,
  FlywheelCardAgent,
  FlywheelDerivedStatus,
  FlywheelInFlightRow,
  FlywheelShippedMerge,
  FlywheelStage,
  IssueState,
} from '@overdeck/contracts';

import { formatAge, formatDuration } from '../../lib/flywheelApi';
import { StatusBadge } from './primitives';

export type BoardLane = FlywheelStage | 'deploy' | 'done';

export const BOARD_LANES: readonly { lane: BoardLane; label: string }[] = [
  { lane: 'plan', label: 'Plan' },
  { lane: 'build', label: 'Build' },
  { lane: 'checks', label: 'Checks' },
  { lane: 'review', label: 'Review' },
  { lane: 'merge', label: 'Merge' },
  { lane: 'deploy', label: 'Deploy' },
  { lane: 'done', label: 'Done today' },
];

/** A server that predates the board sends no `stage`; place the row by its state. */
function fallbackStage(state: IssueState): FlywheelStage {
  if (state === 'ready') return 'merge';
  if (state === 'in-review') return 'review';
  if (state === 'working' || state === 'changes-requested') return 'build';
  return 'plan';
}

export function rowStage(row: FlywheelInFlightRow): FlywheelStage {
  return row.stage ?? fallbackStage(row.state);
}

const BLOCKER_TONE: Record<FlywheelBlocker['severity'], string> = {
  waiting: 'text-muted-foreground',
  stuck: 'text-destructive',
  'needs-you': 'text-warning-foreground',
};

/** Running is not green: a working agent is info, a blocked one is on the operator. */
const AGENT_STATE_TONE: Partial<Record<FlywheelCardAgent['state'], string>> = {
  working: 'text-info-foreground',
  blocked: 'text-warning-foreground',
};

function ownerLabel(row: FlywheelInFlightRow): { text: string; title?: string } | null {
  const owner = row.owner ?? (row.inTick ? { kind: 'flywheel' as const } : null);
  if (!owner) return null;
  if (owner.kind === 'flywheel') return { text: 'Flywheel', title: 'The loop is driving this issue' };
  if (owner.kind === 'conversation') return { text: `conv ${owner.name}`, ...(owner.title ? { title: owner.title } : {}) };
  return { text: 'operator', title: 'Started outside the loop' };
}

function AgentLine({ row }: { row: FlywheelInFlightRow }) {
  const agent = row.agent;
  if (agent) {
    return (
      <span className="block truncate text-muted-foreground" data-testid={`flywheel-agentline-${row.issueId}`}>
        {agent.role}
        {agent.conversationName && <> <span className="font-mono">{agent.conversationName}</span></>}
        {agent.model && <> · <span className="font-mono">{agent.model}</span></>}
        {' · '}
        <span className={AGENT_STATE_TONE[agent.state] ?? ''}>{agent.state}</span>
      </span>
    );
  }
  // A server without board fields still reports the live pane count.
  if (row.agent === undefined && row.liveAgents > 0) {
    return <span className="block text-muted-foreground" data-testid={`flywheel-agentline-${row.issueId}`}>{row.liveAgents} live agent{row.liveAgents === 1 ? '' : 's'}</span>;
  }
  return <span className="block text-muted-foreground" data-testid={`flywheel-agentline-${row.issueId}`}>no agent</span>;
}

export function FlywheelIssueCard({ row, nowMs, onNavigateIssue }: {
  row: FlywheelInFlightRow;
  nowMs: number;
  onNavigateIssue?: (issueId: string) => void;
}) {
  const stage = rowStage(row);
  const owner = ownerLabel(row);
  const since = row.stageSince ? Date.parse(row.stageSince) : NaN;
  const inStage = Number.isFinite(since) ? formatDuration(nowMs - since) : '';
  return (
    <button
      type="button"
      onClick={() => onNavigateIssue?.(row.issueId)}
      data-testid={`flywheel-card-${row.issueId}`}
      data-attention={row.attention}
      data-stage={stage}
      className="block w-full min-w-0 cursor-pointer rounded-md border border-border bg-card px-2.5 py-2 text-left text-xs shadow-card transition-colors hover:border-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="font-mono text-foreground">{row.issueId}</span>
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          {inStage && <span data-testid={`flywheel-since-${row.issueId}`}>{inStage} in stage</span>}
          {typeof row.cost === 'number' && <span data-testid={`flywheel-cost-${row.issueId}`}>· ${row.cost.toFixed(2)}</span>}
          {row.pr && <span className="font-mono">· PR #{row.pr.number}</span>}
          {owner && (
            <span title={owner.title} data-testid={`flywheel-owner-${row.issueId}`} className="border border-border px-1 text-[10px]">
              {owner.text}
            </span>
          )}
        </span>
      </span>
      {row.title && (
        <span
          className="my-0.5 line-clamp-2 block text-[13px] font-medium text-foreground"
          title={row.title}
          data-testid={`flywheel-title-${row.issueId}`}
        >
          {row.title}
        </span>
      )}
      {(row.trackerUnknown || row.strike) && (
        <span className="mb-0.5 flex flex-wrap gap-1">
          {row.trackerUnknown && <StatusBadge tone="neutral" testId={`flywheel-tracker-unknown-${row.issueId}`}>tracker unknown</StatusBadge>}
          {row.strike && <StatusBadge tone="neutral" testId={`flywheel-strike-${row.issueId}`}>strike</StatusBadge>}
        </span>
      )}
      <AgentLine row={row} />
      {row.blocker && (
        <span
          className={`mt-0.5 block ${BLOCKER_TONE[row.blocker.severity]}`}
          data-testid={`flywheel-blocker-${row.issueId}`}
          data-severity={row.blocker.severity}
        >
          {row.blocker.text}
        </span>
      )}
      {row.lastActivity && (
        <span className="mt-0.5 block text-muted-foreground" title={row.lastActivity.at}>
          last: {row.lastActivity.label} · {formatAge(row.lastActivity.at, nowMs)}
        </span>
      )}
    </button>
  );
}

const SHIPPED_CARD_CLASS = 'block w-full min-w-0 rounded-md border border-border bg-card px-2.5 py-2 text-left text-xs';

function ShippedCard({ merge }: { merge: FlywheelShippedMerge }) {
  const body = (
    <>
      <span className="flex flex-wrap items-baseline justify-between gap-x-2 text-[11px] text-muted-foreground">
        <span className="font-mono text-foreground">{merge.issueId ?? `PR #${merge.prNumber}`}</span>
        <span className="font-mono">#{merge.prNumber}</span>
      </span>
      <span className="my-0.5 line-clamp-2 block text-[13px] font-medium text-foreground" title={merge.title ?? merge.subject}>
        {merge.title ?? merge.subject}
      </span>
    </>
  );
  const testId = `flywheel-shipped-card-${merge.sha.slice(0, 8)}`;
  return merge.prUrl ? (
    <a href={merge.prUrl} target="_blank" rel="noreferrer noopener" data-testid={testId} className={`${SHIPPED_CARD_CLASS} hover:border-muted-foreground/60`}>
      {body}
    </a>
  ) : (
    <div data-testid={testId} className={SHIPPED_CARD_CLASS}>{body}</div>
  );
}

export function FlywheelLaneBoard({ status, nowMs, onNavigateIssue }: {
  status: Pick<FlywheelDerivedStatus, 'inFlight' | 'shipped'>;
  nowMs: number;
  onNavigateIssue?: (issueId: string) => void;
}) {
  const rowsByLane = new Map<BoardLane, FlywheelInFlightRow[]>();
  for (const row of status.inFlight) {
    const lane = rowStage(row);
    rowsByLane.set(lane, [...(rowsByLane.get(lane) ?? []), row]);
  }
  const merges = status.shipped?.merges ?? [];
  const shippedByLane: Record<'deploy' | 'done', FlywheelShippedMerge[]> = {
    deploy: merges.filter((merge) => merge.deployed === false),
    done: merges.filter((merge) => merge.deployed !== false),
  };

  return (
    <div className="space-y-3" data-testid="flywheel-lane-board">
      {BOARD_LANES.map(({ lane, label }) => {
        const rows = lane === 'deploy' || lane === 'done' ? [] : rowsByLane.get(lane) ?? [];
        const shipped = lane === 'deploy' || lane === 'done' ? shippedByLane[lane] : [];
        const count = rows.length + shipped.length;
        return (
          <section key={lane} aria-label={`${label} lane`} data-testid={`flywheel-lane-${lane}`}>
            <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {label} · {count}
            </h3>
            {count === 0 ? (
              <p className="text-xs text-muted-foreground">—</p>
            ) : (
              <ul className="space-y-1.5">
                {rows.map((row) => (
                  <li key={row.issueId}><FlywheelIssueCard row={row} nowMs={nowMs} onNavigateIssue={onNavigateIssue} /></li>
                ))}
                {shipped.map((merge) => <li key={merge.sha}><ShippedCard merge={merge} /></li>)}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
