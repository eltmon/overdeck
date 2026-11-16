/**
 * showDeliveredToast — the success toast after the dashboard delivered an
 * answer, approval or plan action (PAN-5423). It carries an "Open" action
 * that sends the operator to the subject that received it, through the
 * decision door: a conversation opens /conv/<name>, an agent opens its
 * issue. An agent with no issue gets the plain toast.
 */
import { toast } from 'sonner';
import { decisionSubjectPath, navigateToDecisionSubject, type DecisionSubjectTarget } from './navigateToDecision';

export interface DeliveredSubject {
  kind: 'agent' | 'conv';
  id: string;
  issueId?: string | null;
}

export function showDeliveredToast(message: string, subject: DeliveredSubject): void {
  const target: DecisionSubjectTarget = subject.kind === 'conv'
    ? { id: subject.id, source: 'conversation' }
    : { id: subject.id, source: 'agent', issueId: subject.issueId ?? undefined };
  if (decisionSubjectPath(target) === null) {
    toast.success(message);
    return;
  }
  toast.success(message, { action: { label: 'Open', onClick: () => navigateToDecisionSubject(target) } });
}
