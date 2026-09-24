import { Effect } from 'effect';
import { querySession, type SessionQueryResult } from '../tmux.js';
import { supervisorProcessAliveSync } from '../agents/supervisor-liveness.js';

const consecutiveMisses = new Map<string, number>();

export async function queryConfirmedSession(agentId: string): Promise<[SessionQueryResult, string?]> {
  const query = await Effect.runPromise(querySession(agentId));
  if (query.status === 'error') {
    consecutiveMisses.delete(agentId);
    return [query, `skipped — tmux query failed (${query.detail})`];
  }
  if (query.status === 'exists') {
    consecutiveMisses.delete(agentId);
    return [query];
  }
  // PAN-3002: a missing tmux session is NOT proof of death for supervisor-
  // delivered agents — the pty-supervisor worker survives its tmux session and
  // keeps running untracked (MIN-882: 36h lost; PAN-2997: killed 41s after a
  // healthy resume). A live worker process retains the agent.
  if (supervisorProcessAliveSync(agentId)) {
    consecutiveMisses.delete(agentId);
    return [query, `retained — live pty-supervisor process despite missing tmux session (PAN-3002)`];
  }
  const missCount = (consecutiveMisses.get(agentId) ?? 0) + 1;
  consecutiveMisses.set(agentId, missCount);
  return missCount < 2
    ? [query, `retained after first confirmed tmux miss (${query.detail})`]
    : [query];
}

export function clearConfirmedSessionMiss(agentId: string): void {
  consecutiveMisses.delete(agentId);
}
