import { listRunningAgentsSync } from './agents.js';

export function findConflictingWorkAgents(
  issueId: string,
  primaryAgentId: string,
  agents = listRunningAgentsSync(),
) {
  return agents.filter((agent) =>
    agent.tmuxActive
    && agent.role === 'work'
    && agent.issueId.toUpperCase() === issueId.toUpperCase()
    && agent.id !== primaryAgentId
  );
}

export function describeConflictingWorkAgents(issueId: string, primaryAgentId: string): string | null {
  const conflicts = findConflictingWorkAgents(issueId, primaryAgentId);
  if (conflicts.length === 0) return null;
  const sessions = conflicts.map((agent) => `  ${agent.id} (${agent.workspace})`).join('\n');
  return `Cannot start ${issueId}: other work sessions are still live.\n${sessions}\nRun 'pan stop ${issueId}' to stop every issue session, then retry.\n`;
}
