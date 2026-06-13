import { Effect } from 'effect';

import { listRunningAgents, stopAgent } from '../agents.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { listSessionNames } from '../tmux.js';
import { getNoResumeMode } from './no-resume-mode.js';
import { isIssueClosed } from './issue-closed.js';

async function issueClosedOnce(issueId: string, cache: Map<string, Promise<boolean>>): Promise<boolean> {
  let promise = cache.get(issueId);
  if (!promise) {
    promise = isIssueClosed(issueId);
    cache.set(issueId, promise);
  }
  return promise;
}

// Sessions reaped by NAME as a backstop: inspect sessions never have agent
// state, and strike sessions can outlive their state entry (e.g. state already
// stopped or removed while the tmux session idles — PAN-1721).
function issueIdFromStatelessSession(sessionName: string): string | null {
  const match = sessionName.match(/^(?:inspect|strike)-([a-z0-9]+-\d+)(?:-|$)/i);
  return match ? match[1].toUpperCase() : null;
}

async function stopClosedAgent(agentId: string, issueId: string, actions: string[]): Promise<void> {
  await Effect.runPromise(stopAgent(agentId));
  const action = `Reaped ${agentId} — parent issue ${issueId} is closed`;
  actions.push(action);
  console.log(`[deacon] ${action}`);
  emitActivityEntrySync({
    source: 'cloister',
    level: 'info',
    issueId,
    message: `[deacon] reaped ${agentId} — parent issue ${issueId} is closed`,
  });
}

export async function reconcileClosedIssueAgents(): Promise<string[]> {
  const noResumeMode = getNoResumeMode();
  if (noResumeMode.active) return [];

  const actions: string[] = [];
  const closedChecks = new Map<string, Promise<boolean>>();
  const reapedAgentIds = new Set<string>();
  const agents = await Effect.runPromise(listRunningAgents());

  for (const agent of agents) {
    if (agent.status === 'stopped' || agent.status === 'error') continue;

    const issueId = (agent.issueId ?? '').trim().toUpperCase();
    if (!issueId) continue;
    if (!await issueClosedOnce(issueId, closedChecks)) continue;

    await stopClosedAgent(agent.id, issueId, actions);
    reapedAgentIds.add(agent.id);
  }

  const sessionNames = await Effect.runPromise(listSessionNames());
  for (const sessionName of sessionNames) {
    if (reapedAgentIds.has(sessionName)) continue;

    const issueId = issueIdFromStatelessSession(sessionName);
    if (!issueId) continue;
    if (!await issueClosedOnce(issueId, closedChecks)) continue;

    await stopClosedAgent(sessionName, issueId, actions);
    reapedAgentIds.add(sessionName);
  }

  return actions;
}
