import { Effect } from 'effect';

import { listRunningAgents, stopAgent } from '../agents.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { listSessionNames } from '../tmux.js';
import { getNoResumeMode } from './no-resume-mode.js';
import { isIssueClosed } from './issue-closed.js';

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

/**
 * PAN-1908: reactive closed-issue reaper. When an issue is closed, stop all
 * running agents and stateless sessions belonging to it without scanning the
 * full agent table or tmux session list.
 */
export async function handleIssueStatusChangedClosed(issueId: string): Promise<string[]> {
  const noResumeMode = getNoResumeMode();
  if (noResumeMode.active) return [];

  const upperIssueId = issueId.trim().toUpperCase();
  if (!upperIssueId) return [];

  // Guard against spurious events: only act when the issue is actually closed.
  if (!await isIssueClosed(upperIssueId)) return [];

  const actions: string[] = [];
  const reapedAgentIds = new Set<string>();

  // Stop running agents for this issue.
  const agents = await Effect.runPromise(listRunningAgents());
  for (const agent of agents) {
    if (agent.status === 'stopped' || agent.status === 'error') continue;
    const agentIssueId = (agent.issueId ?? '').trim().toUpperCase();
    if (agentIssueId !== upperIssueId) continue;

    await stopClosedAgent(agent.id, upperIssueId, actions);
    reapedAgentIds.add(agent.id);
  }

  // Stop stateless inspect/strike sessions for this issue.
  const sessionNames = await Effect.runPromise(listSessionNames());
  for (const sessionName of sessionNames) {
    if (reapedAgentIds.has(sessionName)) continue;
    const sessionIssueId = issueIdFromStatelessSession(sessionName);
    if (sessionIssueId !== upperIssueId) continue;

    await stopClosedAgent(sessionName, upperIssueId, actions);
    reapedAgentIds.add(sessionName);
  }

  return actions;
}

/**
 * PAN-1908: keep a thin table+session safety net for dropped closed-issue
 * events. The primary path is reactive via handleIssueStatusChangedClosed.
 */
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

    let promise = closedChecks.get(issueId);
    if (!promise) {
      promise = isIssueClosed(issueId);
      closedChecks.set(issueId, promise);
    }
    if (!await promise) continue;

    await stopClosedAgent(agent.id, issueId, actions);
    reapedAgentIds.add(agent.id);
  }

  const sessionNames = await Effect.runPromise(listSessionNames());
  for (const sessionName of sessionNames) {
    if (reapedAgentIds.has(sessionName)) continue;

    const issueId = issueIdFromStatelessSession(sessionName);
    if (!issueId) continue;

    let promise = closedChecks.get(issueId);
    if (!promise) {
      promise = isIssueClosed(issueId);
      closedChecks.set(issueId, promise);
    }
    if (!await promise) continue;

    await stopClosedAgent(sessionName, issueId, actions);
    reapedAgentIds.add(sessionName);
  }

  return actions;
}
