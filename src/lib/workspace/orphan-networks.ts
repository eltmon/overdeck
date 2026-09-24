/**
 * Orphaned workspace Docker networks (PAN-3900).
 *
 * A workspace stack's bridge network outlives the stack whenever the worktree
 * is removed out of band or compose down cannot remove it. Each one holds a
 * slot of Docker's ~31-network bridge pool until `docker network create`
 * refuses and no workspace stack can start.
 *
 * A network is reported as an Overdeck-owned orphan only when ALL of these
 * hold, so a network that is not ours is never touched:
 *   1. it carries a compose project label and its name is `<label>_<network>`
 *      (exactly `<label>_<compose network label>` when that label is set);
 *   2. the compose project is a workspace stack name, `<prefix>-feature-<issue>`
 *      (optionally `-slot-<n>`), and the issue prefix maps to a registered
 *      Overdeck project;
 *   3. no container, running or stopped, is attached to it;
 *   4. the workspace directory `feature-<issue>[-slot-<n>]` does not exist
 *      and no active agent is registered for the issue.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { getDefaultWorkspaceConfig } from '../workspace-config.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';

const execFileAsync = promisify(execFile);

export interface DockerNetworkRow {
  name: string;
  composeProject: string;
  composeNetwork: string;
}

export interface OrphanedWorkspaceNetwork {
  name: string;
  composeProject: string;
  /** Issue id in canonical upper case, e.g. `PAN-3894`. */
  issueId: string;
  /** Workspace directory the network belonged to; confirmed absent. */
  workspacePath: string;
}

export interface OrphanNetworkDeps {
  /** Containers attached to the network, running or stopped. */
  countAttachedContainers: (network: string) => Promise<number>;
  /** Every directory the issue's workspace could live under, or [] if no registered project owns the issue. */
  workspacesDirsForIssue: (issueId: string) => string[];
  pathExists: (path: string) => boolean;
  activeIssueIds: Set<string>;
}

/** `overdeck-feature-pan-3894`, `myn-feature-min-888-slot-3`, `feature-pan-1`. */
const WORKSPACE_COMPOSE_PROJECT_RE = /^(?:[a-z0-9][a-z0-9_-]*-)?feature-([a-z]+-\d+)((?:-slot-\d+)?)$/;

/** Parses `docker network ls` rows formatted as `name\tproject\tnetwork`. */
export function parseNetworkRows(stdout: string): DockerNetworkRow[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = '', composeProject = '', composeNetwork = ''] = line.split('\t');
      return { name: name.trim(), composeProject: composeProject.trim(), composeNetwork: composeNetwork.trim() };
    });
}

/**
 * Checks 1 and 2 only (name and label shape). Returns the issue id and the
 * workspace folder name, or null when the network is not a workspace stack
 * network by Overdeck's naming.
 */
export function workspaceNetworkIdentity(row: DockerNetworkRow): { issueId: string; featureFolder: string } | null {
  if (!row.composeProject) return null;
  // Compose names a project's network `<project>_<network>`. When the network
  // label is present the name must match it exactly; without it, the name
  // must still carry the project label as its prefix.
  const expectedPrefix = `${row.composeProject}_`;
  if (!row.name.startsWith(expectedPrefix) || row.name.length === expectedPrefix.length) return null;
  if (row.composeNetwork && row.name !== `${expectedPrefix}${row.composeNetwork}`) return null;
  const match = row.composeProject.match(WORKSPACE_COMPOSE_PROJECT_RE);
  if (!match) return null;
  const issueLower = match[1];
  return { issueId: issueLower.toUpperCase(), featureFolder: `feature-${issueLower}${match[2]}` };
}

export async function selectOrphanedWorkspaceNetworks(
  rows: DockerNetworkRow[],
  deps: OrphanNetworkDeps,
): Promise<OrphanedWorkspaceNetwork[]> {
  const orphans: OrphanedWorkspaceNetwork[] = [];
  for (const row of rows) {
    const identity = workspaceNetworkIdentity(row);
    if (!identity) continue;
    if (deps.activeIssueIds.has(identity.issueId)) continue;

    const dirs = deps.workspacesDirsForIssue(identity.issueId);
    if (dirs.length === 0) continue; // no registered project owns this issue prefix
    const candidates = dirs.map((dir) => join(dir, identity.featureFolder));
    if (candidates.some((path) => deps.pathExists(path))) continue;

    let attached: number;
    try {
      attached = await deps.countAttachedContainers(row.name);
    } catch {
      continue; // cannot prove it is unattached: leave it
    }
    if (attached !== 0) continue;

    orphans.push({
      name: row.name,
      composeProject: row.composeProject,
      issueId: identity.issueId,
      workspacePath: candidates[0],
    });
  }
  return orphans.sort((a, b) => a.name.localeCompare(b.name));
}

/** Workspace directories a registered project would place this issue's workspace in. */
export function workspacesDirsForIssue(issueId: string): string[] {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return [];
  const config = getProjectSync(resolved.projectKey);
  // Same derivation as removeWorkspace / createWorkspace.
  const workspacesDir = (config?.workspace || getDefaultWorkspaceConfig()).workspaces_dir || 'workspaces';
  const roots = new Set([resolved.projectPath, config?.path].filter((p): p is string => Boolean(p)));
  return [...roots].map((root) => join(root, workspacesDir));
}

export async function listDockerNetworkRows(): Promise<DockerNetworkRow[]> {
  const { stdout } = await execFileAsync(
    'docker',
    [
      'network', 'ls', '--filter', 'driver=bridge', '--format',
      '{{.Name}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.network"}}',
    ],
    { encoding: 'utf-8', timeout: 30000 },
  );
  return parseNetworkRows(String(stdout));
}

export async function countAttachedContainers(network: string): Promise<number> {
  const { stdout } = await execFileAsync(
    'docker',
    ['ps', '-a', '--filter', `network=${network}`, '--format', '{{.ID}}'],
    { encoding: 'utf-8', timeout: 30000 },
  );
  return String(stdout).split('\n').filter((line) => line.trim()).length;
}

/** Discover orphaned Overdeck workspace networks. Read-only. */
export async function findOrphanedWorkspaceNetworks(activeIssueIds: Set<string>): Promise<OrphanedWorkspaceNetwork[]> {
  const rows = await listDockerNetworkRows();
  return selectOrphanedWorkspaceNetworks(rows, {
    countAttachedContainers,
    workspacesDirsForIssue,
    pathExists: existsSync,
    activeIssueIds,
  });
}

/**
 * Remove one orphan, re-checking attachment immediately before the removal so
 * a stack that started in the meantime keeps its network.
 */
export async function removeOrphanedWorkspaceNetwork(network: OrphanedWorkspaceNetwork): Promise<void> {
  if ((await countAttachedContainers(network.name)) !== 0) {
    throw new Error(`${network.name} gained attached containers; left in place`);
  }
  await execFileAsync('docker', ['network', 'rm', network.name], { encoding: 'utf-8', timeout: 30000 });
}
