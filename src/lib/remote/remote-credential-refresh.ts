/**
 * Remote Claude Credential Refresh
 *
 * Host OAuth refresh rotates refresh tokens, so a long-running Fly VM keeps an
 * orphaned copy and stalls on 401 once it expires. The hygiene scheduler calls
 * `refreshClaudeCredentialsForActiveRemoteAgents()` every 60 s (PAN-4295) to
 * copy fresh host credentials to every active remote agent's VM.
 *
 * Restored from PAN-1778 after PAN-3917 dropped its patrol and PAN-4014
 * deleted it as dead code. PAN-4652 (FR-15): Fly machines (linked VMs running
 * `pan serve`) are refreshed the same way, by machine name.
 */

import { existsSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { listFlyMachines } from '../anywhere/fly/machine-store.js';
import { loadConfigSync } from '../config.js';
import { createFlyProviderFromConfig } from './index.js';
import { listActiveRemoteAgentStates } from './remote-agents.js';

const REMOTE_CLAUDE_CREDENTIAL_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

interface PerVmCredentialRefreshState {
  fingerprint: string | null;
  refreshedAtMs: number;
}

const perVmCredentialRefreshState = new Map<string, PerVmCredentialRefreshState>();

interface RemoteClaudeCredentialRefreshDeps {
  listActiveRemoteAgentStates?: typeof listActiveRemoteAgentStates;
  nowMs?: () => number;
  credentialFingerprint?: () => string | null;
  loadConfig?: typeof loadConfigSync;
  createFlyProvider?: typeof createFlyProviderFromConfig;
  listFlyMachineNames?: () => Promise<string[]>;
}

async function listFlyMachineNames(): Promise<string[]> {
  return (await listFlyMachines()).map((record) => record.machineName);
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

/** Test seam: no production caller; tests use it to reset the per-VM watermarks (PAN-3958 CH-8). */
export function resetRemoteClaudeCredentialRefreshForTests(): void {
  perVmCredentialRefreshState.clear();
}

/**
 * Proactively copy fresh host Claude credentials to active remote agents and
 * Fly machines.
 *
 * Host OAuth refresh rotates refresh tokens, so a long-running Fly VM can be
 * left with an orphaned copy. The host credentials file mtime is the precise
 * trigger on Linux; platforms without that file fall back to a bounded 15 min
 * refresh cadence. The active-agent and Fly machine scans run first so the
 * common zero-remote case never constructs a Fly provider or makes Fly API calls.
 *
 * Refresh state is tracked per VM (keyed by vmName), not globally. A failed
 * or newly started VM must be retried on the next patrol regardless of whether
 * another VM already succeeded this cycle.
 */
export async function refreshClaudeCredentialsForActiveRemoteAgents(
  deps: RemoteClaudeCredentialRefreshDeps = {},
): Promise<string[]> {
  const actions: string[] = [];
  const activeStates = (deps.listActiveRemoteAgentStates ?? listActiveRemoteAgentStates)();
  let flyMachineNames: string[] = [];
  try {
    flyMachineNames = await (deps.listFlyMachineNames ?? listFlyMachineNames)();
  } catch (err) {
    // A corrupt fly-machines.json must not stop the refresh for remote agents.
    actions.push(`Fly machine credentials refresh skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
  const targets = [
    // A linked work agent's VM is a Fly machine and is listed below (PAN-4734 FR-10).
    ...activeStates
      .filter((state) => state.linked !== true)
      .map((state) => ({ vmName: state.vmName, who: state.issueId.toUpperCase() })),
    ...flyMachineNames.map((vmName) => ({ vmName, who: 'Fly machine' })),
  ];
  const activeVmNames = new Set(targets.map((target) => target.vmName));

  // Drop state for VMs that are no longer active so a future machine reusing
  // the same vmName starts with a clean watermark. Do this before the empty
  // short-circuit so the Map is pruned even when no agents are currently active.
  for (const vmName of perVmCredentialRefreshState.keys()) {
    if (!activeVmNames.has(vmName)) {
      perVmCredentialRefreshState.delete(vmName);
    }
  }

  if (targets.length === 0) return actions;

  const nowMs = (deps.nowMs ?? Date.now)();
  const currentFingerprint = (deps.credentialFingerprint ?? getHostClaudeCredentialFingerprint)();
  const config = (deps.loadConfig ?? loadConfigSync)();
  const fly = (deps.createFlyProvider ?? createFlyProviderFromConfig)(config.remote, 'ephemeral');

  for (const state of targets) {
    const last = perVmCredentialRefreshState.get(state.vmName);
    const credentialChanged = currentFingerprint !== null && currentFingerprint !== last?.fingerprint;
    const refreshDue = !last ||
      nowMs - last.refreshedAtMs >= REMOTE_CLAUDE_CREDENTIAL_REFRESH_INTERVAL_MS;
    if (!credentialChanged && !refreshDue) continue;

    try {
      const synced = await fly.syncClaudeCredentials(state.vmName);
      if (synced) {
        // Only advance this VM's watermark on a successful sync. A failure
        // leaves its last watermark intact so the next patrol retries it.
        perVmCredentialRefreshState.set(state.vmName, {
          fingerprint: currentFingerprint,
          refreshedAtMs: nowMs,
        });
      }
      actions.push(
        synced
          ? `Remote credentials refreshed for ${state.who} on ${state.vmName}`
          : `Remote credentials refresh skipped for ${state.who} on ${state.vmName} (no host credentials)`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      actions.push(`Remote credentials refresh failed for ${state.who} on ${state.vmName}: ${reason}`);
    }
  }

  return actions;
}
