import { listAllAgentsSync, removeAgentSync } from '../overdeck/agents.js';
import { readIssueRecordForWorkspaceSync } from '../pan-dir/record.js';

export interface AgentGcResult { removed: string[]; preserved: string[] }
export interface AgentGcRow { id: string; issueId: string; status: string; workspace?: string | null }

export function pruneStoppedAgentsForIssue(
  issueId: string,
  agents: AgentGcRow[] = listAllAgentsSync(),
  remove: (id: string) => void = removeAgentSync,
): AgentGcResult {
  const issue = issueId.toUpperCase();
  const scoped = agents.filter(agent => agent.issueId.toUpperCase() === issue);
  const removed = scoped.filter(agent => agent.status === 'stopped').map(agent => agent.id);
  const preserved = scoped.filter(agent => agent.status !== 'stopped').map(agent => agent.id);
  for (const id of removed) remove(id);
  return { removed, preserved };
}

export function pruneTerminalStoppedAgents(): AgentGcResult {
  const agents = listAllAgentsSync();
  const terminal = agents.filter(agent => agent.status === 'stopped' && agent.workspace
    && readIssueRecordForWorkspaceSync(agent.workspace, agent.issueId)?.pipeline?.closedOut === true);
  const removed = terminal.map(agent => agent.id);
  for (const id of removed) removeAgentSync(id);
  return { removed, preserved: [] };
}
