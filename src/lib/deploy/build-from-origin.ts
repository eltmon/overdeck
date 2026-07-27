import chalk from 'chalk';
import { exec, spawn } from 'child_process';
import { constants, promises as fs } from 'fs';
import { homedir } from 'os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'path';
import { promisify } from 'util';

import { getOverdeckHome } from '../paths.js';

const execAsync = promisify(exec);

interface GitResult {
  stdout: string;
  stderr: string;
}

export interface DashboardDeployment {
  readonly deployRoot: string;
  readonly serverPath: string;
}

export interface DashboardDeploymentActivation {
  readonly commit: () => Promise<void>;
  readonly rollback: () => Promise<void>;
}

export interface BuildFromOriginDeps {
  readonly runGit: (args: string[], cwd: string) => Promise<GitResult>;
  readonly installAndBuild: (cwd: string) => Promise<void>;
  readonly removePath: (path: string) => Promise<void>;
  readonly ensureParent: (path: string) => Promise<void>;
  readonly deploymentRoot: (repoRoot: string, processId: number) => string;
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

export async function activateDashboardDeployment(
  repoRoot: string,
  deployment: DashboardDeployment,
): Promise<DashboardDeploymentActivation> {
  const incomingDist = join(repoRoot, 'dist.incoming');
  const currentDist = join(repoRoot, 'dist');
  const rollbackDist = join(repoRoot, `dist.rollback.${process.pid}`);

  await fs.rm(incomingDist, { recursive: true, force: true });
  await fs.rm(rollbackDist, { recursive: true, force: true });
  await fs.cp(join(deployment.deployRoot, 'dist'), incomingDist, { recursive: true });
  await fs.symlink(join(deployment.deployRoot, 'node_modules'), join(incomingDist, 'node_modules'), 'dir');

  const movedCurrentDist = await renameIfPresent(currentDist, rollbackDist);
  try {
    await fs.rename(incomingDist, currentDist);
  } catch (error) {
    if (movedCurrentDist) await fs.rename(rollbackDist, currentDist).catch(() => undefined);
    throw error;
  }

  let settled = false;
  return {
    commit: async () => {
      if (settled) return;
      settled = true;
      await fs.rm(rollbackDist, { recursive: true, force: true }).catch(() => undefined);
    },
    rollback: async () => {
      if (settled) return;
      settled = true;
      await fs.rm(currentDist, { recursive: true, force: true }).catch(() => undefined);
      if (movedCurrentDist) await fs.rename(rollbackDist, currentDist).catch(() => undefined);
      await fs.rm(incomingDist, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

export function dashboardDeploymentRoots(): readonly [string, string] {
  const baseDir = join(getOverdeckHome(), 'deployments', 'dashboard');
  return [
    join(baseDir, '.pan-reload-generation-a'),
    join(baseDir, '.pan-reload-generation-b'),
  ];
}

export function selectDashboardDeploymentRoot(activeRoot?: string | null): string {
  const [first, second] = dashboardDeploymentRoots();
  return activeRoot && resolve(activeRoot) === resolve(first) ? second : first;
}

const defaultDependencies: BuildFromOriginDeps = {
  runGit: runGitAsync,
  installAndBuild: runInstallAndBuild,
  removePath: (path) => fs.rm(path, { recursive: true, force: true }),
  ensureParent: async (path) => { await fs.mkdir(dirname(path), { recursive: true }); },
  deploymentRoot: () => selectDashboardDeploymentRoot(),
  note: (message) => console.warn(chalk.yellow(message)),
  success: (message) => console.log(chalk.green(message)),
  processId: process.pid,
};

export async function removeDashboardDeployment(
  repoRoot: string,
  deployRoot: string,
  dependencies: Partial<Pick<BuildFromOriginDeps, 'runGit' | 'removePath'>> = {},
): Promise<void> {
  const runGit = dependencies.runGit ?? defaultDependencies.runGit;
  const removePath = dependencies.removePath ?? defaultDependencies.removePath;
  await runGit(['worktree', 'remove', '--force', deployRoot], repoRoot).catch(() => undefined);
  await removePath(deployRoot).catch(() => undefined);
  await runGit(['worktree', 'prune'], repoRoot).catch(() => undefined);
}

export async function sweepDashboardDeployments(
  repoRoot: string,
  keepRoots: readonly string[],
  dependencies: Partial<Pick<BuildFromOriginDeps, 'runGit' | 'removePath'>> = {},
): Promise<void> {
  const baseDir = join(getOverdeckHome(), 'deployments', 'dashboard');
  const keep = new Set(keepRoots.map((path) => resolve(path)));
  let entries: string[];
  try {
    entries = await fs.readdir(baseDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.startsWith('.pan-reload-build-') && !entry.startsWith('.pan-reload-generation-')) continue;
    const deployRoot = join(baseDir, entry);
    if (keep.has(resolve(deployRoot))) continue;
    await removeDashboardDeployment(repoRoot, deployRoot, dependencies);
  }
}

export async function buildDashboardFromOriginMain(
  repoRoot: string,
  dependencies: Partial<BuildFromOriginDeps> = {},
): Promise<DashboardDeployment> {
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

  const deployRoot = deps.deploymentRoot(repoRoot, deps.processId);
  await deps.removePath(deployRoot);
  await deps.runGit(['worktree', 'prune'], repoRoot);
  await deps.ensureParent(deployRoot);

  let completed = false;
  try {
    await deps.runGit(['worktree', 'add', '--detach', deployRoot, 'origin/main'], repoRoot);
    await deps.installAndBuild(deployRoot);
    const deployment = {
      deployRoot,
      serverPath: join(deployRoot, 'dist', 'dashboard', 'server.js'),
    };
    completed = true;
    deps.success(`✓ Built dashboard from origin/main ${originMainSha.slice(0, 12)}`);
    return deployment;
  } finally {
    if (!completed) {
      await removeDashboardDeployment(repoRoot, deployRoot, deps);
    }
  }
}
