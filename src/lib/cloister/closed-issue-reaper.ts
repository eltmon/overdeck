import { Effect } from 'effect';
import { exec } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { listRunningAgents, stopAgent } from '../agents.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { AGENTS_DIR } from '../paths.js';
import { listProjectsSync } from '../projects.js';
import { readJournalStatusSync } from '../overdeck/review-status-record-sync.js';
import { resolveProjectForIssue } from '../pan-dir/record.js';
import { loadReviewStatuses, setReviewStatusSync } from '../review-status.js';
import type { ReviewStatus } from '../review-status-reconcile.js';
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

const execAsync = promisify(exec);
const DEVNET_CLOSURE_CHECK_CONCURRENCY = 4;

// Leaked `_devnet` networks are a residue source of their own: a closed issue
// whose sessions, workspace, and agent dirs are already gone can still hold a
// bridge network, and Docker's default address pools support only ~31 of them.
async function listFeatureDevnetIssueIds(): Promise<string[] | null> {
  try {
    const { stdout } = await execAsync(`docker network ls --format '{{.Name}}'`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
    const issueIds = new Set<string>();
    for (const name of stdout.trim().split('\n')) {
      const match = name.match(/-feature-([a-z]+-\d+)_devnet$/i);
      if (match) issueIds.add(match[1].toUpperCase());
    }
    return [...issueIds];
  } catch {
    return null;
  }
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

export async function reapClosedIssueReviewRequests(
  closedChecks: Map<string, Promise<boolean>>,
): Promise<string[]> {
  const actions: string[] = [];
  const statuses = loadReviewStatuses();

  for (const [issueId, dbStatus] of Object.entries(statuses)) {
    if (dbStatus.reviewStatus !== 'pending') continue;

    const journal = readJournalStatusSync(issueId);
    const existing = {
      ...dbStatus,
      ...(journal?.durable ?? {}),
      issueId,
    } as ReviewStatus;
    for (const field of journal?.clearedFields ?? []) {
      delete (existing as unknown as Record<string, unknown>)[field];
    }

    if (existing.reviewStatus !== 'pending' || !existing.reviewRequestedAt) continue;
    if (existing.reviewSpawnedAt &&
        Date.parse(existing.reviewRequestedAt) <= new Date(existing.reviewSpawnedAt).getTime()) continue;
    if (!await isClosedIssue(issueId, closedChecks)) continue;

    setReviewStatusSync(issueId, {
      reviewRequestedAt: undefined,
      reviewSpawnedAt: undefined,
    }, existing);
    const action = `Cleared unserviced review request for ${issueId} — parent issue is closed`;
    actions.push(action);
    console.log(`[deacon] ${action}`);
    emitActivityEntrySync({
      source: 'cloister',
      level: 'info',
      issueId,
      message: `[deacon] cleared unserviced review request for ${issueId} — parent issue is closed`,
    });
  }

  return actions;
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

  const devnetIssueIds = await listFeatureDevnetIssueIds();
  const openDevnetIssueIds: string[] = [];
  if (devnetIssueIds) {
    for (let offset = 0; offset < devnetIssueIds.length; offset += DEVNET_CLOSURE_CHECK_CONCURRENCY) {
      const batch = devnetIssueIds.slice(offset, offset + DEVNET_CLOSURE_CHECK_CONCURRENCY);
      const closureResults = await Promise.all(batch.map(async (issueId) => ({
        issueId,
        closed: await isClosedIssue(issueId, closedChecks),
      })));
      for (const { issueId, closed } of closureResults) {
        if (closed) await reapResolvedIssueResidue(issueId, actions, reapedIssueKeys);
        else openDevnetIssueIds.push(issueId);
      }
    }
  }

  let mergedIssueIds: string[] | null = devnetIssueIds ? [] : null;
  if (openDevnetIssueIds.length > 0) {
    try {
      const { getReviewStatusesSync } = await import('../review-status.js');
      const statuses = getReviewStatusesSync(openDevnetIssueIds);
      mergedIssueIds = openDevnetIssueIds.filter(
        (issueId) => statuses[issueId]?.mergeStatus === 'merged',
      );
    } catch (error) {
      mergedIssueIds = null;
      actions.push(`Failed to resolve merged-issue Docker cleanup status: ${error}`);
    }
  }
  if (mergedIssueIds) {
    try {
      const { reconcileMergedDockerCleanupQueue } = await import('./merged-docker-cleanup-worker.js');
      actions.push(...reconcileMergedDockerCleanupQueue(mergedIssueIds));
    } catch (error) {
      actions.push(`Failed to reconcile merged-issue Docker cleanup queue: ${error}`);
    }
  }

  actions.push(...await reapClosedIssueReviewRequests(closedChecks));
  return actions;
}
