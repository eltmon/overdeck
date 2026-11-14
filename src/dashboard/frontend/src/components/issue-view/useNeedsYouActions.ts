import { useSimpleActions } from '../../lib/simple/useSimpleActions';
import type { NeedsYouResolvedAction } from './NeedsYouSlot';
import type { OperatorNeedsYou } from './types';

/**
 * PAN-5253: a shell-independent copy of
 * Stage/cockpit/useCockpitNeedsYouActions.ts. The cockpit hook resolves
 * "open the conversation" against its session tree; this one resolves it
 * against a map of every id a needs-you item's `sessionId` can carry (an
 * agent id, or — on Herdr — a backend pane's `terminalId`/`id`) to the real
 * agent id, so it works outside the cockpit and on every terminal backend.
 */
export function useNeedsYouActions(
  agentIdByKey: ReadonlyMap<string, string>,
  onOpenAgentConversation: (agentId: string) => void,
) {
  const actions = useSimpleActions();

  return (item: OperatorNeedsYou): NeedsYouResolvedAction | undefined => {
    const sessionId = item.sessionId;
    if (!sessionId) return undefined;
    const resolvedAgentId = agentIdByKey.get(sessionId);

    if (item.kind === 'awaiting_input') {
      const known = resolvedAgentId !== undefined;
      return {
        label: 'Open conversation',
        description: 'Open the exact agent session that is waiting for input.',
        enabled: known,
        disabledReason: known ? undefined : 'The waiting session is still loading.',
        isPending: false,
        invoke: () => { if (known) onOpenAgentConversation(resolvedAgentId!); },
      };
    }
    if (item.kind === 'paused') {
      const agentId = resolvedAgentId ?? sessionId;
      return {
        label: 'Unpause agent',
        description: 'Let this paused agent continue.',
        enabled: true,
        isPending: actions.unpause.isPending,
        invoke: () => actions.unpause.mutate({ agentId }),
      };
    }
    if (item.kind === 'stopped' || item.kind === 'stuck') {
      const agentId = resolvedAgentId ?? sessionId;
      return {
        label: 'Recover agent',
        description: 'Recover this agent session.',
        enabled: true,
        isPending: actions.recover.isPending,
        invoke: () => actions.recover.mutate({ agentId }),
      };
    }
    return undefined;
  };
}
