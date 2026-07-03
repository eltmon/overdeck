import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, symlinkSync, statSync, renameSync, rmSync } from 'fs';
import { join, dirname, extname, relative } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TemplatePlaceholders, replacePlaceholdersSync } from '../workspace-config.js';
import { PRE_WORKTREE_METADATA_DIRS } from './types.js';

const execAsync = promisify(exec);

/**
 * Validate feature name (alphanumeric and hyphens only)
 */
export function validateFeatureName(name: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(name);
}

/**
 * Make a `cp -a`-copied Python venv self-contained by pointing its scripts at
 * the destination venv's OWN interpreter.
 *
 * Python venvs are not relocatable: every bin/* console script carries an
 * absolute `#!<source venv>/bin/python3` shebang, and the activate scripts set
 * `VIRTUAL_ENV=<source venv>`. Copying a venv to a new path leaves those
 * pointing at the old location — a repo rename (e.g. panopticon-cli → overdeck)
 * then breaks every copied script with "bad interpreter: No such file". The
 * TLDR MCP server silently fails to spawn and the read-enforcer hook silently
 * no-ops, so every agent pays full token cost on Reads with nothing erroring.
 *
 * Rewrites each bin/* shebang and the activate `VIRTUAL_ENV` to the destination
 * venv's own path. Best-effort and non-fatal: unreadable/binary files skipped.
 */
export function relocateVenvScripts(sourceVenv: string, destVenv: string): void {
  const sourceBin = join(sourceVenv, 'bin');
  const destBin = join(destVenv, 'bin');
  const destPy = join(destBin, 'python3');
  if (!existsSync(destBin) || !existsSync(destPy)) return;
  for (const entry of readdirSync(destBin)) {
    const script = join(destBin, entry);
    try {
      if (!statSync(script).isFile()) continue;
      const content = readFileSync(script, 'utf8');
      const firstLine = content.split('\n', 1)[0] ?? '';
      if (firstLine.startsWith('#!') && firstLine.includes(sourceBin)) {
        const restFrom = content.indexOf('\n');
        writeFileSync(script, `#!${destPy}${restFrom === -1 ? '\n' : content.slice(restFrom)}`);
      }
    } catch {
      // Non-fatal: skip unreadable or binary files.
    }
  }
  for (const name of ['activate', 'activate.csh', 'activate.fish']) {
    const act = join(destBin, name);
    if (!existsSync(act)) continue;
    try {
      const content = readFileSync(act, 'utf8');
      if (content.includes(sourceVenv)) {
        writeFileSync(act, content.split(sourceVenv).join(destVenv));
      }
    } catch {
      // Non-fatal.
    }
  }
}

/**
 * Create a git worktree
 * @param repoPath Path to the source git repository
 * @param targetPath Where to create the worktree
 * @param branchName Name of the feature branch to create/checkout
 * @param defaultBranch Base branch to create new branches from (default: 'main')
 */
export async function createWorktree(
  repoPath: string,
  targetPath: string,
  branchName: string,
  defaultBranch: string = 'main'
): Promise<{ success: boolean; message: string }> {
  try {
    // Fetch latest from origin
    await execAsync('git fetch origin', { cwd: repoPath });

    // Prune stale worktree entries (e.g., from deleted workspaces)
    await execAsync('git worktree prune', { cwd: repoPath });

    // Check if branch exists locally or remotely (exact match, not substring)
    const { stdout: localBranches } = await execAsync('git branch --list', { cwd: repoPath });
    const { stdout: remoteBranches } = await execAsync('git branch -r --list', { cwd: repoPath });

    const localList = localBranches.split('\n').map(b => b.replace(/^[*+\s]+/, '').trim()).filter(Boolean);
    const remoteList = remoteBranches.split('\n').map(b => b.trim()).filter(Boolean);
    const branchExists =
      localList.includes(branchName) ||
      remoteList.includes(`origin/${branchName}`);

    if (branchExists) {
      await execAsync(`git worktree add "${targetPath}" "${branchName}"`, { cwd: repoPath });
    } else {
      // Create new branch from the configured default branch
      await execAsync(`git worktree add "${targetPath}" -b "${branchName}" "${defaultBranch}"`, { cwd: repoPath });
    }

    // Clear unstaged deletions from the new worktree (e.g. .planning/ files that exist on the
    // feature branch but not on main appear as deleted in a fresh worktree). Without this,
    // `git rebase origin/main` fails immediately with "unstaged changes" (PAN-495).
    await execAsync('git restore .', { cwd: targetPath }).catch(() => {});

    // Configure beads role so agents don't get "beads.role not configured" warnings
    await execAsync('git config beads.role contributor', { cwd: targetPath }).catch(() => {});

    // Point the worktree's .beads/ at the source repo's shared Dolt database via a redirect file.
    // Without this, `bd` in the worktree spins up its own empty database with no issue_prefix
    // configured, so the first `bd create` errors with "database not initialized: issue_prefix
    // config is missing". The redirect keeps all worktrees reading/writing the canonical beads
    // store alongside main. Mirrors the pattern in src/lib/vbrief/beads.ts.
    const sourceBeadsDir = join(repoPath, '.beads');
    if (existsSync(sourceBeadsDir)) {
      const worktreeBeadsDir = join(targetPath, '.beads');
      const redirectPath = join(worktreeBeadsDir, 'redirect');
      if (!existsSync(redirectPath)) {
        try {
          mkdirSync(worktreeBeadsDir, { recursive: true });
          // bd resolves the redirect path relative to the worktree root (the parent of .beads/)
          const relPath = relative(targetPath, sourceBeadsDir);
          writeFileSync(redirectPath, relPath, 'utf-8');
        } catch {
          // Non-fatal — if redirect creation fails, bd falls back to its usual bootstrap path.
        }
      }
    }

    return { success: true, message: `Created worktree at ${targetPath}` };
  } catch (error) {
    return { success: false, message: `Failed to create worktree: ${error}` };
  }
}

/**
 * Remove a git worktree
 */
export async function removeWorktree(
  repoPath: string,
  targetPath: string,
  branchName: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Remove worktree
    await execAsync(`git worktree remove "${targetPath}" --force`, { cwd: repoPath }).catch(() => {});

    // Optionally delete the branch
    await execAsync(`git branch -D "${branchName}"`, { cwd: repoPath }).catch(() => {});

    return { success: true, message: `Removed worktree at ${targetPath}` };
  } catch (error) {
    return { success: false, message: `Failed to remove worktree: ${error}` };
  }
}

/**
 * Assign a port from a range
 */
export function assignPort(
  portFile: string,
  featureFolder: string,
  range: [number, number]
): number {
  // Ensure port file exists
  if (!existsSync(portFile)) {
    mkdirSync(dirname(portFile), { recursive: true });
    writeFileSync(portFile, '');
  }

  const content = readFileSync(portFile, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  // Check if already assigned
  for (const line of lines) {
    const [folder, port] = line.split(':');
    if (folder === featureFolder) {
      return parseInt(port, 10);
    }
  }

  // Find next available port
  const usedPorts = new Set(lines.map(l => parseInt(l.split(':')[1], 10)));
  for (let port = range[0]; port <= range[1]; port++) {
    if (!usedPorts.has(port)) {
      writeFileSync(portFile, content + (content.endsWith('\n') ? '' : '\n') + `${featureFolder}:${port}\n`);
      return port;
    }
  }

  throw new Error(`No available ports in range ${range[0]}-${range[1]}`);
}

/**
 * Release a port assignment
 */
export function releasePort(portFile: string, featureFolder: string): boolean {
  try {
    if (!existsSync(portFile)) return true;

    let content = readFileSync(portFile, 'utf-8');
    const lines = content.split('\n').filter(line => !line.startsWith(`${featureFolder}:`));
    writeFileSync(portFile, lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

/**
 * @deprecated Use copyProjectTemplateDirs instead. Kept for non-.claude paths.
 */
export function createSymlinks(
  sourceDir: string,
  targetDir: string,
  symlinks: string[]
): string[] {
  const steps: string[] = [];

  for (const symlink of symlinks) {
    const sourcePath = join(sourceDir, symlink);
    const targetPath = join(targetDir, symlink);

    if (existsSync(sourcePath)) {
      mkdirSync(dirname(targetPath), { recursive: true });
      try {
        symlinkSync(sourcePath, targetPath);
        steps.push(`Created symlink: ${symlink}`);
      } catch {
        // Symlink might already exist
      }
    }
  }

  return steps;
}

/**
 * Copy project template directories into workspace (replaces symlinks).
 * Recursively copies all files from each source directory.
 */
export const TEXT_EXTENSIONS = new Set([
  '.md', '.sh', '.yml', '.yaml', '.json', '.ts', '.js', '.env', '.txt', '.toml', '.template',
]);

export function isPreWorktreeMetadataOnlyDir(path: string): boolean {
  const entries = readdirSync(path, { withFileTypes: true });
  return entries.every((entry) =>
    PRE_WORKTREE_METADATA_DIRS.has(entry.name) && entry.isDirectory()
  );
}

export function stagePreWorktreeMetadataSync(workspacePath: string): string | null {
  if (!existsSync(workspacePath)) return null;
  if (!isPreWorktreeMetadataOnlyDir(workspacePath)) return null;

  const stagedPath = `${workspacePath}.pre-worktree-${process.pid}-${Date.now()}`;
  renameSync(workspacePath, stagedPath);
  return stagedPath;
}

export function mergeDirectoryWithoutOverwriteSync(source: string, target: string): void {
  if (!existsSync(source)) return;
  mkdirSync(target, { recursive: true });

  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);

    if (entry.isDirectory()) {
      mergeDirectoryWithoutOverwriteSync(sourcePath, targetPath);
    } else if (entry.isFile() && !existsSync(targetPath)) {
      copyFileSync(sourcePath, targetPath);
    }
  }
}

export function restorePreWorktreeMetadataSync(stagedPath: string | null, workspacePath: string): void {
  if (!stagedPath || !existsSync(stagedPath)) return;
  mergeDirectoryWithoutOverwriteSync(stagedPath, workspacePath);
  rmSync(stagedPath, { recursive: true, force: true });
}

export function copyProjectTemplateDirs(
  sourceDir: string,
  targetDir: string,
  dirs: string[],
  placeholders?: TemplatePlaceholders
): string[] {
  const steps: string[] = [];

  for (const dir of dirs) {
    const sourcePath = join(sourceDir, dir);
    const targetPath = join(targetDir, dir);

    if (!existsSync(sourcePath)) continue;

    // Recursively copy all files, applying placeholder substitution to text files
    function copyDir(src: string, dest: string): number {
      let count = 0;
      mkdirSync(dest, { recursive: true });
      const entries = readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcEntry = join(src, entry.name);
        const destEntry = join(dest, entry.name);
        if (entry.isDirectory()) {
          count += copyDir(srcEntry, destEntry);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (placeholders && TEXT_EXTENSIONS.has(ext)) {
            const content = readFileSync(srcEntry, 'utf-8');
            writeFileSync(destEntry, replacePlaceholdersSync(content, placeholders));
          } else {
            copyFileSync(srcEntry, destEntry);
          }
          count++;
        }
      }
      return count;
    }

    const count = copyDir(sourcePath, targetPath);
    steps.push(`Copied ${count} files from project template: ${dir}`);
  }

  return steps;
}

/**
 * Pre-register a directory as trusted in Claude Code's ~/.claude.json so that
 * neither the per-project "Quick safety check" trust prompt nor the global
 * "WARNING: Claude Code running in Bypass Permissions mode" warning blocks
 * spawn.
 *
 * Two acceptances are written:
 *
 * 1. **Per-project** `projects[dir].hasTrustDialogAccepted = true` — suppresses
 *    the "Is this a project you created or one you trust?" prompt for this cwd.
 *
 * 2. **Global** `bypassPermissionsModeAccepted = true` — suppresses the
 *    "Bypass Permissions mode" disclaimer that Claude shows on first launch
 *    under `--dangerously-skip-permissions`. The default selection on that
 *    prompt is "No, exit", so an undismissed dialog tears the session down
 *    the moment any code (dev-channels dismisser, readiness poll) sends Enter.
 *    Spawning under Overdeck implies the user already opted into bypass
 *    via `claude.permissionMode` / `--yolo`, so this is a pre-acknowledgement
 *    of a choice already made, not a silent escalation.
 *
 * The field name (`bypassPermissionsModeAccepted`) comes straight from the
 * Claude Code binary — strings(claude.exe) confirms it as the persistence
 * key checked by both the bypass-mode dialog and the headless --bg gate.
 */
export function preTrustDirectorySync(dirPath: string): void {
  const claudeJsonPath = join(homedir(), '.claude.json');
  if (!existsSync(claudeJsonPath)) return;

  const data = JSON.parse(readFileSync(claudeJsonPath, 'utf8'));
  let dirty = false;

  if (data.bypassPermissionsModeAccepted !== true) {
    data.bypassPermissionsModeAccepted = true;
    dirty = true;
  }

  if (!data.projects) data.projects = {};

  if (data.projects[dirPath]) {
    if (!data.projects[dirPath].hasTrustDialogAccepted) {
      data.projects[dirPath].hasTrustDialogAccepted = true;
      dirty = true;
    }
  } else {
    data.projects[dirPath] = {
      allowedTools: [],
      mcpContextUris: [],
      mcpServers: {},
      enabledMcpjsonServers: [],
      disabledMcpjsonServers: [],
      hasTrustDialogAccepted: true,
      projectOnboardingSeenCount: 0,
      hasClaudeMdExternalIncludesApproved: false,
      hasClaudeMdExternalIncludesWarningShown: false,
    };
    dirty = true;
  }

  if (dirty) {
    writeFileSync(claudeJsonPath, JSON.stringify(data, null, 2), 'utf8');
  }
}
