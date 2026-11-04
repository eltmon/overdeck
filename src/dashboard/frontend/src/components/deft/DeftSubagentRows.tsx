/**
 * Deft's subagents in the cockpit agents lane (PAN-4849 WI-9, FR-16), from
 * their heartbeat files. A non-terminal heartbeat older than 10 minutes gets
 * a neutral `quiet` pill: Deft writes no liveness beyond the heartbeat.
 */
import type { DeftHeartbeat } from '@overdeck/contracts';
import { CockpitPill } from '../Stage/cockpit/CockpitCard';
import { useDeftIssueState } from './queries';

const QUIET_AFTER_MS = 10 * 60_000;

export function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.floor(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

function HeartbeatRow({ beat, now }: { beat: DeftHeartbeat; now: number }) {
  const age = now - Date.parse(beat.lastHeartbeatAt);
  const quiet = beat.phase !== 'terminal' && age > QUIET_AFTER_MS;
  return (
    <li data-testid={`deft-subagent-${beat.agentId}`} className="flex flex-wrap items-center gap-1.5 px-1 py-1 text-[12px]">
      <span className="font-mono text-foreground">{beat.agentId}</span>
      <CockpitPill tone="muted">{beat.phase}</CockpitPill>
      {beat.terminalState ? <CockpitPill tone="muted">{beat.terminalState}</CockpitPill> : null}
      {quiet ? <CockpitPill tone="muted">quiet</CockpitPill> : null}
      {beat.prNumber !== undefined ? <span className="text-muted-foreground">PR #{beat.prNumber}</span> : null}
      <span className="text-muted-foreground">{formatAge(age)}</span>
      <span className="min-w-0 basis-full truncate text-muted-foreground" title={beat.lastMessage}>{beat.lastMessage}</span>
    </li>
  );
}

export function DeftSubagentRows({ issueId }: { issueId: string }) {
  const { data } = useDeftIssueState(issueId);
  const heartbeats = data?.heartbeats ?? [];
  if (heartbeats.length === 0) return null;
  const now = Date.now();
  return (
    <div data-section="Deft subagents" className="mt-2 border-t border-border pt-2">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Deft subagents</p>
      <ul>{heartbeats.map((beat) => <HeartbeatRow key={beat.agentId} beat={beat} now={now} />)}</ul>
    </div>
  );
}
