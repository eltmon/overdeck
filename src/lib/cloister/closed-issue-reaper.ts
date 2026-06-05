import { Effect } from 'effect';

import { listRunningAgents, stopAgent } from '../agents.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { isIssueClosed } from './issue-closed.js';

async function issueClosedOnce(issueId: string, cache: Map<string, Promise<boolean>>): Promise<boolean> {
  let promise = cache.get(issueId);
  if (!promise) {
    promise = isIssueClosed(issueId);
    cache.set(issueId, promise);
  }
  return promise;
}

export async function reconcileClosedIssueAgents(): Promise<string[]> {
  const actions: string[] = [];
  const closedChecks = new Map<string, Promise<boolean>>();
  const agents = await Effect.runPromise(listRunningAgents());

  for (const agent of agents) {
    if (agent.status === 'stopped' || agent.status === 'error') continue;

    const issueId = (agent.issueId ?? '').trim().toUpperCase();
    if (!issueId) continue;
    if (!await issueClosedOnce(issueId, closedChecks)) continue;

    await Effect.runPromise(stopAgent(agent.id));
    const action = `Reaped ${agent.id} — parent issue ${issueId} is closed`;
    actions.push(action);
    console.log(`[deacon] ${action}`);
    emitActivityEntrySync({
      source: 'cloister',
      level: 'info',
      issueId,
      message: `[deacon] reaped ${agent.id} — parent issue ${issueId} is closed`,
    });
  }

  return actions;
}
