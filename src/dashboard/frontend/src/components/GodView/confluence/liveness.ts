import type { AgentSnapshot, BackendPane } from '@overdeck/contracts';

/** Row statuses that CLAIM a live agent. The claim is only as good as the terminal backend's answer. */
const CLAIMED_LIVE_STATUSES = new Set<string>(['running', 'starting', 'healthy', 'warning', 'stuck', 'stalled']);

/**
 * The ids of agents the terminal backend currently hosts (PAN-3540). The
 * snapshot's agent rows carry the status the agent record last stored, so a
 * dead agent keeps `running` until something rewrites it — the God View drew
 * those rows as live orbs and counted them in the census. `backendPanesById`
 * is the backend inventory (judged by the liveness oracle, src/lib/agents/liveness.ts),
 * kept current by `backend_pane.*` events; a non-exited pane is the only
 * evidence of life. Matching follows StoppedAgentsBanner: the pane's agent id,
 * pane id, or terminal id, falling back to the pane's issue and role.
 */
export function observedLiveAgentIds(
  agents: readonly AgentSnapshot[],
  panesById: Readonly<Record<string, BackendPane>> | undefined,
): ReadonlySet<string> {
  const live = new Set<string>();
  for (const pane of Object.values(panesById ?? {})) {
    if (pane.state === 'exited') continue;
    const agent = agents.find((candidate) =>
      candidate.id === pane.agentId || candidate.id === pane.id || candidate.id === pane.terminalId)
      ?? (pane.issue
        ? agents.find((candidate) =>
          candidate.issueId?.toUpperCase() === pane.issue?.toUpperCase() && candidate.role === pane.role)
        : undefined);
    if (agent) live.add(agent.id);
  }
  return live;
}

/**
 * Agent rows as the terminal backend sees them: a row that claims to be live
 * with no pane behind it reads `stopped`, so every downstream rule (orb
 * membership, primary agent, pause voters, heat, census) treats it exactly
 * like the stopped row it is.
 */
export function withObservedLiveness<T extends AgentSnapshot>(
  agents: readonly T[],
  panesById: Readonly<Record<string, BackendPane>> | undefined,
): T[] {
  const live = observedLiveAgentIds(agents, panesById);
  return agents.map((agent) =>
    CLAIMED_LIVE_STATUSES.has(String(agent.status)) && !live.has(agent.id)
      ? { ...agent, status: 'stopped' as const }
      : agent);
}

export function isClaimedLiveStatus(status: AgentSnapshot['status'] | string | undefined): boolean {
  return CLAIMED_LIVE_STATUSES.has(String(status));
}
