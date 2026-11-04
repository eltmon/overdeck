/**
 * Deft's review cycle on the cockpit Overview tab (PAN-4849 WI-22, FR-18,
 * FR-19), in Deft's own words: the exit predicate, the verdict, rounds
 * (reconstructed, and labeled so), the review lease, and the pr:watch
 * heartbeats and CLEAN records.
 */
import type { DeftExitField, DeftReviewCycle, DeftReviewVerdict } from '@overdeck/contracts';
import { CockpitCard, CockpitPill, type CockpitTone } from '../Stage/cockpit/CockpitCard';
import { formatDeftTime } from './DeftDecisionsTab';
import { formatAge } from './DeftSubagentRows';
import { useDeftReviewCycle } from './queries';

const VERDICT_TONE: Record<Exclude<DeftReviewVerdict, 'NO_REVIEWER_INSTALLED'>, CockpitTone> = {
  CLEAN: 'success',
  NEW_P0_P1: 'destructive',
  PENDING: 'muted',
};

function ExitRow({ label, value }: { label: string; value: DeftExitField }) {
  return (
    <li className="flex items-center justify-between gap-2 text-[12px]">
      <span className="text-foreground">{label}</span>
      <span data-exit={value} className="font-mono text-[11px] text-muted-foreground">{value}</span>
    </li>
  );
}

function exitRows(cycle: DeftReviewCycle): Array<[string, DeftExitField]> {
  const { exit } = cycle;
  return [
    ['Greptile check run terminal (success or neutral)', exit.checkRun],
    ['HEAD SHA read', exit.headSha],
    ['Last reviewed commit matches HEAD', exit.lastReviewedCommit],
    [`Confidence ≥ ${exit.minConfidence}/5 (now ${exit.confidenceScore ?? '?'}/5)`, exit.confidence],
    [`No P0/P1 findings (${exit.p0p1Remaining ?? '?'} remaining)`, exit.noBlocking],
  ];
}

function Body({ cycle }: { cycle: DeftReviewCycle }) {
  if (cycle.verdict === 'NO_REVIEWER_INSTALLED') {
    return (
      <div className="space-y-1 text-[12px] text-muted-foreground">
        <p>No supported bot reviewer — Deft review cycle not running</p>
        {cycle.reviewer.unsupported.map((name) => (
          <p key={name}>{name} is present, but Deft&apos;s review cycle supports only Greptile.</p>
        ))}
      </div>
    );
  }
  const now = Date.now();
  const watchers = cycle.heartbeats.filter((beat) => beat.agentId.startsWith('pr-watch-'));
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CockpitPill tone={VERDICT_TONE[cycle.verdict]}>{cycle.verdict}</CockpitPill>
        {cycle.prNumber !== null ? <span className="text-[12px] text-muted-foreground">PR #{cycle.prNumber}</span> : null}
      </div>
      <section>
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Exit predicate</h4>
        <ul className="space-y-0.5">{exitRows(cycle).map(([label, value]) => <ExitRow key={label} label={label} value={value} />)}</ul>
      </section>
      {cycle.rounds.length > 0 ? (
        <section>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Rounds</h4>
          <ul className="space-y-1">
            {[...cycle.rounds].reverse().map((round) => (
              <li key={round.index} data-testid={`deft-round-${round.index}`} className="text-[12px] text-foreground">
                <span className="font-medium">Round {round.index}</span>
                <span className="ml-2 font-mono">P0 {round.findings.p0} · P1 {round.findings.p1} · P2 {round.findings.p2}</span>
                <span className="ml-2 text-muted-foreground">{round.commentCount} comments</span>
                <span className="ml-2 text-muted-foreground">
                  {round.fixCommit ? `fix ${round.fixCommit.sha.slice(0, 7)} ${round.fixCommit.subject}` : 'current'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Rounds are reconstructed from Greptile comments and fix-batch commits; Deft does not record rounds.
          </p>
        </section>
      ) : null}
      {cycle.lease ? (
        <section data-section="Deft review lease" className="text-[12px]">
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">Review lease</h4>
          <p className="text-foreground">
            owner {cycle.lease.owner} · monitor_agent_id {cycle.lease.monitorAgentId} · expires {formatDeftTime(cycle.lease.expiresAt)} ·{' '}
            {cycle.lease.active ? 'active' : cycle.lease.endedAt ? 'ended' : 'expired'}
          </p>
        </section>
      ) : null}
      {watchers.length > 0 || cycle.cleanRecords.length > 0 ? (
        <ul className="space-y-0.5 text-[12px] text-muted-foreground">
          {watchers.map((beat) => (
            <li key={beat.agentId}>{beat.agentId} · {beat.phase} · {formatAge(now - Date.parse(beat.lastHeartbeatAt))}</li>
          ))}
          {cycle.cleanRecords.map((record) => (
            <li key={`${record.prNumber}-${record.headSha}`}>CLEAN recorded at {formatDeftTime(record.cleanedAt)} for {record.headSha.slice(0, 7)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function DeftReviewCyclePanel({ issueId }: { issueId: string }) {
  const { data: cycle } = useDeftReviewCycle(issueId);
  if (!cycle) return null;
  return (
    <CockpitCard tone="muted" title="Deft review cycle">
      <div data-section="Deft review cycle">
        <Body cycle={cycle} />
        {cycle.errors.length > 0 ? (
          <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">{cycle.errors.map((error) => <li key={error}>{error}</li>)}</ul>
        ) : null}
      </div>
    </CockpitCard>
  );
}
