import { useMemo } from 'react';
import type { Agent } from '../../types';
import { PausedBanner } from '../issue-detail/IssueDetailSections';
import { useIssueActions } from '../IssueActionMenu/useIssueActions';
import { sortOperatorNeeds } from './derivations';
import { NeedsYouSlot } from './NeedsYouSlot';
import { useIssueView } from './useIssueView';
import { useNeedsYouActions } from './useNeedsYouActions';

/**
 * The one banner slot under the pipeline strip (PAN-5253). First match wins:
 * a needs-you item that outranks a pause, the paused banner, any other
 * needs-you item, nothing.
 */
export function IssueBannerSlot({ issueId, agents, onOpenAgentConversation }: {
  issueId: string;
  agents: Agent[];
  onOpenAgentConversation: (agentId: string) => void;
}) {
  const model = useIssueView(issueId);
  const actions = useIssueActions(issueId);
  const agentIds = useMemo(() => new Set(agents.map((agent) => agent.id)), [agents]);
  const resolveAction = useNeedsYouActions(agentIds, onOpenAgentConversation);
  const top = sortOperatorNeeds(model.operator.needsYouItems)[0];
  const anyPaused = agents.some((agent) => agent.paused === true);
  const needsYou = !!top && (top.kind === 'awaiting_input' || top.kind === 'stuck' || !anyPaused);
  return (
    <div data-section="DrawerPausedBanner" data-testid="issue-banner-slot" data-banner={needsYou ? 'needs-you' : anyPaused ? 'paused' : 'none'} className="shrink-0">
      {needsYou ? (
        <div className="pb-[10px] pl-[20px] pr-[16px]">
          <NeedsYouSlot model={model} actions={actions.all} resolveAction={resolveAction} />
        </div>
      ) : (
        <PausedBanner agents={agents} />
      )}
    </div>
  );
}
