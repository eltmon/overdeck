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

export function getIssueWorkAgents(agents: readonly Agent[], issueId: string): Agent[] {
  const issueIdLower = issueId.toLowerCase();
  return agents
    .filter(
      (agent) =>
        agent.issueId?.toLowerCase() === issueIdLower &&
        !agent.id.startsWith('planning-'),
    )
    .sort(compareWorkAgents);
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
  return isAgentSessionActive(agent) || (agent.status === 'stopped' && agent.agentPhase === 'review-response');
}
