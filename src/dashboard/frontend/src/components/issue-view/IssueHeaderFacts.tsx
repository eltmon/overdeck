/**
 * PAN-5244 · issue header facts: the derived state badge and the spend chip.
 *
 * Shell-independent, so the drawer header (and any other issue header) shows
 * the same state badge the project tree row shows and the same spend total
 * the cockpit header shows.
 */
import type { SessionNode } from '@overdeck/contracts';

import { cn } from '../../lib/utils';
import { useDerivedIssueState } from '../../lib/store';
import { isEndedAgent, type SessionAgent } from '../../lib/agentConversation';
import { resolveFeatureStateBadge, type FeatureStateTone } from '../CommandDeck/ProjectTree/featureStateBadge';
import { useIssueCostsQuery } from '../CommandDeck/ZoneCOverviewTabs/queries';

const TONE_CLASS: Record<FeatureStateTone, string> = {
  rest: 'badge-bg-muted badge-border-muted text-muted-foreground',
  machine: 'badge-bg-info badge-border-info text-info-foreground',
  specialist: 'badge-bg-signal-review badge-border-signal-review text-signal-review-foreground',
  human: 'badge-bg-warning badge-border-warning text-warning-foreground',
  outcome: 'badge-bg-success badge-border-success text-success-foreground',
};

/** The issue's derived state as a badge: the same resolver the project tree row uses. */
export function IssueStateBadge({ issueId, agents, trackerStatus }: { issueId: string; agents: readonly SessionAgent[]; trackerStatus?: string | null }) {
  const derived = useDerivedIssueState(issueId);
  const badge = resolveFeatureStateBadge({
    storeState: derived?.state,
    // The drawer has agents, not session-tree nodes; a live plan agent is a live planning session.
    sessions: agents
      .filter((agent) => agent.role === 'plan')
      .map((agent) => ({ type: 'planning', presence: isEndedAgent(agent) ? 'ended' : 'active' }) as SessionNode),
    rawTrackerState: trackerStatus ?? undefined,
    workStart: derived?.workStart,
    prOutsidePipeline: derived?.prOutsidePipeline,
  });
  if (!badge) return null;
  return (
    <span
      data-testid="drawer-state-badge"
      data-state={badge.key}
      title={badge.title}
      className={cn('inline-flex h-[20px] shrink-0 items-center whitespace-nowrap rounded-[4px] border px-[7px] text-[11.5px] font-medium', TONE_CLASS[badge.tone])}
    >
      {badge.label}
    </span>
  );
}

/** Spend on the issue so far. Renders nothing until a cost above zero is known. */
export function IssueCostChip({ issueId }: { issueId: string }) {
  const { data } = useIssueCostsQuery(issueId);
  const total = data?.resolvedTotalCost ?? data?.totalCost ?? 0;
  if (!(total > 0)) return null;
  return (
    <span
      data-testid="drawer-cost"
      title="Spend on this issue so far"
      className="shrink-0 font-mono-ui text-[12px] tabular-nums text-signal-cost-foreground"
    >
      {`$${total.toFixed(2)}`}
    </span>
  );
}
