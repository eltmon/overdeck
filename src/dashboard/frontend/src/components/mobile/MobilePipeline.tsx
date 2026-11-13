/**
 * MobilePipeline — the phase-grouped active-issue list for the phone (PAN-4661).
 *
 * Reads the same store selectors and groups with the same helpers
 * (`groupPipelineIssues`, `firstAgentByIssueId`) as the desktop `PipelineView`
 * (D-4661-4), so there is one definition of "active issue", one phase order
 * and one sort. A row is marked `Needs you` per D-4661-6. Before a snapshot
 * has loaded it shows `Loading pipeline…`; with a snapshot and no active
 * issue, `No active issues.` (D-4661-8). Rows show the project and age and
 * use the shared phone row classes (PAN-5208 D-16).
 */
import { useMemo } from 'react';

import { useConnectionState } from '../../lib/connectionState';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
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
import { MOBILE_ROW_AGE_CLASS, MOBILE_ROW_CLASS, MOBILE_ROW_META_CLASS, MobileEmptyState } from './brand';

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
    return <MobileEmptyState title="No active issues." detail="Issues being planned, worked or reviewed show up here." />;
  }

  const now = new Date();
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
                    className={MOBILE_ROW_CLASS}
                  >
                    <span className="min-w-0">
                      <span className={MOBILE_ROW_META_CLASS}>
                        <span className="font-mono">{issue.identifier}</span>
                        {issue.project ? ` · ${issue.project.name}` : ''}
                      </span>
                      <span className="block line-clamp-2 break-words text-[15px] font-medium text-foreground">{issue.title}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className={MOBILE_ROW_AGE_CLASS}>{formatRelativeTime(issue.updatedAt, now)}</span>
                      {needsYou && <NeedsYouMark />}
                    </span>
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
