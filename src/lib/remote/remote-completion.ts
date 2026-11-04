/**
 * Remote Agent Completion Handoff
 *
 * Remote (fly.io) work agents cannot run `pan done` — the host pipeline has
 * no workspace registry entry for them. Instead they finish by pushing their
 * feature branch and creating the `/workspace/.pan/REMOTE_DONE` sentinel
 * file (see the REMOTE gate in cloister/prompts/work.md).
 *
 * `reapCompletedRemoteAgents()` is the host-side half of that contract:
 * for every remote agent that has created the sentinel, it
 *
 *   1. verifies the feature branch exists on origin,
 *   2. materializes the standard local worktree for the branch,
 *   3. copies the remote .pan/continue.json back (best effort),
 *   4. writes a minimal local agent state.json (downstream flows resolve
 *      the workspace through it),
 *   5. creates the review artifact set (same entry the `pan done` flow
 *      uses) and writes the `completed` marker other readers use as "work
 *      agent finished",
 *   6. destroys the fly machine, marks the remote agent state stopped, and
 *      requests review through the guarded review route.
 *
 * A linked work agent (PAN-4734) runs as a conversation on a Fly machine
 * linked to home. Its session is the conversation's tmux session, its repo is
 * its VM worktree (`workdir`), and step 6 destroys the machine, removes its
 * link and forgets its record instead of deleting a legacy VM and its
 * workspace metadata.
 *
 * Invoked every deacon-lite tick and by `pan admin remote reap`.
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { loadConfigSync } from '../config.js';
import { createFlyProviderFromConfig } from './index.js';
import {
  loadRemoteAgentState,
  saveRemoteAgentState,
  listActiveRemoteAgentStates,
  getRemoteAgentOutput,
  sendToRemoteAgent,
  remoteTmuxTarget,
} from './remote-agents.js';
import { resolveProjectFromIssueSync, extractTeamPrefix, findProjectByTeam } from '../projects.js';
import { createWorkspace } from '../workspace-manager.js';
import { workspaceNeedsSetup } from '../workspace-manager/setup-marker.js';
import { PAN_DIRNAME, PAN_CONTINUE_FILENAME } from '../pan-dir/index.js';
import { buildRemoteTmuxCommand, ensureRemoteTmuxContext, runSsh, type RemoteTmuxTarget } from './remote-tmux.js';
import type { FlyProvider } from './fly-provider.js';
import type { VmStatus } from './interface.js';

const execAsync = promisify(exec);
const AGENTS_DIR = join(homedir(), '.overdeck', 'agents');

export interface RemoteReapResult {
  agentId: string;
  issueId: string;
  status: 'handed-off' | 'still-running' | 'indeterminate' | 'stale' | 'error';
  details: string[];
}

/** Running remote agents. `starting` ones are mid-spawn: no tmux session yet, so a probe would read them as crashed. */
function listReapableRemoteAgents(): string[] {
  return listActiveRemoteAgentStates().filter((state) => state.status === 'running').map((state) => state.id);
}

type Probe = 'yes' | 'no' | 'unknown';

/** has-session through the remote tmux server; only a clean exec with a known token is evidence. */
async function probeRemoteSession(fly: FlyProvider, vmName: string, target: RemoteTmuxTarget): Promise<Probe> {
  try {
    await ensureRemoteTmuxContext(fly, vmName);
    const r = await runSsh(fly, vmName,
      `${buildRemoteTmuxCommand(['has-session', '-t', target.session], target.socket)} 2>/dev/null && echo exists || echo not-found`);
    if (r.exitCode !== 0) return 'unknown';
    const out = r.stdout.trim();
    return out === 'exists' ? 'yes' : out === 'not-found' ? 'no' : 'unknown';
  } catch { return 'unknown'; }
}

/** The REMOTE_DONE sentinel; `|| echo absent` keeps the exit code 0 so a failed exec stays distinguishable. */
async function probeDoneSentinel(fly: FlyProvider, vmName: string): Promise<Probe> {
  try {
    const r = await runSsh(fly, vmName, '[ -f /workspace/.pan/REMOTE_DONE ] && echo present || echo absent');
    if (r.exitCode !== 0) return 'unknown';
    const out = r.stdout.trim();
    return out === 'present' ? 'yes' : out === 'absent' ? 'no' : 'unknown';
  } catch { return 'unknown'; }
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
          await Effect.runPromise(fly.copyFromVm(vmName, remotePath, join(destDir, basename(remotePath))));
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
async function salvageRemoteWork(vmName: string, branch: string, details: string[], workdir = '/workspace'): Promise<void> {
  const config = loadConfigSync();
  const fly = createFlyProviderFromConfig(config.remote);
  try {
    const result = await Effect.runPromise(fly.ssh(
      vmName,
      `cd ${workdir} && git add -A && (git diff --cached --quiet || git commit -m "wip(remote): salvage checkpoint before machine stop") && git push origin ${branch} 2>&1 | tail -2`
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
 * Destroy a linked work agent's Fly machine, remove its link and forget its
 * record (PAN-4734 FR-12). A missing record is a machine already gone; a
 * failed destroy keeps the record, and the sweep retries once the agent's
 * state is no longer active.
 */
async function retireLinkedFlyMachine(flyMachineId: string | undefined): Promise<string> {
  const { listFlyMachines } = await import('../anywhere/fly/machine-store.js');
  const record = (await listFlyMachines()).find((r) => r.machineId === flyMachineId);
  if (!record) return `Fly machine ${flyMachineId ?? '(unknown)'} is already gone`;
  const { destroyAndForgetFlyMachine } = await import('./fly-machine-loops.js');
  return (await destroyAndForgetFlyMachine(record, 'work agent handed to review')).line;
}

/**
 * Reap completed remote agents into the review pipeline.
 * Pass issueId to target one agent; otherwise scans all active remote agents.
 */
export async function reapCompletedRemoteAgents(opts: { issueId?: string; dryRun?: boolean } = {}): Promise<RemoteReapResult[]> {
  const agentIds = opts.issueId
    ? [`agent-${opts.issueId.toLowerCase()}`]
    : listReapableRemoteAgents();

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
      // 1. Completion detection from positive evidence only: the machine
      // state Fly reports, the tmux session and the /workspace/.pan/REMOTE_DONE
      // sentinel file (created by the agent per the REMOTE prompt contract).
      // A failed or garbled exec is indeterminate, never "dead" or "absent".
      // Do NOT grep session output for the marker — the prompt's own
      // instruction text contains the literal string, so a mid-work agent's
      // pane matches it (false positive observed live on the first migrated
      // issue).
      const config = loadConfigSync();
      const fly = createFlyProviderFromConfig(config.remote);
      const vmStatus: VmStatus = await Effect.runPromise(fly.getStatus(vmName)).catch(() => 'unknown' as const);
      const machineStopped = vmStatus === 'stopped';
      let session: Probe = 'no';
      let sentinel: Probe = 'no';
      if (machineStopped) {
        details.push(`Fly reports ${vmName} stopped — treating as crash, not completion`);
      } else if (vmStatus !== 'running') {
        details.push(`Fly reports machine state '${vmStatus}' for ${vmName} — indeterminate, no action taken`);
        results.push({ agentId, issueId, status: 'indeterminate', details });
        continue;
      } else {
        // A single has-session over the Machines exec API false-negatives on
        // transient exec failures/429s — one flake here stopped a healthy
        // mid-work machine live (PAN-1762). Retry only while the probe has
        // no answer; a clean "not-found" is evidence and is not retried.
        const target = remoteTmuxTarget(agentId);
        session = await probeRemoteSession(fly, vmName, target);
        for (let attempt = 1; attempt < 3 && session === 'unknown'; attempt++) {
          await new Promise((r) => setTimeout(r, 5000));
          session = await probeRemoteSession(fly, vmName, target);
        }
        sentinel = await probeDoneSentinel(fly, vmName);
        if (sentinel === 'unknown' || (sentinel === 'no' && session === 'unknown')) {
          details.push(`Indeterminate probe (tmux session: ${session}, REMOTE_DONE sentinel: ${sentinel}) — no action taken`);
          results.push({ agentId, issueId, status: 'indeterminate', details });
          continue;
        }
      }

      const teamPrefix = extractTeamPrefix(issueId);
      const projectConfig = teamPrefix ? findProjectByTeam(teamPrefix) : null;
      const resolved = resolveProjectFromIssueSync(issueId, []);
      const projectRoot = projectConfig?.path ?? resolved?.projectPath;
      if (!projectRoot) {
        throw new Error(`Cannot resolve project for ${issueId}`);
      }

      const branch = `feature/${issueId.toLowerCase()}`;
      const pushed = await branchExistsOnOrigin(projectRoot, branch);

      if (session === 'yes' && sentinel === 'no') {
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
      if (sentinel !== 'yes' || !pushed) {
        if (!machineStopped) {
          details.push(sentinel !== 'yes'
            ? 'session ended without the REMOTE_DONE sentinel — treating as crash, not completion'
            : `sentinel present but ${branch} is not on origin`);
        }
        const { paneCaptured } = await captureRemoteForensics(agentId, vmName, details);
        // No exec can succeed on a stopped machine, so the guard only applies to a running one.
        if (!machineStopped && session !== 'yes' && paneCaptured) {
          // Contradiction: has-session said dead, but capture-pane just read
          // the live pane through the same tmux server. The session is
          // reachable — the alive check flaked. Do NOT stop the machine.
          details.push('Pane capture succeeded despite dead has-session — alive-check flake, leaving agent running');
          results.push({ agentId, issueId, status: 'still-running', details });
          continue;
        }
        // Salvage before stopping: rootfs does not survive a stop→start
        // cycle, so this is the last chance to preserve unpushed work.
        await salvageRemoteWork(vmName, branch, details, remoteState.workdir);
        try {
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
      const worktreeExisted = existsSync(workspacePath);
      // PAN-4171: an existing worktree whose setup never finished goes back
      // through createWorkspace, which resumes the setup.
      if (workspaceNeedsSetup(workspacePath)) {
        if (!projectConfig) throw new Error(`No project config for ${issueId}; cannot create workspace`);
        const wsResult = await createWorkspace({
          projectConfig,
          featureName: issueId.toLowerCase(),
          startDocker: false,
        });
        if (!wsResult.success) {
          throw new Error(`Failed to create local worktree: ${wsResult.errors.join('; ')}`);
        }
        details.push(worktreeExisted
          ? `Finished the setup of local worktree at ${workspacePath}`
          : `Materialized local worktree at ${workspacePath}`);
      }
      if (worktreeExisted) {
        // Worktree exists (e.g. migrated issue with --keep) — fast-forward it.
        await execAsync(`git fetch origin ${branch}`, { cwd: workspacePath });
        await execAsync(`git merge --ff-only origin/${branch}`, { cwd: workspacePath }).catch(() => {
          details.push('Local worktree diverged from origin — left as-is');
        });
      }

      // 3. Copy continue.json back from the VM (best effort — session record).
      // A linked agent keeps it in its worktree's .overdeck/ (PAN-4734 FR-12).
      const [remoteContinue, localContinue] = remoteState.workdir
        ? [`${remoteState.workdir}/.overdeck/${PAN_CONTINUE_FILENAME}`, join(workspacePath, '.overdeck', PAN_CONTINUE_FILENAME)]
        : [`/workspace/${PAN_DIRNAME}/${PAN_CONTINUE_FILENAME}`, join(workspacePath, PAN_DIRNAME, PAN_CONTINUE_FILENAME)];
      try {
        const config = loadConfigSync();
        const fly = createFlyProviderFromConfig(config.remote);
        mkdirSync(dirname(localContinue), { recursive: true });
        await Effect.runPromise(fly.copyFromVm(vmName, remoteContinue, localContinue));
        details.push('Copied continue.json back from VM');
      } catch {
        details.push('No continue.json retrieved from VM (skipped)');
      }

      // 4. Minimal local agent state so downstream flows resolve the workspace.
      const { getAgentState, saveAgentStateSync } = await import('../agents.js');
      const existing = getAgentState(agentId);
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

      // 5. Review artifacts (same entry pan done uses) + the completed marker
      // other readers use as "work agent finished".
      const { createReviewArtifactsForIssue } = await import('../review-artifacts.js');
      const artifactResult = await createReviewArtifactsForIssue(issueId, workspacePath);
      const primaryArtifact = artifactResult.mergeSet?.repos.find((repo) => !!repo.artifactUrl);
      if (primaryArtifact?.artifactUrl) {
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
      details.push('Wrote completion marker');

      // 5.5. Preserve the transcript and final pane before the machine goes.
      await captureRemoteForensics(agentId, vmName, details);

      // 6. Retire the remote workspace entirely: from review onward the
      // pipeline runs against the local worktree, and lingering remote
      // metadata makes getWorkspaceInfoForIssue() route review operations
      // at the (now-idle) VM. Destroying the machine also closes the
      // run-forever cost leak.
      try {
        if (session === 'yes') {
          const { killRemoteAgent } = await import('./remote-agents.js');
          await killRemoteAgent(agentId, vmName).catch(() => undefined);
        }
        if (remoteState.linked === true) {
          details.push(await retireLinkedFlyMachine(remoteState.flyMachineId));
        } else {
          await Effect.runPromise(fly.deleteVm(vmName));
          details.push(`Destroyed machine ${vmName}`);
        }
      } catch (err: any) {
        details.push(`Warning: could not destroy machine: ${err.message}`);
      }
      // A linked agent has no legacy workspace metadata (pan start --remote refuses one).
      if (remoteState.linked !== true) {
        const { deleteWorkspaceMetadata } = await import('./workspace-metadata.js');
        deleteWorkspaceMetadata(issueId);
        details.push('Removed remote workspace metadata (pipeline is local from here)');
      }
      saveRemoteAgentState({ ...remoteState, status: 'stopped', lastActivity: new Date().toISOString() });

      // Post-Cut, review starts from POST /api/review/:id/request (what pan done
      // calls). Must run after deleteWorkspaceMetadata: while the metadata exists
      // the route still sees a remote workspace and answers 409.
      const { requestReviewThroughRoute } = await import('../cloister/review-request-route.js');
      const review = await requestReviewThroughRoute(issueId, {
        message: `Remote agent finished on ${vmName}; reaped into the local worktree`,
        source: 'remote-reap',
      });
      details.push(review.requested
        ? 'Requested review through the dashboard review route'
        : `Review not requested (${review.reason}): run pan review request ${issueId}`);

      results.push({ agentId, issueId, status: 'handed-off', details });
    } catch (err: any) {
      details.push(err.message);
      results.push({ agentId, issueId, status: 'error', details });
    }
  }

  return results;
}
