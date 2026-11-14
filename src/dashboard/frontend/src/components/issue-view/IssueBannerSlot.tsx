import { useMemo } from 'react';
import type { Agent } from '../../types';
import { useBackendPanes } from '../../lib/store';
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
  const panes = useBackendPanes(issueId);
  // A needs-you item's sessionId can be an agent id, or — on Herdr, where a
  // pane's own terminalId stands in for an agent not yet recorded — a
  // backend pane's terminalId or pane id. Resolve every key an item might
  // carry to the real agent id Open conversation/Unpause/Recover need.
  const agentIdByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) map.set(agent.id, agent.id);
    for (const pane of panes) {
      if (!pane.agentId) continue;
      map.set(pane.id, pane.agentId);
      if (pane.terminalId) map.set(pane.terminalId, pane.agentId);
    }
    return map;
  }, [agents, panes]);
  const resolveAction = useNeedsYouActions(agentIdByKey, onOpenAgentConversation);
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
