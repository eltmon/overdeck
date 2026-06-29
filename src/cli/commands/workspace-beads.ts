import { exec } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'fs';
import { join, resolve } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);
const REDIRECT_MANAGED_BEADS_VERSION = 1 * 10000 + 0 * 100 + 4;

function encodeBeadsVersion(version: string): number {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return 0;
  const [, major, minor, patch] = match.map(Number);
  return major * 10000 + minor * 100 + patch;
}

/**
 * Check beads version to determine which approach to use
 * Returns version as a sortable semver number (e.g., v1.0.4 = 10004) or 0 if not installed
 */
async function getBeadsVersion(): Promise<number> {
  try {
    const { stdout } = await execAsync('bd --version', { encoding: 'utf-8' });
    return encodeBeadsVersion(stdout);
  } catch {}
  return 0;
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

    if (beadsVersion >= REDIRECT_MANAGED_BEADS_VERSION) {
      // v1.0.4+ - Use shared database with issue label for scoping
      // The worktree's .beads/ directory is created from git (only issues.jsonl is committed),
      // so it lacks the redirect file needed to find the main repo's Dolt database.
      // We must create .beads/redirect explicitly — it is gitignored so cannot be inherited.
      const beadsDir = join(workspacePath, '.beads');
      const redirectPath = join(beadsDir, 'redirect');
      if (!existsSync(redirectPath)) {
        // Walk up from workspacePath to find the main repo's .beads/ directory
        // Worktrees live at <projectRoot>/workspaces/feature-<id>/ — two levels up
        const projectRoot = resolve(workspacePath, '..', '..');
        const mainBeadsDir = join(projectRoot, '.beads');
        if (existsSync(mainBeadsDir)) {
          mkdirSync(beadsDir, { recursive: true });
          chmodSync(beadsDir, 0o700);
          // Write relative path from workspace .beads/ to main .beads/
          writeFileSync(redirectPath, '../../.beads', 'utf-8');
        }
      }

      // Use bare issueId label (e.g. "pan-419") matching createBeadsFromVBrief and all query sites
      const issueLabel = issueId.toLowerCase();
      const title = `${issueId.toUpperCase()}: Implementation`;

      const { stdout } = await execAsync(
        `bd create --title "${title}" --priority 1 --type task --labels "${issueLabel}" 2>&1`,
        { cwd: workspacePath, encoding: 'utf-8' }
      );

      // Parse the created bead ID
      const match = stdout.match(/([a-z]+-[a-z0-9]+)/);
      return { success: true, beadId: match?.[1] };
    } else {
      // Legacy approach for older beads versions (< 1.0.4)
      // Remove inherited .beads directory and initialize fresh
      const beadsDir = join(workspacePath, '.beads');
      if (existsSync(beadsDir)) {
        rmSync(beadsDir, { recursive: true, force: true });
      }

      const prefix = 'workspace';
      await execAsync(`bd init --prefix ${prefix}`, { cwd: workspacePath, encoding: 'utf-8' });
      await execAsync('git config beads.role contributor', { cwd: workspacePath }).catch(() => {});
      // Disable beads' auto-export git-add to prevent "git add failed" warnings in worktrees
      await execAsync('bd config set export.git-add false', { cwd: workspacePath, encoding: 'utf-8' }).catch(() => {});

      const title = `${issueId.toUpperCase()}: Implementation`;
      const { stdout } = await execAsync(
        `bd create --title "${title}" --priority 1 --type task --json`,
        { cwd: workspacePath, encoding: 'utf-8' }
      );

      try {
        const result = JSON.parse(stdout);
        return { success: true, beadId: result.id };
      } catch {
        const match = stdout.match(/([a-z]+-[a-z0-9]+)/);
        return { success: true, beadId: match?.[1] };
      }
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export const __testInternals = {
  encodeBeadsVersion,
  REDIRECT_MANAGED_BEADS_VERSION,
};
