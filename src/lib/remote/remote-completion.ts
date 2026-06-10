/**
 * Remote Agent Completion Handoff
 *
 * Remote (fly.io) work agents cannot run `pan done` — the host pipeline has
 * no workspace registry entry for them. Instead they finish by pushing their
 * feature branch and creating the `/workspace/.pan/REMOTE_DONE` sentinel
 * file (see the REMOTE gate in cloister/prompts/work.md).
 *
 * `reapCompletedRemoteAgents()` is the host-side half of that contract:
 * for every remote agent that has created the sentinel (or exited after
 * pushing its branch), it
 *
 *   1. verifies the feature branch exists on origin,
 *   2. materializes the standard local worktree for the branch,
 *   3. copies the remote .pan/continue.json back (best effort),
 *   4. writes a minimal local agent state.json (downstream flows resolve
 *      the workspace through it),
 *   5. creates the review artifact set + review status (same entry the
 *      `pan done` flow uses), writes the `completed` marker that the
 *      cloister's checkCompletionMarkers() patrol consumes,
 *   6. stops the fly machine and marks the remote agent state stopped.
 *
 * Invoked via `pan admin remote reap` (and suitable for a deacon patrol).
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { loadConfigSync } from '../config.js';
import { createFlyProviderFromConfig } from './index.js';
import {
  loadRemoteAgentState,
  saveRemoteAgentState,
  isRemoteAgentRunning,
  listActiveRemoteAgentStates,
} from './remote-agents.js';
import { resolveProjectFromIssueSync, extractTeamPrefix, findProjectByTeamSync } from '../projects.js';
import { createWorkspace } from '../workspace-manager.js';
import { PAN_DIRNAME, PAN_CONTINUE_FILENAME } from '../pan-dir/index.js';

const execAsync = promisify(exec);
const AGENTS_DIR = join(homedir(), '.panopticon', 'agents');

export interface RemoteReapResult {
  agentId: string;
  issueId: string;
  status: 'handed-off' | 'still-running' | 'stale' | 'error';
  details: string[];
}

/** List agent IDs that have a remote-state.json in running/starting state. */
function listActiveRemoteAgents(): string[] {
  return listActiveRemoteAgentStates().map((state) => state.id);
}

async function branchExistsOnOrigin(projectRoot: string, branch: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`git ls-remote --heads origin ${branch}`, { cwd: projectRoot });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Reap completed remote agents into the review pipeline.
 * Pass issueId to target one agent; otherwise scans all active remote agents.
 */
export async function reapCompletedRemoteAgents(opts: { issueId?: string; dryRun?: boolean } = {}): Promise<RemoteReapResult[]> {
  const agentIds = opts.issueId
    ? [`agent-${opts.issueId.toLowerCase()}`]
    : listActiveRemoteAgents();

  const results: RemoteReapResult[] = [];

  for (const agentId of agentIds) {
    const details: string[] = [];
    const remoteState = loadRemoteAgentState(agentId);
    if (!remoteState || remoteState.location !== 'remote') {
      results.push({ agentId, issueId: opts.issueId ?? 'unknown', status: 'stale', details: ['No remote-state.json'] });
      continue;
    }
    const issueId = remoteState.issueId.toUpperCase();
    const vmName = remoteState.vmName;

    try {
      // 1. Completion detection: the /workspace/.pan/REMOTE_DONE sentinel
      // file (created by the agent per the REMOTE prompt contract), or the
      // session having exited. Do NOT grep session output for the marker —
      // the prompt's own instruction text contains the literal string, so a
      // mid-work agent's pane matches it (false positive observed live on
      // the first migrated issue).
      let sessionAlive = false;
      let sentinelSeen = false;
      try {
        sessionAlive = await isRemoteAgentRunning(agentId, vmName);
        const config = loadConfigSync();
        const fly = createFlyProviderFromConfig(config.remote);
        const check = await Effect.runPromise(
          fly.ssh(vmName, '[ -f /workspace/.pan/REMOTE_DONE ] && echo present')
        );
        sentinelSeen = check.stdout.trim() === 'present';
      } catch (err: any) {
        details.push(`VM unreachable (${err.message}) — falling back to branch check`);
      }

      const teamPrefix = extractTeamPrefix(issueId);
      const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;
      const resolved = resolveProjectFromIssueSync(issueId, []);
      const projectRoot = projectConfig?.path ?? resolved?.projectPath;
      if (!projectRoot) {
        throw new Error(`Cannot resolve project for ${issueId}`);
      }

      const branch = `feature/${issueId.toLowerCase()}`;
      const pushed = await branchExistsOnOrigin(projectRoot, branch);

      if (sessionAlive && !sentinelSeen) {
        results.push({ agentId, issueId, status: 'still-running', details });
        continue;
      }
      if (!pushed) {
        details.push(`Session ${sessionAlive ? 'signaled done' : 'ended'} but ${branch} is not on origin — not reaping`);
        if (!sessionAlive) {
          // Terminal: dead session, no pushed work. Persist error so the
          // deacon patrol doesn't re-report every cycle; recover manually
          // via `pan admin remote reap --issue <id>` after inspecting the VM.
          saveRemoteAgentState({ ...remoteState, status: 'error', lastActivity: new Date().toISOString() });
        }
        results.push({ agentId, issueId, status: 'error', details });
        continue;
      }
      details.push(sentinelSeen ? `REMOTE_DONE sentinel present for ${issueId}` : `Session ended; ${branch} is pushed`);

      if (opts.dryRun) {
        details.push('Dry run — would hand off to review');
        results.push({ agentId, issueId, status: 'handed-off', details });
        continue;
      }

      // 2. Materialize the standard local worktree (tracks the pushed branch).
      const workspacePath = join(projectRoot, 'workspaces', `feature-${issueId.toLowerCase()}`);
      if (!existsSync(workspacePath)) {
        if (!projectConfig) throw new Error(`No project config for ${issueId}; cannot create workspace`);
        const wsResult = await Effect.runPromise(createWorkspace({
          projectConfig,
          featureName: issueId.toLowerCase(),
          startDocker: false,
        }));
        if (!wsResult.success) {
          throw new Error(`Failed to create local worktree: ${wsResult.errors.join('; ')}`);
        }
        details.push(`Materialized local worktree at ${workspacePath}`);
      } else {
        // Worktree exists (e.g. migrated issue with --keep) — fast-forward it.
        await execAsync(`git fetch origin ${branch}`, { cwd: workspacePath });
        await execAsync(`git merge --ff-only origin/${branch}`, { cwd: workspacePath }).catch(() => {
          details.push('Local worktree diverged from origin — left as-is');
        });
      }

      // 3. Copy continue.json back from the VM (best effort — session record).
      try {
        const config = loadConfigSync();
        const fly = createFlyProviderFromConfig(config.remote);
        mkdirSync(join(workspacePath, PAN_DIRNAME), { recursive: true });
        await fly.copyFromVm(
          vmName,
          `/workspace/${PAN_DIRNAME}/${PAN_CONTINUE_FILENAME}`,
          join(workspacePath, PAN_DIRNAME, PAN_CONTINUE_FILENAME),
        );
        details.push('Copied continue.json back from VM');
      } catch {
        details.push('No continue.json retrieved from VM (skipped)');
      }

      // 4. Minimal local agent state so downstream flows resolve the workspace.
      const { getAgentStateSync, saveAgentStateSync } = await import('../agents.js');
      const existing = getAgentStateSync(agentId);
      if (existing) {
        existing.workspace = existing.workspace || workspacePath;
        existing.status = 'stopped';
        existing.lastActivity = new Date().toISOString();
        saveAgentStateSync(existing);
      } else {
        saveAgentStateSync({
          id: agentId,
          issueId,
          workspace: workspacePath,
          role: 'work',
          harness: 'claude-code',
          model: remoteState.model,
          status: 'stopped',
          startedAt: remoteState.startedAt,
          lastActivity: new Date().toISOString(),
        });
      }

      // 5. Review artifacts + completed marker — same entries pan done uses.
      const { createReviewArtifactsForIssue } = await import('../review-artifacts.js');
      const { setReviewStatusSync } = await import('../review-status.js');
      const artifactResult = await Effect.runPromise(createReviewArtifactsForIssue(issueId, workspacePath));
      const primaryArtifact = artifactResult.mergeSet?.repos.find((repo) => !!repo.artifactUrl);
      if (primaryArtifact?.artifactUrl) {
        setReviewStatusSync(issueId, { prUrl: primaryArtifact.artifactUrl });
        details.push(`Review artifact: ${primaryArtifact.artifactUrl}`);
      }

      mkdirSync(join(AGENTS_DIR, agentId), { recursive: true });
      const processedMarker = join(AGENTS_DIR, agentId, 'completed.processed');
      if (existsSync(processedMarker)) {
        try { unlinkSync(processedMarker); } catch { /* best effort */ }
      }
      writeFileSync(join(AGENTS_DIR, agentId, 'completed'), JSON.stringify({
        timestamp: new Date().toISOString(),
        trackerUpdated: false,
        comment: `Remote agent completed on ${vmName} (reaped)`,
      }));
      details.push('Wrote completion marker for cloister pickup');

      // 6. Retire the remote workspace entirely: from review onward the
      // pipeline runs against the local worktree, and lingering remote
      // metadata makes getWorkspaceInfoForIssue() route review operations
      // at the (now-idle) VM. Destroying the machine also closes the
      // run-forever cost leak.
      try {
        const config = loadConfigSync();
        const fly = createFlyProviderFromConfig(config.remote);
        if (sessionAlive) {
          const { killRemoteAgent } = await import('./remote-agents.js');
          await killRemoteAgent(agentId, vmName).catch(() => undefined);
        }
        await Effect.runPromise(fly.deleteVm(vmName));
        details.push(`Destroyed machine ${vmName}`);
      } catch (err: any) {
        details.push(`Warning: could not destroy machine: ${err.message}`);
      }
      const { deleteWorkspaceMetadataSync } = await import('./workspace-metadata.js');
      deleteWorkspaceMetadataSync(issueId);
      details.push('Removed remote workspace metadata (pipeline is local from here)');
      saveRemoteAgentState({ ...remoteState, status: 'stopped', lastActivity: new Date().toISOString() });

      results.push({ agentId, issueId, status: 'handed-off', details });
    } catch (err: any) {
      details.push(err.message);
      results.push({ agentId, issueId, status: 'error', details });
    }
  }

  return results;
}
