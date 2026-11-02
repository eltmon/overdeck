/**
 * MobilePipeline — the phase-grouped active-issue list for the phone (PAN-4661).
 *
 * Reads the same store selectors and groups with the same helpers
 * (`groupPipelineIssues`, `firstAgentByIssueId`) as the desktop `PipelineView`
 * (D-4661-4), so there is one definition of "active issue", one phase order
 * and one sort. A row is marked `Needs you` per D-4661-6. Before a snapshot
 * has loaded it shows `Loading pipeline…`; with a snapshot and no active
 * issue, `No active issues.` (D-4661-8).
 */
import { useMemo } from 'react';

import { useConnectionState } from '../../lib/connectionState';
import {
  derivedForIssue,
  firstAgentByIssueId,
  groupPipelineIssues,
  hasActualPendingQuestion,
  issueNeedsYou,
  PIPELINE_BOARD_PHASES,
} from '../../lib/pipeline-state';
import { useDashboardStore, selectAgents, selectIssues } from '../../lib/store';
import type { Agent, DerivedIssueState, Issue } from '../../types';
import PhaseHeader, { PHASE_LABELS } from '../primitives/PhaseHeader';

export function issueNeedsOperator(derived?: DerivedIssueState | null, agent?: Agent | null): boolean {
  return issueNeedsYou(derived) || hasActualPendingQuestion(agent);
}

export function NeedsYouMark() {
  return (
    <span className="shrink-0 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium badge-bg-warning badge-border-warning text-warning-foreground">
      Needs you
    </span>
  );
}

export function MobilePipeline({ onOpen }: { onOpen: (issueId: string) => void }) {
  const issues = useDashboardStore(selectIssues) as Issue[];
  const derivedByIssueId = useDashboardStore((s) => s.derivedIssueStateByIssueId);
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  const hasSnapshot = useConnectionState((s) => s.hasSnapshot);

  const groups = useMemo(() => groupPipelineIssues(issues, derivedByIssueId), [issues, derivedByIssueId]);
  const agentByIssueId = useMemo(() => firstAgentByIssueId(agents), [agents]);

  if (!hasSnapshot) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">Loading pipeline…</p>;
  }

  const nonEmptyPhases = PIPELINE_BOARD_PHASES.filter((phase) => groups[phase].length > 0);
  if (nonEmptyPhases.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">No active issues.</p>;
  }

  return (
    <section aria-label="Pipeline">
      {nonEmptyPhases.map((phase) => (
        <section key={phase} data-phase={phase}>
          <PhaseHeader phase={phase} count={groups[phase].length} />
          <ul aria-label={`${PHASE_LABELS[phase]} issues`} className="divide-y divide-border">
            {groups[phase].map((issue) => {
              const derived = derivedForIssue(derivedByIssueId, issue);
              const agent = agentByIssueId.get(issue.identifier.toLowerCase());
              const needsYou = issueNeedsOperator(derived, agent);
              return (
                <li key={issue.identifier} data-issue-id={issue.identifier}>
                  <button
                    type="button"
                    onClick={() => onOpen(issue.identifier)}
                    className="flex min-h-11 w-full items-start justify-between gap-3 px-4 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-xs text-muted-foreground">{issue.identifier}</span>
                      <span className="block line-clamp-2 break-words text-sm font-medium text-foreground">{issue.title}</span>
                    </span>
                    {needsYou && <NeedsYouMark />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
