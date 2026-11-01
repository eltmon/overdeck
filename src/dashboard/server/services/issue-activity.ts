/**
 * Which machine is working on an issue (PAN-4651 FR-5, D-4651-16).
 *
 * `issueActivity(issueId)` answers this machine's part: the agents the read
 * model has for the issue (with their status) and the unarchived
 * conversations linked to it (with whether a turn is running). The owner
 * route `GET /api/machines/issue-activity?issue=` serves it to linked
 * machines; `GET /api/fleet/issues/:id/activity` combines this machine with
 * every online link for `pan machines who`.
 */
import { readAgentSnapshots } from './agent-snapshots-access.js';

export interface IssueActivity {
  agents: Array<{ id: string; status: string }>;
  conversations: Array<{ name: string; isWorking: boolean }>;
}

export interface IssueActivityDeps {
  agents: typeof readAgentSnapshots;
  conversations: () => Promise<readonly unknown[]>;
}

export const defaultIssueActivityDeps: IssueActivityDeps = {
  agents: readAgentSnapshots,
  conversations: async () => (await import('../../../lib/overdeck/conversation-list.js')).getEnrichedConversationList(500, 0),
};

export async function issueActivity(issueId: string, deps: IssueActivityDeps = defaultIssueActivityDeps): Promise<IssueActivity> {
  const wanted = issueId.toUpperCase();
  const [agents, conversations] = await Promise.all([deps.agents(), deps.conversations()]);
  return {
    agents: agents
      .filter((agent) => agent.issueId?.toUpperCase() === wanted)
      .map((agent) => ({ id: agent.id, status: agent.status ?? 'unknown' }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    conversations: (conversations as Array<{ name?: unknown; issueId?: unknown; isWorking?: unknown; archivedAt?: unknown }>)
      .filter((row) => typeof row.name === 'string' && typeof row.issueId === 'string' && row.issueId.toUpperCase() === wanted && !row.archivedAt)
      .map((row) => ({ name: row.name as string, isWorking: row.isWorking === true })),
  };
}
