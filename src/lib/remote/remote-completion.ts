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

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { basename, join } from 'path';
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
  getRemoteAgentOutput,
  sendToRemoteAgent,
} from './remote-agents.js';
import { resolveProjectFromIssueSync, extractTeamPrefix, findProjectByTeamSync } from '../projects.js';
import { createWorkspace } from '../workspace-manager.js';
import { PAN_DIRNAME, PAN_CONTINUE_FILENAME } from '../pan-dir/index.js';

const execAsync = promisify(exec);
const AGENTS_DIR = join(homedir(), '.panopticon', 'agents');
const REMOTE_CLAUDE_CREDENTIAL_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

let lastRemoteClaudeCredentialFingerprint: string | null = null;
let lastRemoteClaudeCredentialRefreshAtMs = 0;

export interface RemoteReapResult {
  agentId: string;
  issueId: string;
  status: 'handed-off' | 'still-running' | 'stale' | 'error';
  details: string[];
}

interface RemoteClaudeCredentialRefreshDeps {
  listActiveRemoteAgentStates?: typeof listActiveRemoteAgentStates;
  nowMs?: () => number;
  credentialFingerprint?: () => string | null;
  loadConfig?: typeof loadConfigSync;
  createFlyProvider?: typeof createFlyProviderFromConfig;
}

function getHostClaudeCredentialFingerprint(): string | null {
  const credFile = join(homedir(), '.claude', '.credentials.json');
  if (!existsSync(credFile)) return null;
  try {
    const stat = statSync(credFile);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

export function resetRemoteClaudeCredentialRefreshForTests(): void {
  lastRemoteClaudeCredentialFingerprint = null;
  lastRemoteClaudeCredentialRefreshAtMs = 0;
}

/**
 * Proactively copy fresh host Claude credentials to active remote agents.
 *
 * Host OAuth refresh rotates refresh tokens, so a long-running Fly VM can be
 * left with an orphaned copy. The host credentials file mtime is the precise
 * trigger on Linux; platforms without that file fall back to a bounded 15 min
 * refresh cadence. The active-agent scan runs first so the common zero-remote
 * case never constructs a Fly provider or makes Fly API calls.
 */
export async function refreshClaudeCredentialsForActiveRemoteAgents(
  deps: RemoteClaudeCredentialRefreshDeps = {},
): Promise<string[]> {
  const activeStates = (deps.listActiveRemoteAgentStates ?? listActiveRemoteAgentStates)();
  if (activeStates.length === 0) return [];

  const nowMs = (deps.nowMs ?? Date.now)();
  const fingerprint = (deps.credentialFingerprint ?? getHostClaudeCredentialFingerprint)();
  const credentialChanged = fingerprint !== null && fingerprint !== lastRemoteClaudeCredentialFingerprint;
  const refreshDue = lastRemoteClaudeCredentialRefreshAtMs === 0 ||
    nowMs - lastRemoteClaudeCredentialRefreshAtMs >= REMOTE_CLAUDE_CREDENTIAL_REFRESH_INTERVAL_MS;
  if (!credentialChanged && !refreshDue) return [];

  lastRemoteClaudeCredentialRefreshAtMs = nowMs;
  if (fingerprint !== null) {
    lastRemoteClaudeCredentialFingerprint = fingerprint;
  }

  const config = (deps.loadConfig ?? loadConfigSync)();
  const fly = (deps.createFlyProvider ?? createFlyProviderFromConfig)(config.remote);
  const actions: string[] = [];

  for (const state of activeStates) {
    try {
      const synced = await fly.syncClaudeCredentials(state.vmName);
      actions.push(
        synced
          ? `Remote credentials refreshed for ${state.issueId.toUpperCase()} on ${state.vmName}`
          : `Remote credentials refresh skipped for ${state.issueId.toUpperCase()} on ${state.vmName} (no host credentials)`,
      );
    } catch (err: any) {
      actions.push(`Remote credentials refresh failed for ${state.issueId.toUpperCase()} on ${state.vmName}: ${err.message}`);
    }
  }

  return actions;
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
 * Preserve the remote session's observable state into the local agent dir
 * BEFORE the machine goes away: the final tmux pane (remote-output.log) and
 * the Claude Code session JSONLs (remote-sessions/). The JSONLs are the only
 * record of the remote conversation — destroying a machine without them
 * loses the transcript irrecoverably (learned on the first migrated issue).
 */
async function captureRemoteForensics(agentId: string, vmName: string, details: string[]): Promise<{ paneCaptured: boolean }> {
  const agentDir = join(AGENTS_DIR, agentId);
  mkdirSync(agentDir, { recursive: true });
  const config = loadConfigSync();
  const fly = createFlyProviderFromConfig(config.remote);

  let paneCaptured = false;
  try {
    const output = await getRemoteAgentOutput(agentId, vmName, 2000);
    if (output.trim()) {
      writeFileSync(join(agentDir, 'remote-output.log'), output);
      details.push('Captured final remote pane to remote-output.log');
      paneCaptured = true;
    }
  } catch {
    details.push('Could not capture remote pane');
  }

  // The Machines exec API runs with HOME=/, so Claude's session JSONLs live
  // under /.claude/projects — but the launcher may export HOME=/root, so
  // check both. Surface failures: an empty copy means the only transcript of
  // the agent's work is about to be lost with the rootfs.
  try {
    const list = await Effect.runPromise(
      fly.ssh(vmName, 'ls /.claude/projects/*/*.jsonl /root/.claude/projects/*/*.jsonl 2>/dev/null')
    );
    const files = list.stdout.trim().split('\n').filter(Boolean);
    if (files.length > 0) {
      const destDir = join(agentDir, 'remote-sessions');
      mkdirSync(destDir, { recursive: true });
      let copied = 0;
      for (const remotePath of files) {
        try {
          await fly.copyFromVm(vmName, remotePath, join(destDir, basename(remotePath)));
          copied++;
        } catch {
          details.push(`Failed to copy ${remotePath}`);
        }
      }
      details.push(`Copied ${copied}/${files.length} session JSONL(s) to remote-sessions/`);
    } else {
      details.push('No session JSONLs found under /.claude or /root/.claude');
    }
  } catch (err: any) {
    details.push(`Could not copy session JSONLs: ${err.message}`);
  }
  return { paneCaptured };
}

/**
 * Commit and push whatever work is sitting in /workspace before the machine
 * is stopped. Fly machine rootfs is ephemeral — a stop is only "preserved
 * for inspection" until the next start, which resets the filesystem from the
 * image. Unpushed work on a stopped machine is one restart away from gone
 * (lost live on PAN-1762: ~2h of agent work).
 */
async function salvageRemoteWork(vmName: string, branch: string, details: string[]): Promise<void> {
  const config = loadConfigSync();
  const fly = createFlyProviderFromConfig(config.remote);
  try {
    const result = await Effect.runPromise(fly.ssh(
      vmName,
      `cd /workspace && git add -A && (git diff --cached --quiet || git commit -m "wip(remote): salvage checkpoint before machine stop") && git push origin ${branch} 2>&1 | tail -2`
    ));
    if (result.exitCode === 0) {
      details.push(`Salvaged workspace state to origin/${branch}`);
    } else {
      details.push(`Salvage push failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
    }
  } catch (err: any) {
    details.push(`Salvage attempt failed: ${err.message}`);
  }
}

/**
 * Long remote runs outlive the synced OAuth token: when the host's Claude
 * refreshes its token, the VM's copy is orphaned (refresh tokens rotate),
 * and the agent stalls on `API Error: 401 · Please run /login` until
 * credentials are re-synced (observed live on PAN-1762 — ~1h stalled, then
 * mistaken for a crash). Detect the stall from the pane tail, re-sync
 * credentials from the host, and nudge the session so it retries.
 */
async function healStaleRemoteAuth(agentId: string, vmName: string, details: string[]): Promise<void> {
  try {
    const tail = await getRemoteAgentOutput(agentId, vmName, 40);
    if (!/Invalid authentication credentials|Please run \/login/i.test(tail)) return;
    const config = loadConfigSync();
    const fly = createFlyProviderFromConfig(config.remote);
    const synced = await fly.syncClaudeCredentials(vmName);
    if (!synced) {
      details.push('401 stall detected but credential re-sync failed');
      return;
    }
    await sendToRemoteAgent(agentId, vmName, 'Your API credentials were stale and have been re-synced. Please continue from where you left off.');
    details.push('401 stall detected — re-synced Claude credentials and nudged the session');
  } catch (err: any) {
    details.push(`401 heal attempt failed: ${err.message}`);
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
        // A single has-session over the Machines exec API false-negatives on
        // transient exec failures/429s — one flake here stopped a healthy
        // mid-work machine live (PAN-1762). Any success across retries means
        // alive; only consistent failure proceeds to the crash path.
        for (let attempt = 0; attempt < 3 && !sessionAlive; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 5000));
          sessionAlive = await isRemoteAgentRunning(agentId, vmName);
        }
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
        await healStaleRemoteAuth(agentId, vmName, details);
        results.push({ agentId, issueId, status: 'still-running', details });
        continue;
      }

      // Only the sentinel hands off. A dead session WITHOUT the sentinel is a
      // crash, not a completion — migrated issues always have a pushed branch,
      // so "session ended + branch pushed" would false-positive every crash
      // straight into review (observed live on the first migrated issue).
      // Park as error with forensics; the machine stays (stopped) for
      // inspection and manual recovery via `pan admin remote reap --issue`.
      if (!sentinelSeen || !pushed) {
        const reason = !sentinelSeen
          ? 'session ended without the REMOTE_DONE sentinel — treating as crash, not completion'
          : `sentinel present but ${branch} is not on origin`;
        details.push(reason);
        const { paneCaptured } = await captureRemoteForensics(agentId, vmName, details);
        if (!sessionAlive && paneCaptured) {
          // Contradiction: has-session said dead, but capture-pane just read
          // the live pane through the same tmux server. The session is
          // reachable — the alive check flaked. Do NOT stop the machine.
          details.push('Pane capture succeeded despite dead has-session — alive-check flake, leaving agent running');
          results.push({ agentId, issueId, status: 'still-running', details });
          continue;
        }
        // Salvage before stopping: rootfs does not survive a stop→start
        // cycle, so this is the last chance to preserve unpushed work.
        await salvageRemoteWork(vmName, branch, details);
        try {
          const config = loadConfigSync();
          const fly = createFlyProviderFromConfig(config.remote);
          await Effect.runPromise(fly.stopVm(vmName));
          details.push(`Stopped machine ${vmName} (rootfs resets on next start — salvage above is the durable copy)`);
        } catch (err: any) {
          details.push(`Warning: could not stop machine: ${err.message}`);
        }
        saveRemoteAgentState({ ...remoteState, status: 'error', lastActivity: new Date().toISOString() });
        results.push({ agentId, issueId, status: 'error', details });
        continue;
      }
      details.push(`REMOTE_DONE sentinel present for ${issueId}`);

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

      // 5.5. Preserve the transcript and final pane before the machine goes.
      await captureRemoteForensics(agentId, vmName, details);

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
