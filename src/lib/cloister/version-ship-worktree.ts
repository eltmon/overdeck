import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { VersionShipOperationError, type VersionShipAllowedRepo } from './version-ship.js';
import { redactVersionShipDiagnostic } from './version-ship-deps.js';
import {
  runVersionShipGit,
  VERSION_SHIP_GIT_CLEANUP_TIMEOUT_MS,
  VERSION_SHIP_GIT_LOCAL_TIMEOUT_MS,
  VERSION_SHIP_GIT_NETWORK_TIMEOUT_MS,
} from './version-ship-git.js';

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

async function runGit(
  args: string[],
  cwd: string,
  safeMessage: string,
  timeoutMs = VERSION_SHIP_GIT_LOCAL_TIMEOUT_MS,
): Promise<string> {
  const result = await runVersionShipGit(args, cwd, timeoutMs);
  if (result.exitCode === 0) return result.stdout.trim();
  console.error(redactVersionShipDiagnostic(
    `[version-ship] git ${args.join(' ')} failed in ${cwd}${result.timedOut ? ' after timeout' : ''}: ${result.stderr || result.stdout}`,
  ));
  throw new VersionShipOperationError('workspace-failed', safeMessage);
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
  const prepared: Array<{
    sourceRoot: string;
    worktreePath: string;
    configPath: string;
    expectedHead: string;
    expectedGitDir: string;
  }> = [];

  try {
    if (!(normalized.length === 1 && normalized[0]!.configPath === '.')) {
      await mkdir(wrapperRoot, { recursive: true });
    }
    for (const repo of normalized) {
      const sourceRoot = await realpath(repo.repoPath);
      const worktreePath = repo.configPath === '.' ? wrapperRoot : join(wrapperRoot, repo.configPath);
      await mkdir(dirname(worktreePath), { recursive: true });
      await runGit(['check-ref-format', '--branch', repo.targetBranch], sourceRoot, 'configured target branch is invalid');
      await runGit(
        ['fetch', 'origin', repo.targetBranch],
        sourceRoot,
        `could not fetch ${repo.targetBranch} before version ship`,
        VERSION_SHIP_GIT_NETWORK_TIMEOUT_MS,
      );
      await runGit(['cat-file', '-e', `${repo.mergeSha}^{commit}`], sourceRoot, 'promoted merge commit is unavailable locally');
      const targetRef = `refs/remotes/origin/${repo.targetBranch}`;
      await runGit(
        ['merge-base', '--is-ancestor', repo.mergeSha, targetRef],
        sourceRoot,
        `promoted merge commit is not an ancestor of ${repo.targetBranch}`,
      );
      const targetHead = await runGit(['rev-parse', targetRef], sourceRoot, `could not resolve ${repo.targetBranch} before version ship`);
      await runGit(['worktree', 'add', '--detach', worktreePath, targetHead], sourceRoot, 'could not create the version ship worktree');
      const expectedHead = await runGit(['rev-parse', 'HEAD'], worktreePath, 'could not verify the version ship worktree head');
      const expectedGitDir = await realpath(await runGit(
        ['rev-parse', '--absolute-git-dir'],
        worktreePath,
        'could not verify the version ship worktree metadata',
      ));
      prepared.push({ sourceRoot, worktreePath, configPath: repo.configPath, expectedHead, expectedGitDir });
    }

    return await run({
      projectRoot: wrapperRoot,
      allowedRepos: normalized.map(repo => {
        const identity = prepared.find(candidate => candidate.configPath === repo.configPath)!;
        return {
          path: repo.configPath,
          targetBranch: repo.targetBranch,
          expectedHead: identity.expectedHead,
          expectedGitDir: identity.expectedGitDir,
        };
      }),
    });
  } finally {
    for (const repo of [...prepared].reverse()) {
      await runVersionShipGit(
        ['worktree', 'remove', '--force', repo.worktreePath],
        repo.sourceRoot,
        VERSION_SHIP_GIT_CLEANUP_TIMEOUT_MS,
      ).catch(() => null);
      await runVersionShipGit(
        ['worktree', 'prune'],
        repo.sourceRoot,
        VERSION_SHIP_GIT_CLEANUP_TIMEOUT_MS,
      ).catch(() => null);
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}
