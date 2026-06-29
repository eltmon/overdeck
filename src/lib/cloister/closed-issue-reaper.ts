import { Effect } from 'effect';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { listRunningAgents, stopAgent } from '../agents.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { AGENTS_DIR } from '../paths.js';
import { listProjectsSync } from '../projects.js';
import { resolveProjectForIssue } from '../pan-dir/record.js';
import { listSessionNames } from '../tmux.js';
import { isIssueClosed } from './issue-closed.js';
import { reapIssueResidue } from './reap-issue-residue.js';

// Sessions reaped by NAME as a backstop: inspect sessions never have agent
// state, and strike sessions can outlive their state entry (e.g. state already
// stopped or removed while the tmux session idles — PAN-1721).
function issueIdFromStatelessSession(sessionName: string): string | null {
  const match = sessionName.match(/^(?:inspect|strike)-([a-z0-9]+-\d+)(?:-|$)/i);
  return match ? match[1].toUpperCase() : null;
}

function issueIdFromFeatureWorkspace(entryName: string): string | null {
  const match = entryName.match(/^feature-([a-z]+-\d+)$/i);
  return match ? match[1].toUpperCase() : null;
}

function issueIdFromAgentDir(entryName: string): string | null {
  const match = entryName.match(/^agent-([a-z]+-\d+)$/i);
  return match ? match[1].toUpperCase() : null;
}

async function isClosedIssue(
  issueId: string,
  closedChecks: Map<string, Promise<boolean>>,
): Promise<boolean> {
  let promise = closedChecks.get(issueId);
  if (!promise) {
    promise = isIssueClosed(issueId);
    closedChecks.set(issueId, promise);
  }
  return promise;
}

async function reapClosedIssueResidue(
  projectPath: string,
  issueId: string,
  actions: string[],
  reapedIssueKeys: Set<string>,
): Promise<void> {
  const key = `${projectPath}:${issueId}`;
  if (reapedIssueKeys.has(key)) return;
  reapedIssueKeys.add(key);
  actions.push(...await reapIssueResidue(projectPath, issueId));
}

async function reapResolvedIssueResidue(
  issueId: string,
  actions: string[],
  reapedIssueKeys: Set<string>,
): Promise<void> {
  const project = resolveProjectForIssue(issueId);
  if (!project) return;
  await reapClosedIssueResidue(project.path, issueId, actions, reapedIssueKeys);
}

function listConfiguredProjects(): Array<{ path: string }> {
  try {
    return listProjectsSync().map(({ config }) => ({ path: config.path }));
  } catch {
    return [];
  }
}

function listDirectoryNames(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
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
  const upperIssueId = issueId.trim().toUpperCase();
  if (!upperIssueId) return [];

  // Guard against spurious events: only act when the issue is actually closed.
  if (!await isIssueClosed(upperIssueId)) return [];

  const actions: string[] = [];
  const reapedAgentIds = new Set<string>();
  const reapedIssueKeys = new Set<string>();

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

  await reapResolvedIssueResidue(upperIssueId, actions, reapedIssueKeys);
  return actions;
}

/**
 * PAN-1908: keep a thin table+session safety net for dropped closed-issue
 * events. The primary path is reactive via handleIssueStatusChangedClosed.
 */
export async function reconcileClosedIssueAgents(): Promise<string[]> {
  const actions: string[] = [];
  const closedChecks = new Map<string, Promise<boolean>>();
  const reapedAgentIds = new Set<string>();
  const closedIssueIds = new Set<string>();
  const reapedIssueKeys = new Set<string>();
  const agents = await Effect.runPromise(listRunningAgents());

  for (const agent of agents) {
    if (agent.status === 'stopped' || agent.status === 'error') continue;

    const issueId = (agent.issueId ?? '').trim().toUpperCase();
    if (!issueId) continue;

    if (!await isClosedIssue(issueId, closedChecks)) continue;

    await stopClosedAgent(agent.id, issueId, actions);
    reapedAgentIds.add(agent.id);
    closedIssueIds.add(issueId);
  }

  const sessionNames = await Effect.runPromise(listSessionNames());
  for (const sessionName of sessionNames) {
    if (reapedAgentIds.has(sessionName)) continue;

    const issueId = issueIdFromStatelessSession(sessionName);
    if (!issueId) continue;

    if (!await isClosedIssue(issueId, closedChecks)) continue;

    await stopClosedAgent(sessionName, issueId, actions);
    reapedAgentIds.add(sessionName);
    closedIssueIds.add(issueId);
  }

  for (const issueId of closedIssueIds) {
    await reapResolvedIssueResidue(issueId, actions, reapedIssueKeys);
  }

  for (const project of listConfiguredProjects()) {
    const workspacesDir = join(project.path, 'workspaces');
    for (const entryName of listDirectoryNames(workspacesDir)) {
      const issueId = issueIdFromFeatureWorkspace(entryName);
      if (!issueId) continue;
      if (!await isClosedIssue(issueId, closedChecks)) continue;
      await reapClosedIssueResidue(project.path, issueId, actions, reapedIssueKeys);
    }
  }

  for (const entryName of listDirectoryNames(AGENTS_DIR)) {
    const issueId = issueIdFromAgentDir(entryName);
    if (!issueId) continue;
    if (!await isClosedIssue(issueId, closedChecks)) continue;
    await reapResolvedIssueResidue(issueId, actions, reapedIssueKeys);
  }

  return actions;
}
