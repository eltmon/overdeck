import type { Agent } from '../types';

const SLOT_AGENT_PATTERN = /^(?:agent)-((?:[a-z]+-\d+|(?:f|us|de|ta|tc)\d+))-(\d+)$/i;

export function getSwarmSlotNumber(agentId: string): number | null {
  const match = agentId.match(SLOT_AGENT_PATTERN);
  if (!match) return null;
  const slot = Number.parseInt(match[2] ?? '', 10);
  return Number.isFinite(slot) ? slot : null;
}

export function compareWorkAgents(a: Agent, b: Agent): number {
  const aSlot = getSwarmSlotNumber(a.id);
  const bSlot = getSwarmSlotNumber(b.id);

  if (aSlot === null && bSlot !== null) return -1;
  if (aSlot !== null && bSlot === null) return 1;
  if (aSlot !== null && bSlot !== null && aSlot !== bSlot) return aSlot - bSlot;

  return a.id.localeCompare(b.id);
}

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
    agentsForIssue.sort(compareWorkAgents);
  }

  return issueWorkAgents;
}

export function getIssueWorkAgents(agents: readonly Agent[], issueId: string): Agent[] {
  return getIssueWorkAgentMap(agents).get(issueId.toLowerCase()) ?? [];
}

export function getWorkSessionLabel(agent: Agent, index = 0): string {
  const slot = getSwarmSlotNumber(agent.id);
  if (slot !== null) return `Slot ${slot}`;
  return index === 0 ? 'Work' : agent.id;
}

export function isAgentSessionActive(agent: Agent): boolean {
  return agent.status === 'healthy' || agent.status === 'running' || agent.status === 'starting';
}

export function isAgentSessionAttachable(agent: Agent): boolean {
  // PAN-1048: a stopped work agent whose tmux session is still alive is in
  // standby (post-pan-done, awaiting review/UAT response). Replaces the
  // legacy agentPhase === 'review-response' check.
  return (
    isAgentSessionActive(agent) ||
    (agent.status === 'stopped' &&
      (agent.role ?? 'work') === 'work' &&
      !!agent.lifecycle?.hasLiveTmuxSession)
  );
}
