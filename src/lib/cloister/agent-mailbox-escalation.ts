import { listAgentStates } from '../agents/queries.js';
import { getReviewStatusSync } from '../review-status.js';
import { listMailboxItems, type MailboxItem } from './agent-mailbox.js';
import { resolveIssueFeedbackTarget, surfaceIssueFeedbackNeedsYou } from './feedback-target.js';

interface MailboxWorkspace {
  issueId: string;
  workspacePath: string;
}

export interface MailboxEscalationDeps {
  listWorkspaces: () => MailboxWorkspace[];
  listItems: (issueId: string, workspacePath: string) => Promise<MailboxItem[]>;
  resolveTarget: typeof resolveIssueFeedbackTarget;
  alreadyEscalated: (issueId: string) => boolean;
  escalate: typeof surfaceIssueFeedbackNeedsYou;
}

const defaultDeps: MailboxEscalationDeps = {
  listWorkspaces: () => listAgentStates()
    .filter(state => state.role === 'work'
      && Boolean(state.issueId && state.workspace)
      && ['starting', 'running', 'stopped'].includes(state.status))
    .map(state => ({ issueId: state.issueId, workspacePath: state.workspace })),
  listItems: (issueId, workspacePath) => listMailboxItems({ issueId, role: 'work', workspacePath }),
  resolveTarget: resolveIssueFeedbackTarget,
  alreadyEscalated: issueId => getReviewStatusSync(issueId)?.stuckReason === 'feedback_delivery_needs_you',
  escalate: surfaceIssueFeedbackNeedsYou,
};

export async function patrolPendingMailboxEscalations(options: {
  policyWindowMs: number;
  now?: number;
  deps?: MailboxEscalationDeps;
}): Promise<string[]> {
  const deps = options.deps ?? defaultDeps;
  const now = options.now ?? Date.now();
  const actions: string[] = [];
  const seen = new Set<string>();

  for (const workspace of deps.listWorkspaces()) {
    const issueId = workspace.issueId.toUpperCase();
    if (seen.has(issueId) || deps.alreadyEscalated(issueId)) continue;
    seen.add(issueId);
    const overdue = (await deps.listItems(issueId, workspace.workspacePath)).find(item =>
      item.state === 'pending' && item.actionRequired && now - Date.parse(item.createdAt) >= options.policyWindowMs);
    if (!overdue) continue;

    const target = await deps.resolveTarget(issueId);
    if ('agentId' in target) continue; // Resurrection/resume drains the mailbox.
    await deps.escalate(issueId, target.reason, {
      role: overdue.role,
      source: overdue.source,
      summary: overdue.summary,
      feedbackPath: overdue.filePath,
    });
    actions.push(`Escalated overdue mailbox feedback for ${issueId}`);
  }
  return actions;
}
