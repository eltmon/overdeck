import { AlertCircle } from 'lucide-react';

import type { IssueActionView } from '../IssueActionMenu/useIssueActions';
import { sortOperatorNeeds } from './derivations';
import type { IssueViewModel, OperatorNeedsYou } from './types';

const COPY: Record<OperatorNeedsYou['kind'], { title: string; fallback: string }> = {
  awaiting_input: {
    title: 'The agent is waiting for your answer',
    fallback: 'Open the conversation and answer the pending question.',
  },
  stuck: {
    title: 'This issue is stuck',
    fallback: 'The pipeline cannot continue until the stuck state is cleared.',
  },
  troubled: {
    title: 'The agent stopped after repeated failures',
    fallback: 'Fix the underlying failure, then clear the troubled gate.',
  },
  paused: {
    title: 'The agent is paused',
    fallback: 'Unpause the agent when it is safe to continue.',
  },
  stale_review: {
    title: 'Review has leftover specialist sessions',
    fallback: 'Clear the stale review sessions before starting a clean review.',
  },
  blocker: {
    title: 'A merge blocker needs attention',
    fallback: 'Resolve the blocker before this issue can ship.',
  },
  pickup_gate: {
    title: 'The plan is waiting for release',
    fallback: 'Review the plan, then release it so work can be picked up.',
  },
  ready_for_merge: {
    title: 'This issue is ready to merge',
    fallback: 'Merge when you want the approved change on main.',
  },
  stopped: {
    title: 'The work agent is stopped',
    fallback: 'Recover the agent to continue this issue.',
  },
};

const ACTION_KEY: Partial<Record<OperatorNeedsYou['kind'], string>> = {
  awaiting_input: 'tell',
  stuck: 'recoverAgent',
  troubled: 'untroubled',
  paused: 'unpause',
  stale_review: 'purgeReview',
  blocker: 'recoverReview',
  stopped: 'recoverAgent',
  ready_for_merge: 'merge',
};

const SECTION_MARKER: Partial<Record<OperatorNeedsYou['kind'], string>> = {
  stale_review: 'Stale-review warning',
  blocker: 'IssueBlockerSpotlight',
  pickup_gate: 'PickupGateCard',
};

const AGENT_SCOPED_KINDS = new Set<OperatorNeedsYou['kind']>([
  'awaiting_input',
  'troubled',
  'paused',
  'stopped',
]);

export interface NeedsYouResolvedAction {
  label: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
  isPending: boolean;
  invoke: () => void;
}

export function NeedsYouSlot({ model, actions, resolveAgentAction }: {
  model: IssueViewModel;
  actions: readonly IssueActionView[];
  resolveAgentAction?: (item: OperatorNeedsYou) => NeedsYouResolvedAction | undefined;
}) {
  const items = sortOperatorNeeds(model.operator.needsYouItems);
  const active = items[0];
  if (!active) return null;

  const copy = COPY[active.kind];
  const usesExactAgent = !!active.sessionId && AGENT_SCOPED_KINDS.has(active.kind);
  const agentAction = usesExactAgent ? resolveAgentAction?.(active) : undefined;
  const actionKey = usesExactAgent ? undefined : ACTION_KEY[active.kind];
  const registryAction = actionKey ? actions.find((candidate) => candidate.action.key === actionKey) : undefined;
  const resolvedAction: NeedsYouResolvedAction | undefined = agentAction ?? (registryAction ? {
    label: registryAction.action.label,
    description: registryAction.action.description,
    enabled: registryAction.enabled,
    disabledReason: registryAction.disabledReason,
    isPending: registryAction.isPending,
    invoke: registryAction.invoke,
  } : undefined);
  const additionalCount = items.length - 1;

  return (
    <section
      data-testid="needs-you-slot"
      data-section="NeedsYouSlot"
      aria-live="polite"
      className="flex flex-wrap items-center gap-3 rounded-[var(--radius-sm)] border badge-border-warning badge-bg-warning px-3.5 py-2.5 text-[12.5px]"
    >
      <div data-section={SECTION_MARKER[active.kind]} className="contents">
        <AlertCircle size={15} className="shrink-0 text-warning-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <span className="font-medium text-foreground">{copy.title}</span>
          <span className="text-muted-foreground"> — {active.prompt ?? active.reason ?? copy.fallback}</span>
        </div>
        {additionalCount > 0 ? (
          <span className="shrink-0 rounded-[var(--radius-sm)] border badge-border-warning badge-bg-warning px-1.5 py-0.5 text-[10px] font-medium text-warning-foreground">
            +{additionalCount} more
          </span>
        ) : null}
        {resolvedAction ? (
          <button
            type="button"
            onClick={resolvedAction.invoke}
            disabled={!resolvedAction.enabled || resolvedAction.isPending}
            title={!resolvedAction.enabled ? resolvedAction.disabledReason : resolvedAction.description}
            className="shrink-0 rounded-[var(--radius-sm)] border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resolvedAction.label}
          </button>
        ) : null}
      </div>
    </section>
  );
}
