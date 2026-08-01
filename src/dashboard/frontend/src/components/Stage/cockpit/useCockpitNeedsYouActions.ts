import type { SessionNode } from '@overdeck/contracts';
import { useSimpleActions } from '../../../lib/simple/useSimpleActions';
import type { NeedsYouResolvedAction } from '../../issue-view/NeedsYouSlot';
import type { OperatorNeedsYou } from '../../issue-view/types';

export function useCockpitNeedsYouActions(
  issueId: string,
  treeSessions: readonly SessionNode[],
  onSelectSession: (session: SessionNode) => void,
) {
  const actions = useSimpleActions();

  return (item: OperatorNeedsYou): NeedsYouResolvedAction | undefined => {
    if (item.kind === 'stuck') {
      return {
        label: 'Clear stuck gate',
        description: 'Clear the review-convergence gate so pipeline recovery can continue.',
        enabled: true,
        isPending: actions.unstick.isPending,
        invoke: () => actions.unstick.mutate({ issueId }),
      };
    }

    const sessionId = item.sessionId;
    if (!sessionId) return undefined;

    if (item.kind === 'awaiting_input') {
      const session = treeSessions.find((candidate) => candidate.sessionId === sessionId);
      return {
        label: 'Open conversation',
        description: 'Open the exact agent session that is waiting for input.',
        enabled: !!session,
        disabledReason: session ? undefined : 'The waiting session is still loading.',
        isPending: false,
        invoke: () => { if (session) onSelectSession(session); },
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
    if (item.kind === 'troubled') {
      return {
        label: 'Clear troubled gate',
        description: 'Clear this agent’s troubled gate after fixing the underlying failure.',
        enabled: true,
        isPending: actions.untroubled.isPending,
        invoke: () => actions.untroubled.mutate({ agentId: sessionId }),
      };
    }
    if (item.kind === 'stopped') {
      return {
        label: 'Recover agent',
        description: 'Recover this stopped agent session.',
        enabled: true,
        isPending: actions.recover.isPending,
        invoke: () => actions.recover.mutate({ agentId: sessionId }),
      };
    }
    return undefined;
  };
}
