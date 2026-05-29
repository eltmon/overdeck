/**
 * Generic work-agent utilities for the dashboard frontend.
 *
 * Historically lived in `swarmSlots.ts` alongside swarm-slot helpers; the
 * swarm runtime was removed in PAN-1517, and these generic helpers stayed.
 * Renamed for clarity.
 */

import type { Agent } from '../types';

/**
 * Group every non-planning agent by its `issueId` (lowercased). Returns a
 * map where each value is the agents tied to one issue, sorted by id.
 */
export function getIssueWorkAgentMap(agents: readonly Agent[]): Map<string, Agent[]> {
  const issueWorkAgents = new Map<string, Agent[]>();

  for (const agent of agents) {
    const issueId = agent.issueId?.toLowerCase();
    if (!issueId || agent.id.startsWith('planning-')) continue;

    const agentsForIssue = issueWorkAgents.get(issueId);
    if (agentsForIssue) {
      agentsForIssue.push(agent);
    } else {
      issueWorkAgents.set(issueId, [agent]);
    }
  }

  for (const agentsForIssue of issueWorkAgents.values()) {
    agentsForIssue.sort((a, b) => a.id.localeCompare(b.id));
  }

  return issueWorkAgents;
}

/** Convenience: agents for a single issue. */
export function getIssueWorkAgents(agents: readonly Agent[], issueId: string): Agent[] {
  return getIssueWorkAgentMap(agents).get(issueId.toLowerCase()) ?? [];
}

/** A live work agent: healthy, running, or warming up. */
export function isAgentSessionActive(agent: Agent): boolean {
  return agent.status === 'healthy' || agent.status === 'running' || agent.status === 'starting';
}

/**
 * Whether a tmux session is worth attaching to. PAN-1048: a stopped work
 * agent whose tmux session is still alive is in standby (post-pan-done,
 * awaiting review/UAT response).
 */
export function isAgentSessionAttachable(agent: Agent): boolean {
  return (
    isAgentSessionActive(agent) ||
    (agent.status === 'stopped' &&
      (agent.role ?? 'work') === 'work' &&
      !!agent.lifecycle?.hasLiveTmuxSession)
  );
}
