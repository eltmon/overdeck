import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect, Stream } from 'effect';
import { HttpServerResponse } from 'effect/unstable/http';

import { jsonResponse } from '../../dashboard/server/http-helpers.js';
import { saveAgentStateAndEmitEvent } from '../../dashboard/server/services/agent-projection.js';
import { getSharedIssueService } from '../../dashboard/server/services/issue-service-singleton.js';
import { parseIssueIdSync } from '../issue-id.js';
import { operatorInterventionEvent } from '../operator-interventions.js';
import { getAgentState } from '../agents.js';
import {
  getIssueForCleanup,
  isOrphanedIssue,
  runDestructiveIssueLifecycle,
} from './issue-transitions.js';
import { resolveIssueProjectPathSync } from './issue-reads.js';
import { getWorkspaceForIssue } from '../workspaces/resolver.js';
import { archiveWorkspace } from '../workspaces/writer.js';

const execAsync = promisify(exec);

/**
 * PAN-1990: archive (never delete) the issue's workspace row. Row and memory
 * home survive directory/stack teardown on both the cleanup and deep-wipe
 * paths; only is_archived flips. Non-fatal — a missing row (not yet
 * backfilled) or a write failure must never block the destructive teardown
 * this function is called alongside.
 */
export function archiveIssueWorkspaceRow(issueId: string): void {
  try {
    const row = getWorkspaceForIssue(issueId);
    if (row) archiveWorkspace(row.id);
  } catch { /* non-fatal */ }
}

type EventStoreLike = {
  append(event: Record<string, unknown>): Effect.Effect<unknown, unknown>;
  appendAsync(event: Record<string, unknown>): Effect.Effect<unknown, unknown>;
};

function getIssueDataService() {
  return getSharedIssueService();
}

export async function cleanupAgentStateDirs(dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  }
}

export async function removeCompletionMarker(markerPath: string): Promise<void> {
  if (existsSync(markerPath)) await rm(markerPath);
}

export async function cleanupWorkspaceForIssue(rawId: string, eventStore: EventStoreLike): Promise<HttpServerResponse.HttpServerResponse> {
  const parsedIssueId = parseIssueIdSync(rawId);
  if (!parsedIssueId) {
    return jsonResponse({ error: 'Invalid issue id: ' + rawId }, { status: 400 });
  }
  const id = parsedIssueId.raw.toUpperCase();
  const issue = getIssueForCleanup(id);
  if (!issue || !isOrphanedIssue(issue)) {
    return jsonResponse({ error: 'Cleanup is only allowed for closed/orphaned issues' }, { status: 409 });
  }
  const cleanupLog: string[] = [];

  const issueLower = id.toLowerCase();
  const projectRoot = resolveIssueProjectPathSync(id) || null;

  // Git worktree/workspace and agent dir cleanup (all async with meaningful branching on error)
  if (projectRoot) {
    const workspacePath = join(projectRoot, 'workspaces', `feature-${issueLower}`);
    try {
      const worktreeList = await execAsync('git worktree list --porcelain', { cwd: projectRoot, encoding: 'utf-8' });
      if (worktreeList.stdout.includes(workspacePath)) {
        await execAsync(`git worktree remove "${workspacePath}" --force`, { cwd: projectRoot, encoding: 'utf-8' });
        cleanupLog.push(`Removed git worktree: ${workspacePath}`);
      } else if (existsSync(workspacePath)) {
        await execAsync(`rm -rf "${workspacePath}"`, { encoding: 'utf-8' });
        cleanupLog.push(`Removed directory: ${workspacePath}`);
      }
    } catch {
      if (existsSync(workspacePath)) {
        await execAsync(`rm -rf "${workspacePath}"`, { encoding: 'utf-8' });
        cleanupLog.push(`Removed directory: ${workspacePath}`);
      }
    }

    const branchName = `feature/${issueLower}`;
    try {
      await execAsync(`git branch -D "${branchName}" 2>/dev/null || true`, { cwd: projectRoot, encoding: 'utf-8' });
      cleanupLog.push(`Deleted local branch: ${branchName}`);
    } catch { /* Branch might not exist */ }
  }

  const agentDir = join(homedir(), '.overdeck', 'agents', `agent-${issueLower}`);
  if (existsSync(agentDir)) {
    await execAsync(`rm -rf "${agentDir}"`, { encoding: 'utf-8' });
    cleanupLog.push(`Removed agent state: ${agentDir}`);
  }

  archiveIssueWorkspaceRow(id);

  await Effect.runPromise(eventStore.append({
    type: 'workspace.deleted',
    timestamp: new Date().toISOString(),
    payload: { issueId: id },
  }));

  return jsonResponse({
    success: true,
    message: `Workspace cleaned up for ${id}`,
    cleanupLog,
  });
}

export async function deepWipeIssue(
  id: string,
  body: unknown,
  eventStore: EventStoreLike,
): Promise<HttpServerResponse.HttpServerResponse> {
  if (!parseIssueIdSync(id)) {
    return jsonResponse({ error: 'Invalid issue id: ' + id }, { status: 400 });
  }

  const { deleteWorkspace = true } = body as any || {};

  // PAN-1908: capture agent state before destruction so the stopped event can
  // be projected through the transactional boundary after the wipe succeeds.
  const workAgentId = `agent-${id.toLowerCase()}`;
  const planningAgentId = `planning-${id.toLowerCase()}`;
  const workAgentStateBeforeWipe = await Effect.runPromise(getAgentState(workAgentId));

  const encoder = new TextEncoder();
  const nodeStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendEvent = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      sendEvent({ type: 'started', issueId: id });

      await Effect.runPromise(eventStore.append({
        type: 'workspace.wipe_started',
        timestamp: new Date().toISOString(),
        payload: { issueId: id },
      }));

      const result = await runDestructiveIssueLifecycle(id, 'reset', {
        deleteWorkspace,
        onProgress: sendEvent,
      });

      if (result.success) {
        archiveIssueWorkspaceRow(id.toUpperCase());
        await Effect.runPromise(eventStore.appendAsync(operatorInterventionEvent({
          issueId: id.toUpperCase(),
          kind: 'deep_wipe',
          source: 'dashboard',
        })));
        // PAN-1908: write-through projection for the real work agent.
        if (workAgentStateBeforeWipe) {
          try {
            saveAgentStateAndEmitEvent(workAgentStateBeforeWipe, {
              type: 'agent.stopped',
              timestamp: new Date().toISOString(),
              payload: { agentId: workAgentId, issueId: workAgentStateBeforeWipe.issueId },
            });
          } catch { /* non-fatal */ }
        }
        // Planning sessions are not agents in the runtime registry; keep raw emit.
        try {
          await Effect.runPromise(eventStore.append({
            type: 'agent.stopped',
            timestamp: new Date().toISOString(),
            payload: { agentId: planningAgentId },
          } as any));
        } catch { /* non-fatal */ }
        await Effect.runPromise(eventStore.append({
          type: 'issue.statusChanged',
          timestamp: new Date().toISOString(),
          payload: { issueId: id, status: 'Todo', canonicalStatus: 'todo' },
        }));
        await Effect.runPromise(eventStore.append({
          type: 'workspace.destroyed',
          timestamp: new Date().toISOString(),
          payload: { issueId: id },
        }));
        try { getIssueDataService().patchIssue(id, { status: 'Todo', canonicalStatus: 'todo' }); } catch { /* non-fatal */ }
        sendEvent({ type: 'complete', message: `Reset completed for ${id}` });
      } else {
        sendEvent({ type: 'error', error: result.error || 'Reset failed' });
      }
      controller.close();
    },
  });

  const effectStream = Stream.fromReadableStream<Uint8Array, unknown>({
    evaluate: () => nodeStream,
    onError: (err) => err,
  });

  return HttpServerResponse.stream(effectStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

export async function copySettingsToWorkspace(id: string): Promise<HttpServerResponse.HttpServerResponse> {
  if (!parseIssueIdSync(id)) {
    return jsonResponse({ error: "Invalid issue ID" }, { status: 400 });
  }

  const projectPath = resolveIssueProjectPathSync(id);

  const workspacePath = projectPath
    ? join(projectPath, 'workspaces', `feature-${id.toLowerCase()}`)
    : '';

  if (!workspacePath || !existsSync(workspacePath)) {
    return jsonResponse({ success: false, error: 'Workspace not found' }, { status: 404 });
  }

  const { copyOverdeckSettingsToWorkspaceSync } = await import('../workspace-manager.js');

  const result = copyOverdeckSettingsToWorkspaceSync(workspacePath);
  return jsonResponse({
    success: result.errors.length === 0 || result.copied.length > 0,
    copied: result.copied.map(p => p.replace(workspacePath + '/', '')),
    errors: result.errors,
  });
}
