import { isHarnessNativeTarget } from '../context-layers/native-instructions.js';
import { chmodSync, existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, statSync, renameSync, rmSync, rmdirSync, realpathSync } from 'fs';
import { join, dirname, extname, relative, resolve } from 'path';
import { homedir } from 'os';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { TemplatePlaceholders, replacePlaceholders } from '../workspace-config.js';
import { PRE_WORKTREE_METADATA_DIRS } from './types.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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

const PRE_REBASE_HOOK_MARKER = '# OVERDECK MANAGED PRE-REBASE GUARD';
const PRE_REBASE_ORIGINAL_SUFFIX = '.overdeck-original';
const PRE_REBASE_HOOK_PREFIX = [
  '#!/bin/sh',
  PRE_REBASE_HOOK_MARKER,
  'if [ "$OVERDECK_PAN_GIT_OP" != "1" ] && [ -n "$OVERDECK_AGENT_ID" ]; then',
  '  echo "Overdeck agents must not run git rebase directly." >&2',
  '  echo "Use pan sync-main <ISSUE-ID> to sync main or pan done <ISSUE-ID> to submit." >&2',
  '  exit 1',
  'fi',
  '',
].join('\n');

/**
 * Keep a generated hooks directory that lives inside the worktree out of
 * `git status`. With husky, `core.hooksPath` is `.husky/_` — a tracked-repo
 * path husky self-ignores by writing a `*` .gitignore into it on install.
 * `installPreRebaseHook` creates that directory itself in a fresh worktree,
 * long before `prepare: husky` ever runs, so without this the generated guard
 * lands as `?? .husky/_/pre-rebase` and every new workspace is born dirty —
 * which 409s the planning→work auto-handoff (PAN-3266).
 *
 * Directories under `.git/` need nothing: git never reports them.
 */
function ensureGeneratedHooksDirIsIgnored(targetPath: string, hooksDir: string): void {
  const relativeDir = relative(targetPath, hooksDir).replace(/\\/g, '/');
  if (!relativeDir || relativeDir.startsWith('..') || relativeDir === '.git' || relativeDir.startsWith('.git/')) {
    return;
  }
  const ignorePath = join(hooksDir, '.gitignore');
  if (existsSync(ignorePath)) return;
  try {
    writeFileSync(ignorePath, '*\n', 'utf-8');
  } catch {
    // Non-fatal: a dirty status is recoverable, a failed worktree create is not.
  }
}

/** Install the agent-only rebase guard in Git's configured hooks directory. */
export async function installPreRebaseHook(targetPath: string): Promise<string> {
  const { stdout } = await execAsync('git rev-parse --git-path hooks', {
    cwd: targetPath,
    encoding: 'utf-8',
  });
  const hooksDir = resolve(targetPath, stdout.trim());
  const hookPath = join(hooksDir, 'pre-rebase');

  mkdirSync(hooksDir, { recursive: true });
  ensureGeneratedHooksDirIsIgnored(targetPath, hooksDir);
  const originalHookPath = `${hookPath}${PRE_REBASE_ORIGINAL_SUFFIX}`;
  const existingHook = existsSync(hookPath) ? readFileSync(hookPath, 'utf-8') : '';
  if (!existingHook.includes(PRE_REBASE_HOOK_MARKER)) {
    if (existingHook) {
      rmSync(originalHookPath, { force: true });
      renameSync(hookPath, originalHookPath);
    }
    const hook = [
      PRE_REBASE_HOOK_PREFIX,
      `if [ -x "\${0}${PRE_REBASE_ORIGINAL_SUFFIX}" ]; then`,
      `  exec "\${0}${PRE_REBASE_ORIGINAL_SUFFIX}" "$@"`,
      'fi',
      'exit 0',
      '',
    ].join('\n');
    writeFileSync(hookPath, hook, { encoding: 'utf-8', mode: 0o755 });
  }
  chmodSync(hookPath, 0o755);
  return hookPath;
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
    // PAN-3847 (FR-15): fetch the target so the new branch is cut from
    // origin/<default>, not a possibly-stale local ref. Offline falls back to
    // the local ref with a warning naming the risk.
    // CWE-78 residual: validate the config-supplied branch BEFORE any git call —
    // a refspec payload ('+refs/heads/a:refs/heads/b') passes argv safely but
    // would still make git update a local ref.
    const { assertValidBranchName } = await import('../git-utils.js');
    try {
      await assertValidBranchName(defaultBranch, 'createWorktree defaultBranch');
    } catch (invalid) {
      return { success: false, message: invalid instanceof Error ? invalid.message : String(invalid) };
    }
    let baseRef = `origin/${defaultBranch}`;
    try {
      // CWE-78: defaultBranch comes from per-repo/workspace config — pass it as
      // an argv element, never interpolated into a shell string.
      await execFileAsync('git', ['fetch', 'origin', '--', defaultBranch], { cwd: repoPath });
    } catch (fetchErr) {
      console.warn(`[worktree] git fetch origin ${defaultBranch} failed; cutting ${branchName} from LOCAL ${defaultBranch} — it may be stale or ahead of origin: ${fetchErr instanceof Error ? fetchErr.message : fetchErr}`);
      baseRef = defaultBranch;
    }

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

    // CWE-78: path, branch, and base ref all travel as argv elements — a config-
    // or operator-supplied value must never reach a shell.
    if (branchExists) {
      await execFileAsync('git', ['worktree', 'add', targetPath, branchName], { cwd: repoPath });
    } else {
      // Create new branch from the fetched origin ref of the default branch
      await execFileAsync('git', ['worktree', 'add', '-b', branchName, targetPath, baseRef], { cwd: repoPath });
    }

    await installPreRebaseHook(targetPath);

    // Clear unstaged deletions from the new worktree (e.g. .planning/ files that exist on the
    // feature branch but not on main appear as deleted in a fresh worktree). Without this,
    // `git rebase origin/main` fails immediately with "unstaged changes" (PAN-495).
    await execAsync('git restore .', { cwd: targetPath }).catch(() => {});

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
    // CWE-78: path and branch travel as argv elements — double quotes stop a
    // semicolon but never a $(...) substitution or a quote break-out.
    await execFileAsync('git', ['worktree', 'remove', targetPath, '--force'], { cwd: repoPath }).catch(() => {});

    // Optionally delete the branch
    await execFileAsync('git', ['branch', '-D', branchName], { cwd: repoPath }).catch(() => {});

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

export function stagePreWorktreeMetadata(workspacePath: string): string | null {
  if (!existsSync(workspacePath)) return null;
  if (!isPreWorktreeMetadataOnlyDir(workspacePath)) return null;

  const stagedPath = `${workspacePath}.pre-worktree-${process.pid}-${Date.now()}`;
  renameSync(workspacePath, stagedPath);
  return stagedPath;
}

function mergeDirectoryWithoutOverwriteSync(source: string, target: string): void {
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

export function restorePreWorktreeMetadata(stagedPath: string | null, workspacePath: string): void {
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

    if (!existsSync(sourcePath) || isHarnessNativeTarget(dir)) continue;

    // Recursively copy all files, applying placeholder substitution to text files
    function copyDir(src: string, dest: string): number {
      let count = 0;
      mkdirSync(dest, { recursive: true });
      const entries = readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcEntry = join(src, entry.name);
        const destEntry = join(dest, entry.name);
        if (isHarnessNativeTarget(relative(targetDir, destEntry))) continue;
        if (entry.isDirectory()) {
          count += copyDir(srcEntry, destEntry);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (placeholders && TEXT_EXTENSIONS.has(ext)) {
            const content = readFileSync(srcEntry, 'utf-8');
            writeFileSync(destEntry, replacePlaceholders(content, placeholders));
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
export async function preTrustDirectory(dirPath: string): Promise<void> {
  const claudeJsonPath = join(homedir(), '.claude.json');
  if (!existsSync(claudeJsonPath)) return;
  if (isTrustCached(claudeJsonPath, dirPath)) return;

  const lockDir = `${claudeJsonPath}.lock`;
  for (let attempt = 0; !tryAcquireClaudeJsonLock(lockDir); attempt++) {
    const delay = CLAUDE_JSON_LOCK_BACKOFF_MS[attempt];
    if (delay === undefined) {
      throw new Error(`${lockDir} is held by another process; ${dirPath} was not pre-trusted`);
    }
    await new Promise<void>(resolveSleep => setTimeout(resolveSleep, delay));
  }
  // Everything under the lock is synchronous, so two calls in one process
  // cannot interleave here either.
  try {
    writeTrustUnderLock(claudeJsonPath, dirPath);
  } finally {
    releaseClaudeJsonLock(lockDir);
  }
}

/**
 * Claude Code's lock on ~/.claude.json, as its bundled proper-lockfile takes
 * it (2.1.x: `lock(configPath, { lockfilePath: `${configPath}.lock` })`): a
 * directory made with mkdir, stale once its mtime is 10 s old; a live holder
 * refreshes it every 5 s. Claude Code re-reads the file under the lock and
 * applies only its own change. A writer that takes the same lock and does the
 * same loses nobody's update, and nobody loses its update (PAN-3905).
 */
const CLAUDE_JSON_LOCK_STALE_MS = 10_000;
/** About 3 s in total: Claude Code holds the lock for one file write. */
const CLAUDE_JSON_LOCK_BACKOFF_MS = [50, 100, 200, 400, 800, 1600] as const;

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function mkdirLock(lockDir: string): boolean {
  try {
    mkdirSync(lockDir);
    return true;
  } catch (error) {
    if (errorCode(error) === 'EEXIST') return false;
    throw error;
  }
}

function tryAcquireClaudeJsonLock(lockDir: string): boolean {
  if (mkdirLock(lockDir)) return true;
  let lockMtimeMs: number;
  try {
    lockMtimeMs = statSync(lockDir).mtimeMs;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return mkdirLock(lockDir);
    throw error;
  }
  if (lockMtimeMs >= Date.now() - CLAUDE_JSON_LOCK_STALE_MS) return false;
  // Stale: its holder died without releasing it. Break it, as proper-lockfile does.
  try {
    rmdirSync(lockDir);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
  return mkdirLock(lockDir);
}

function releaseClaudeJsonLock(lockDir: string): void {
  try {
    rmdirSync(lockDir);
  } catch {
    // Already gone. A lock left behind goes stale after 10 s.
  }
}

interface ClaudeJsonTrust {
  readonly bypassPermissionsModeAccepted?: unknown;
  readonly projects?: Record<string, { readonly hasTrustDialogAccepted?: unknown } | null>;
}

/**
 * What the last read of ~/.claude.json said, keyed on the file's mtime and
 * size. The file can be megabytes, so a launch whose cwd is already trusted
 * costs one stat, not a parse.
 */
let trustCache: {
  readonly path: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly bypassAccepted: boolean;
  readonly trusted: ReadonlySet<string>;
} | null = null;

function isTrustCached(claudeJsonPath: string, dirPath: string): boolean {
  if (!trustCache || trustCache.path !== claudeJsonPath) return false;
  const stats = statSync(claudeJsonPath);
  return stats.mtimeMs === trustCache.mtimeMs
    && stats.size === trustCache.size
    && trustCache.bypassAccepted
    && trustCache.trusted.has(dirPath);
}

function rememberTrust(claudeJsonPath: string, data: ClaudeJsonTrust): void {
  const stats = statSync(claudeJsonPath);
  const trusted = new Set<string>();
  for (const [path, project] of Object.entries(data.projects ?? {})) {
    if (project?.hasTrustDialogAccepted === true) trusted.add(path);
  }
  trustCache = {
    path: claudeJsonPath,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    bypassAccepted: data.bypassPermissionsModeAccepted === true,
    trusted,
  };
}

/** Read-modify-write of ~/.claude.json. Call it only while holding the lock. */
function writeTrustUnderLock(claudeJsonPath: string, dirPath: string): void {
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
    // PAN-3905: every Claude Code session on the machine reads this file, and
    // spawns now call this too. Write a sibling temp file and rename it over
    // the real one (resolved through a symlink, keeping its mode), so no
    // reader ever sees a half-written file. A failed write or rename removes
    // the temp file, which is a full copy of the config.
    const target = realpathSync(claudeJsonPath);
    const tmpPath = `${target}.tmp-${process.pid}`;
    try {
      writeFileSync(tmpPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: statSync(target).mode & 0o777 });
      renameSync(tmpPath, target);
    } catch (error) {
      rmSync(tmpPath, { force: true });
      throw error;
    }
  }
  rememberTrust(claudeJsonPath, data);
}
