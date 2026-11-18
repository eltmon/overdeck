/**
 * Renders the agent-request dialog a Needs-you item opens (PAN-5541 WI-4,
 * D1, D8). Mounted once in main.tsx, next to `AnywhereDialogHost`.
 *
 * `usePendingAgentRequestDecisions` shares the `['agent-requests']`
 * react-query key with `useDecisions`, so opening this dialog adds no new
 * polling (NFR-2). The dialog closes itself once the first fetch has landed
 * (`isFetched`) and the open request id is no longer in the pending list —
 * answered here, answered elsewhere, declined, expired, or the dashboard
 * restarted — never before the first fetch, so a request already pending at
 * mount is not mistaken for "gone" (D12). Link a machine… closes this dialog
 * before opening the Link a machine dialog, so the two never stack (D-11).
 */
import { useEffect } from 'react';
import { toast } from 'sonner';

import { useAgentRequestDialogStore } from '../lib/agentRequestDialogStore';
import { usePendingAgentRequestDecisions } from '../lib/useDecisions';
import { AgentRequestAnswer } from './AgentRequestCard';
import { Modal } from './shared/Modal';

export function AgentRequestDialogHost() {
  const requestId = useAgentRequestDialogStore((s) => s.requestId);
  const close = useAgentRequestDialogStore((s) => s.close);
  const { decisions, isFetched } = usePendingAgentRequestDecisions();
  const decision = decisions.find((d) => d.id === requestId);

  useEffect(() => {
    if (requestId && isFetched && !decision) close();
  }, [requestId, isFetched, decision, close]);

  if (!requestId || !decision?.agentRequest) return null;
  const { agentRequest } = decision;

  return (
    <Modal
      title={agentRequest.kind === 'secret' ? 'Secret requested' : 'Machine link requested'}
      description={decision.label}
      onClose={close}
    >
      <AgentRequestAnswer
        decision={decision}
        onAnswered={(outcome) => {
          if (outcome === 'sent') toast.success(`Sent ${agentRequest.kind === 'secret' ? agentRequest.name : ''} to ${decision.label}`);
          else toast(`Declined ${decision.label}'s request`);
          close();
        }}
        onLinkOpened={close}
      />
    </Modal>
  );
}
