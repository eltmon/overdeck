import { useSimpleActions } from '../../lib/simple/useSimpleActions';
import type { NeedsYouResolvedAction } from './NeedsYouSlot';
import type { OperatorNeedsYou } from './types';

/**
 * PAN-5253: a shell-independent copy of
 * Stage/cockpit/useCockpitNeedsYouActions.ts. The cockpit hook resolves
 * "open the conversation" against its session tree; this one resolves it
 * against the shared agent id set, so it works outside the cockpit.
 */
export function useNeedsYouActions(
  agentIds: ReadonlySet<string>,
  onOpenAgentConversation: (agentId: string) => void,
) {
  const actions = useSimpleActions();

  return (item: OperatorNeedsYou): NeedsYouResolvedAction | undefined => {
    const sessionId = item.sessionId;
    if (!sessionId) return undefined;

    if (item.kind === 'awaiting_input') {
      const known = agentIds.has(sessionId);
      return {
        label: 'Open conversation',
        description: 'Open the exact agent session that is waiting for input.',
        enabled: known,
        disabledReason: known ? undefined : 'The waiting session is still loading.',
        isPending: false,
        invoke: () => { if (known) onOpenAgentConversation(sessionId); },
      };
    }
    if (item.kind === 'paused') {
      return {
        label: 'Unpause agent',
        description: 'Let this paused agent continue.',
        enabled: true,
        isPending: actions.unpause.isPending,
        invoke: () => actions.unpause.mutate({ agentId: sessionId }),
      };
    }
    if (item.kind === 'stopped' || item.kind === 'stuck') {
      return {
        label: 'Recover agent',
        description: 'Recover this agent session.',
        enabled: true,
        isPending: actions.recover.isPending,
        invoke: () => actions.recover.mutate({ agentId: sessionId }),
      };
    }
    return undefined;
  };
}
