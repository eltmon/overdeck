import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { VersionShipOperationError, type VersionShipAllowedRepo } from './version-ship.js';
import { redactVersionShipDiagnostic } from './version-ship-deps.js';

const execFileAsync = promisify(execFile);

export interface VersionShipSourceRepo {
  repoKey: string;
  /** Registered source repository path. */
  repoPath: string;
  /** Path this repository occupies under the project root; `.` for monorepos. */
  configPath: string;
  /** Exact promoted merge commit to root the ship worktree at. */
  mergeSha: string;
  targetBranch: string;
}

export interface PreparedVersionShipWorkspace {
  projectRoot: string;
  allowedRepos: VersionShipAllowedRepo[];
}

function validateConfigPath(path: string): string {
  if (isAbsolute(path)) throw new VersionShipOperationError('workspace-failed', 'registered repository path must be relative');
  const root = '/prepared';
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new VersionShipOperationError('workspace-failed', 'registered repository path escapes the prepared workspace');
  }
  return rel === '' ? '.' : rel;
}

function validateMergeSha(sha: string): void {
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) {
    throw new VersionShipOperationError('workspace-failed', 'promoted merge reference is missing or invalid');
  }
}

async function runGit(args: string[], cwd: string, safeMessage: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    console.error(redactVersionShipDiagnostic(
      `[version-ship] git ${args.join(' ')} failed in ${cwd}: ${error instanceof Error ? error.message : String(error)}`,
    ));
    throw new VersionShipOperationError('workspace-failed', safeMessage);
  }
}

export async function withVersionShipWorkspace<T>(
  repos: readonly VersionShipSourceRepo[],
  run: (workspace: PreparedVersionShipWorkspace) => Promise<T>,
): Promise<T> {
  if (repos.length === 0) {
    throw new VersionShipOperationError('workspace-failed', 'no promoted repository references were recorded for this batch');
  }

  const normalized = repos.map(repo => ({ ...repo, configPath: validateConfigPath(repo.configPath) }));
  const paths = new Set<string>();
  for (const repo of normalized) {
    validateMergeSha(repo.mergeSha);
    if (paths.has(repo.configPath)) {
      throw new VersionShipOperationError('workspace-failed', `duplicate registered repository path: ${repo.configPath}`);
    }
    paths.add(repo.configPath);
  }
  if (normalized.length > 1 && paths.has('.')) {
    throw new VersionShipOperationError('workspace-failed', 'a polyrepo ship workspace cannot map a repository to the project root');
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'overdeck-version-ship-'));
  const wrapperRoot = normalized.length === 1 && normalized[0]!.configPath === '.'
    ? join(tempRoot, 'repo')
    : join(tempRoot, 'project');
  const prepared: Array<{ sourceRoot: string; worktreePath: string }> = [];

  try {
    if (!(normalized.length === 1 && normalized[0]!.configPath === '.')) {
      await mkdir(wrapperRoot, { recursive: true });
    }
    for (const repo of normalized) {
      const sourceRoot = await realpath(repo.repoPath);
      const worktreePath = repo.configPath === '.' ? wrapperRoot : join(wrapperRoot, repo.configPath);
      await mkdir(dirname(worktreePath), { recursive: true });
      await runGit(['fetch', 'origin', repo.targetBranch], sourceRoot, `could not fetch ${repo.targetBranch} before version ship`);
      await runGit(['cat-file', '-e', `${repo.mergeSha}^{commit}`], sourceRoot, 'promoted merge commit is unavailable locally');
      await runGit(['worktree', 'add', '--detach', worktreePath, repo.mergeSha], sourceRoot, 'could not create the version ship worktree');
      prepared.push({ sourceRoot, worktreePath });
    }

    return await run({
      projectRoot: wrapperRoot,
      allowedRepos: normalized.map(repo => ({ path: repo.configPath, targetBranch: repo.targetBranch })),
    });
  } finally {
    for (const repo of [...prepared].reverse()) {
      await execFileAsync('git', ['worktree', 'remove', '--force', repo.worktreePath], {
        cwd: repo.sourceRoot,
        encoding: 'utf-8',
        maxBuffer: 16 * 1024 * 1024,
      }).catch(() => {});
      await execFileAsync('git', ['worktree', 'prune'], {
        cwd: repo.sourceRoot,
        encoding: 'utf-8',
        maxBuffer: 16 * 1024 * 1024,
      }).catch(() => {});
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}
