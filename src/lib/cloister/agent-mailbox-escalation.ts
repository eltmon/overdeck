import { listAgentStates } from '../agents/queries.js';
import { getReviewStatusSync } from '../review-status.js';
import { listMailboxItems, type MailboxItem } from './agent-mailbox.js';
import { resolveIssueFeedbackTarget, surfaceIssueFeedbackNeedsYou } from './feedback-target.js';

interface MailboxWorkspace {
  issueId: string;
  workspacePath: string;
}

type MailboxAgentState = ReturnType<typeof listAgentStates>[number];

export function listMailboxEscalationWorkspaces(states: MailboxAgentState[]): MailboxWorkspace[] {
  return states
    .filter(state => state.role === 'work' && Boolean(state.issueId && state.workspace))
    .map(state => ({ issueId: state.issueId, workspacePath: state.workspace }));
}

export interface MailboxEscalationDeps {
  listWorkspaces: () => MailboxWorkspace[];
  listItems: (issueId: string, workspacePath: string) => Promise<MailboxItem[]>;
  resolveTarget: typeof resolveIssueFeedbackTarget;
  alreadyEscalated: (issueId: string) => boolean;
  escalate: typeof surfaceIssueFeedbackNeedsYou;
}

const defaultDeps: MailboxEscalationDeps = {
  listWorkspaces: () => listMailboxEscalationWorkspaces(listAgentStates()),
  listItems: (issueId, workspacePath) => listMailboxItems({ issueId, role: 'work', workspacePath }),
  resolveTarget: resolveIssueFeedbackTarget,
  alreadyEscalated: issueId => getReviewStatusSync(issueId)?.stuckReason === 'feedback_delivery_needs_you',
  escalate: surfaceIssueFeedbackNeedsYou,
};

const MAILBOX_SCAN_CONCURRENCY = 4;

export async function patrolPendingMailboxEscalations(options: {
  policyWindowMs: number;
  now?: number;
  deps?: MailboxEscalationDeps;
}): Promise<string[]> {
  const deps = options.deps ?? defaultDeps;
  const now = options.now ?? Date.now();
  const actions: string[] = [];
  const seen = new Set<string>();

  const workspaces = deps.listWorkspaces().filter(workspace => {
    const issueId = workspace.issueId.toUpperCase();
    if (seen.has(issueId) || deps.alreadyEscalated(issueId)) return false;
    seen.add(issueId);
    return true;
  });
  let nextIndex = 0;

  async function scanNext(): Promise<void> {
    while (nextIndex < workspaces.length) {
      const workspace = workspaces[nextIndex++];
      const issueId = workspace.issueId.toUpperCase();
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
  }

  await Promise.all(Array.from(
    { length: Math.min(MAILBOX_SCAN_CONCURRENCY, workspaces.length) },
    () => scanNext(),
  ));
  return actions;
}
