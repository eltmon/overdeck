import { exec } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { findProjectByPathSync, type ProjectConfig } from '../../lib/projects.js';
import { ensureStateWorktree, resolveStateHome } from '../../lib/state-home.js';
import { runMutationBatch } from '../../lib/beads/writer.js';
import { resolveCanonicalBeadsHome } from '../../lib/beads/home.js';
import { assertSupportedBdVersion, readInstalledBdVersion } from '../../lib/beads/version.js';

const execAsync = promisify(exec);
async function getBeadsVersion(): Promise<string> {
  const version = await readInstalledBdVersion();
  if (version) return version;
  throw new Error('bd is not installed or did not report a semantic version; workspace beads initialization is blocked.');
}

export async function ensureWorkspaceBeadsRedirect(
  workspacePath: string,
  project: ProjectConfig | null = findProjectByPathSync(workspacePath),
): Promise<string> {
  let expectedTarget = '../../.beads';
  if (project) {
    const stateHome = await resolveStateHome(project);
    if (stateHome.migrated) {
      const status = await ensureStateWorktree(project);
      if (status.status === 'dirty' || status.status === 'error' || status.status === 'legacy') {
        throw new Error(`Cannot repair workspace beads redirect: state worktree ${status.status}`);
      }
      expectedTarget = resolveCanonicalBeadsHome(workspacePath, project) ?? join(stateHome.worktreePath, '.beads');
    }
  }

  const beadsDir = join(workspacePath, '.beads');
  const redirectPath = join(beadsDir, 'redirect');
  let current: string | null = null;
  try {
    current = readFileSync(redirectPath, 'utf8').trim();
  } catch {}
  if (current === expectedTarget) return redirectPath;

  mkdirSync(beadsDir, { recursive: true });
  chmodSync(beadsDir, 0o700);
  const tmp = `${redirectPath}.tmp-${process.pid}`;
  writeFileSync(tmp, expectedTarget, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, redirectPath);
  return redirectPath;
}

/**
 * Initialize beads for a workspace
 *
 * Beads v0.47.1+ uses shared database with labels for isolation (recommended)
 * Older versions use separate .beads directories (legacy workaround)
 */
export async function initializeWorkspaceBeads(workspacePath: string, issueId: string): Promise<{ success: boolean; beadId?: string; error?: string }> {
  try {
    const beadsVersion = await getBeadsVersion();
    assertSupportedBdVersion(beadsVersion);
    {
      // Supported bd versions use the shared canonical database with issue labels.
      // The worktree's .beads/ directory is created from git (only issues.jsonl is committed),
      // so it lacks the redirect file needed to find the main repo's Dolt database.
      // We must create .beads/redirect explicitly — it is gitignored so cannot be inherited.
      await ensureWorkspaceBeadsRedirect(workspacePath);

      // Use bare issueId label (e.g. "pan-419") matching createBeadsFromVBrief and all query sites
      const issueLabel = issueId.toLowerCase();
      const title = `${issueId.toUpperCase()}: Implementation`;

      const batch = await runMutationBatch(
        { project: { workspacePath }, reason: `create implementation bead for ${issueId.toUpperCase()}` },
        (bd) => bd.mutate(['create', '--title', title, '--priority', '1', '--type', 'task', '--labels', issueLabel]),
      );
      if (!batch.ok) return { success: false, error: batch.message };
      const stdout = batch.value;

      // Parse the created bead ID
      const match = stdout.match(/([a-z]+-[a-z0-9]+)/);
      return { success: true, beadId: match?.[1] };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
