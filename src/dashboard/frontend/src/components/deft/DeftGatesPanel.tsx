/**
 * Deft's own gate runs on the cockpit Overview tab (PAN-4849 WI-13, BD-2),
 * from the `check_invocation` events in Deft's run summary. Only a failed
 * gate carries a color; `run` and `skipped` stay neutral.
 */
import type { DeftGateRun } from '@overdeck/contracts';
import { CockpitCard, CockpitPill } from '../Stage/cockpit/CockpitCard';
import { formatDeftTime } from './DeftDecisionsTab';
import { useDeftIssueState } from './queries';

const SHOWN_RUNS = 10;

function GateRunRow({ run }: { run: DeftGateRun }) {
  return (
    <li className="border-b border-border py-2 last:border-b-0">
      <p className="text-[12px] text-foreground">
        <span className="font-medium">{run.target}</span>
        <span className="ml-2 font-mono text-muted-foreground">exit {run.exitCode}</span>
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">{formatDeftTime(run.ts)}</span>
      </p>
      <ul className="mt-1 space-y-0.5">
        {run.gates.map((gate) => (
          <li key={gate.id} data-testid={`deft-gate-${gate.id}`} className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="font-mono text-foreground">{gate.id}</span>
            <CockpitPill tone={gate.status === 'failed' ? 'destructive' : 'muted'}>{gate.status}</CockpitPill>
            {gate.exitCode !== undefined ? <span className="font-mono text-muted-foreground">exit {gate.exitCode}</span> : null}
            {gate.cause ? <span className="text-muted-foreground">{gate.cause}</span> : null}
          </li>
        ))}
      </ul>
    </li>
  );
}

export function DeftGatesPanel({ issueId }: { issueId: string }) {
  const { data: state } = useDeftIssueState(issueId);
  if (!state) return null;
  const runs = state.gateRuns.slice(-SHOWN_RUNS).reverse();
  return (
    <CockpitCard tone="muted" title="Deft gates">
      {runs.length === 0
        ? <p className="text-[12px] text-muted-foreground">No Deft gate runs recorded yet.</p>
        : <ul data-section="Deft gates">{runs.map((run, index) => <GateRunRow key={`${run.ts}-${index}`} run={run} />)}</ul>}
    </CockpitCard>
  );
}
