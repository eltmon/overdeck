import chalk from 'chalk';
import { exec, spawn } from 'child_process';
import { constants, promises as fs } from 'fs';
import { homedir } from 'os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface GitResult {
  stdout: string;
  stderr: string;
}

export interface BuildFromOriginDeps {
  readonly runGit: (args: string[], cwd: string) => Promise<GitResult>;
  readonly installAndBuild: (cwd: string) => Promise<void>;
  readonly swapArtifacts: (repoRoot: string, buildWorktree: string) => Promise<void>;
  readonly removePath: (path: string) => Promise<void>;
  readonly note: (message: string) => void;
  readonly success: (message: string) => void;
  readonly processId: number;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function runGitAsync(args: string[], cwd: string): Promise<GitResult> {
  return execAsync(`git ${args.map(shellQuote).join(' ')}`, {
    cwd,
    encoding: 'utf8',
  });
}

function runCommand(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
      cwd,
    });
    child.once('error', reject);
    child.once('close', (code) => resolvePromise(code ?? 1));
  });
}

/**
 * Install dependencies before building. A merge/rebase that adds a runtime dep
 * (e.g. chokidar from PAN-1395) leaves node_modules behind package.json: the
 * build still succeeds (the bundler externalizes the dep) but the freshly built
 * server boot-crashes with ERR_MODULE_NOT_FOUND, taking the dashboard down.
 * `bun install` is idempotent and ~instant on a warm cache, so running it
 * unconditionally before every reload makes "apply my merged changes" safe.
 */
async function resolveBunBinary(cwd: string): Promise<string> {
  const pathDirectories = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => isAbsolute(directory) ? directory : resolve(cwd, directory));

  for (const directory of pathDirectories) {
    const candidate = join(directory, 'bun');
    try {
      await fs.access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep searching the inherited PATH.
    }
  }

  const fallback = join(process.env.HOME || homedir(), '.bun', 'bin', 'bun');
  try {
    await fs.access(fallback, constants.X_OK);
    return fallback;
  } catch {
    throw new Error(`bun executable not found in PATH or at ${fallback}`);
  }
}

async function runBunInstall(cwd: string): Promise<number> {
  const bunBinary = await resolveBunBinary(cwd);
  return runCommand(bunBinary, ['install'], cwd);
}

function runBuild(cwd: string): Promise<number> {
  return runCommand('npm', ['run', 'build'], cwd);
}

async function runInstallAndBuild(cwd: string): Promise<void> {
  const installExit = await runBunInstall(cwd);
  if (installExit !== 0) {
    throw new Error(`bun install failed in ${cwd} — old dashboard left running`);
  }

  const exitCode = await runBuild(cwd);
  if (exitCode !== 0) {
    throw new Error(`Build failed in ${cwd} — old dashboard left running`);
  }
}

async function renameIfPresent(from: string, to: string): Promise<boolean> {
  try {
    await fs.rename(from, to);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function swapBuiltArtifacts(repoRoot: string, buildWorktree: string): Promise<void> {
  const incomingDist = join(repoRoot, 'dist.incoming');
  const currentDist = join(repoRoot, 'dist');
  const oldDist = join(repoRoot, `dist.old.${process.pid}`);
  const incomingModules = join(repoRoot, 'node_modules.incoming');
  const currentModules = join(repoRoot, 'node_modules');
  const oldModules = join(repoRoot, `node_modules.old.${process.pid}`);

  await fs.rm(incomingDist, { recursive: true, force: true });
  await fs.rm(incomingModules, { recursive: true, force: true });
  await fs.rm(oldDist, { recursive: true, force: true });
  await fs.rm(oldModules, { recursive: true, force: true });
  await fs.cp(join(buildWorktree, 'dist'), incomingDist, { recursive: true });
  await fs.rename(join(buildWorktree, 'node_modules'), incomingModules);

  let movedOldDist = false;
  let movedOldModules = false;
  let installedDist = false;
  let installedModules = false;
  try {
    movedOldDist = await renameIfPresent(currentDist, oldDist);
    movedOldModules = await renameIfPresent(currentModules, oldModules);
    await fs.rename(incomingDist, currentDist);
    installedDist = true;
    await fs.rename(incomingModules, currentModules);
    installedModules = true;
  } catch (error) {
    if (installedDist) await fs.rm(currentDist, { recursive: true, force: true }).catch(() => undefined);
    if (installedModules) await fs.rm(currentModules, { recursive: true, force: true }).catch(() => undefined);
    if (movedOldDist) await fs.rename(oldDist, currentDist).catch(() => undefined);
    if (movedOldModules) await fs.rename(oldModules, currentModules).catch(() => undefined);
    throw error;
  }

  await fs.rm(oldDist, { recursive: true, force: true });
  await fs.rm(oldModules, { recursive: true, force: true });
}

const defaultDependencies: BuildFromOriginDeps = {
  runGit: runGitAsync,
  installAndBuild: runInstallAndBuild,
  swapArtifacts: swapBuiltArtifacts,
  removePath: (path) => fs.rm(path, { recursive: true, force: true }),
  note: (message) => console.warn(chalk.yellow(message)),
  success: (message) => console.log(chalk.green(message)),
  processId: process.pid,
};

export async function buildDashboardFromOriginMain(
  repoRoot: string,
  dependencies: Partial<BuildFromOriginDeps> = {},
): Promise<void> {
  const deps = { ...defaultDependencies, ...dependencies };
  await deps.runGit(['fetch', 'origin', 'main'], repoRoot);

  const status = (await deps.runGit(['status', '--porcelain'], repoRoot)).stdout.trim();
  if (status) {
    deps.note('Primary worktree has uncommitted changes; they are excluded from this deploy.');
  }

  const headSha = (await deps.runGit(['rev-parse', 'HEAD'], repoRoot)).stdout.trim();
  const originMainSha = (await deps.runGit(['rev-parse', 'origin/main'], repoRoot)).stdout.trim();
  if (headSha !== originMainSha) {
    deps.note('Primary worktree HEAD differs from origin/main; only origin/main is being deployed.');
  }

  const buildWorktree = join(dirname(repoRoot), `.pan-reload-build-${deps.processId}`);
  await deps.removePath(buildWorktree);
  await deps.runGit(['worktree', 'prune'], repoRoot);

  try {
    await deps.runGit(['worktree', 'add', '--detach', buildWorktree, 'origin/main'], repoRoot);
    await deps.installAndBuild(buildWorktree);
    await deps.swapArtifacts(repoRoot, buildWorktree);
    deps.success(`✓ Built dashboard from origin/main ${originMainSha.slice(0, 12)}`);
  } finally {
    await deps.runGit(['worktree', 'remove', '--force', buildWorktree], repoRoot).catch(() => undefined);
    await deps.removePath(buildWorktree).catch(() => undefined);
    await deps.removePath(join(repoRoot, 'dist.incoming')).catch(() => undefined);
    await deps.removePath(join(repoRoot, 'node_modules.incoming')).catch(() => undefined);
  }
}
