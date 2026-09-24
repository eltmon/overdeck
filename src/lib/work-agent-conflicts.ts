import type { AgentState } from './agents.js';
import { normalizeAgentId } from './agents/identity.js';
import { listAgentStates } from './agents/queries.js';
import { isAlive, isConfirmedDead, type LivenessAsyncDeps } from './agents/liveness.js';

/**
 * Other work sessions for the issue whose harness is still live. Liveness comes
 * from the backend-aware oracle, never the tmux-only `tmuxActive` flag, which
 * reads every Herdr agent as gone. The stored status is not consulted: a stopped
 * row can still have a live pane. A probe that could not answer
 * (`runtime-indeterminate`) counts as live, so an outage blocks the start
 * instead of starting a second agent over a running one.
 */
export async function findConflictingWorkAgents(
  issueId: string,
  primaryAgentId: string,
  agents: AgentState[] = listAgentStates(),
  options: { ignoreRegisteredSlots?: boolean } = {},
  livenessDeps: LivenessAsyncDeps = {},
): Promise<AgentState[]> {
  const candidates = agents.map((agent) => ({ ...agent, id: normalizeAgentId(agent.id) })).filter((agent) =>
    agent.role === 'work'
    && agent.issueId.toUpperCase() === issueId.toUpperCase()
    && agent.id !== primaryAgentId
    && !(options.ignoreRegisteredSlots && agent.slotIndex !== undefined)
  );
  const verdicts = await Promise.all(candidates.map((agent) => isAlive(agent.id, livenessDeps)));
  return candidates.filter((_, index) => !isConfirmedDead(verdicts[index]!));
}

export async function describeConflictingWorkAgents(
  issueId: string,
  primaryAgentId: string,
  options: { ignoreRegisteredSlots?: boolean } = {},
): Promise<string | null> {
  const conflicts = await findConflictingWorkAgents(issueId, primaryAgentId, undefined, options);
  if (conflicts.length === 0) return null;
  const sessions = conflicts.map((agent) => `  ${agent.id} (${agent.workspace})`).join('\n');
  return `Cannot start ${issueId}: other work sessions are still live.\n${sessions}\nRun 'pan stop ${issueId}' to stop every issue session, then retry.\n`;
}
