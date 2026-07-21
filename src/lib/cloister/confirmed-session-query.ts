import { querySessionSync, type SessionQueryResult } from '../tmux.js';

const consecutiveMisses = new Map<string, number>();

export function queryConfirmedSession(agentId: string): [SessionQueryResult, string?] {
  const query = querySessionSync(agentId);
  if (query.status === 'error') {
    consecutiveMisses.delete(agentId);
    return [query, `skipped — tmux query failed (${query.detail})`];
  }
  if (query.status === 'exists') {
    consecutiveMisses.delete(agentId);
    return [query];
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

export function consumeConfirmedSessionDetail(agentId: string, query: SessionQueryResult): string {
  clearConfirmedSessionMiss(agentId);
  return query.status === 'missing' ? query.detail : 'pane confirmed dead';
}
