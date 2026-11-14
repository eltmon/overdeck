/**
 * MobileIssueSheet — the read-only full-screen issue sheet (PAN-4661, PAN-5219).
 *
 * D-4661-9 Full screen: the shell hides its header and tab bar while this is
 *     open. D-4661-10 fields, in order: Back + identifier, title, then Phase,
 *     State, Needs you (only when `issueNeedsOperator`), Project, Pull
 *     request, Agent, Labels, Updated, and an Open-in-tracker link.
 * D-4661-11 It does not reuse `IssueActionMenu`, `AutoMergeToggle`,
 *     `IssuePeek`, the desktop `IssueRow` or the issue drawer — none of
 *     those are read-only.
 * D-10 (PAN-5219) It never early-returns for a missing issue record: Phase,
 *     State and (when the notification carried one) What happened still
 *     render from the derived state and the route alone.
 */
import type { PhoneIssueEvent } from '@overdeck/contracts';

import { formatRelativeTime } from '../../lib/formatRelativeTime';
import { derivedForIssue, firstAgentByIssueId, getPipelineIssuePhase } from '../../lib/pipeline-state';
import { useDashboardStore, selectAgents } from '../../lib/store';
import type { Agent } from '../../types';
import { IssueHeaderTitle } from '../issue-view/IssueHeaderTitle';
import { useIssueRecord } from '../issue-view/useIssueRecord';
import { PHASE_LABELS } from '../primitives/PhaseHeader';
import { eventLine } from './issueSheetData';
import { AgentRow, CostSection, PrChecksSection, SheetHeader, WhatHappened } from './IssueSheetSections';
import { issueNeedsOperator, NeedsYouMark } from './MobilePipeline';

export function MobileIssueSheet({
  issueId,
  event,
  onBack,
}: {
  issueId: string;
  event?: { kind: PhoneIssueEvent; at: string | null } | null;
  onBack: () => void;
}) {
  const derivedByIssueId = useDashboardStore((s) => s.derivedIssueStateByIssueId);
  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  const { issue, status } = useIssueRecord(issueId);

  const identifier = issue?.identifier ?? issueId;
  const derived = issue ? derivedForIssue(derivedByIssueId, issue) : derivedByIssueId[issueId] ?? derivedByIssueId[issueId.toUpperCase()];
  const agent = firstAgentByIssueId(agents).get(identifier.toLowerCase());
  const phase = getPipelineIssuePhase(derived, issue);
  const needsYou = issueNeedsOperator(derived, agent);

  return (
    <section aria-label="Issue" className="px-4 pb-[env(safe-area-inset-bottom)]">
      <SheetHeader issueId={identifier} onBack={onBack} />
      <h2 className="mt-3 break-words text-base font-medium">
        <IssueHeaderTitle issueId={issueId} title={issue?.title ?? null} status={status} />
      </h2>
      {event && <WhatHappened line={eventLine(event, derived?.pr?.number ?? null, new Date())} />}
      <dl className="mt-3 space-y-3">
        <div>
          <dt className="text-xs text-muted-foreground">Phase</dt>
          <dd className="break-words text-sm">{PHASE_LABELS[phase]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">State</dt>
          <dd className="break-words text-sm">{derived?.state ?? 'Not available'}</dd>
        </div>
        {needsYou && (
          <div>
            <dt className="text-xs text-muted-foreground">Needs you</dt>
            <dd className="break-words text-sm">
              <NeedsYouMark />
            </dd>
          </div>
        )}
        {issue?.project && (
          <div>
            <dt className="text-xs text-muted-foreground">Project</dt>
            <dd className="break-words text-sm">{issue.project.name}</dd>
          </div>
        )}
        <PrChecksSection issueId={identifier} derived={derived} />
        <AgentRow issueId={identifier} storeAgents={agents} />
        <CostSection issueId={identifier} />
        {issue && issue.labels.length > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground">Labels</dt>
            <dd className="break-words text-sm">{issue.labels.join(', ')}</dd>
          </div>
        )}
        {issue && (
          <div>
            <dt className="text-xs text-muted-foreground">Updated</dt>
            <dd className="break-words text-sm">{formatRelativeTime(issue.updatedAt, new Date())}</dd>
          </div>
        )}
      </dl>
      {issue?.url && (
        <a
          href={issue.url}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex min-h-11 min-w-11 items-center text-sm text-foreground underline"
        >
          Open in tracker
        </a>
      )}
    </section>
  );
}
