/**
 * `pan skills pack sageox commit` (PAN-4852 WI-19): open one PR that adds the
 * project's stored SageOx binding as `.sageox/`, then record
 * `sageox_binding: committed` (AD-22).
 *
 * The commit is made in a throwaway worktree under `<packdir>/tmp/` on branch
 * `overdeck/sageox-link`, so no project checkout changes. Files are staged with
 * `git add -f`: a primary-checkout `info/exclude` block hides `.sageox/` in
 * every worktree of the repo (H2). The flag is written only after the PR
 * exists, so a failed run records nothing. Re-running reuses the remote branch
 * and the open PR.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { getForgeAdapter, type CreateReviewArtifactInput, type CreateReviewArtifactResult, type ForgeType } from '../forge.js';
import { getRepoForge, resolveDefaultBranchForRepo } from '../project-repos.js';
import { getProjectSync } from '../projects.js';
import { packCacheDir } from '../skill-packs/sources.js';
import { bindingDir, defaultBranchTracksSageox, readBinding } from './binding.js';
import { setSageoxBindingCommitted } from './config.js';

export interface CommitDeps {
  run: (cmd: string, args: string[], opts: { cwd: string; timeout: number }) => Promise<{ stdout: string }>;
  createArtifact: (forge: ForgeType, input: CreateReviewArtifactInput) => Promise<CreateReviewArtifactResult>;
  setCommitted: (projectKey: string) => Promise<{ changed: boolean }>;
}

export type CommitResult =
  | { status: 'already-committed'; branch: string }
  | { status: 'opened'; url: string; created: boolean };

export class SageoxCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SageoxCommitError';
  }
}

export const SAGEOX_LINK_BRANCH = 'overdeck/sageox-link';
const COMMIT_MESSAGE = 'chore(sageox): add the SageOx link files';
const PR_TITLE = 'Add the SageOx link files (.sageox/)';
const PR_BODY =
  'Adds the SageOx link files created by `ox init` in host-managed mode (no AGENTS.md/CLAUDE.md markers, no hooks). ' +
  'After this merges, Overdeck uses the committed .sageox/ instead of placing a copy in each worktree.';
const GIT_TIMEOUT_MS = 120_000;

const execFileAsync = promisify(execFile);

/** promisified execFile; stdin is closed at once so git never waits on a prompt. */
const execFileRunner: CommitDeps['run'] = async (cmd, args, opts) => {
  const pending = execFileAsync(cmd, args, { ...opts, maxBuffer: 16 * 1024 * 1024 });
  pending.child.stdin?.end();
  const { stdout } = await pending;
  return { stdout };
};

const defaultCreateArtifact: CommitDeps['createArtifact'] = (forge, input) =>
  getForgeAdapter(forge).createReviewArtifact(input);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `owner/repo` (or `group/sub/repo`) from an `origin` URL in https, ssh or
 * scp form; undefined for anything else, such as a local path, so the forge
 * CLI falls back to the worktree's own remote.
 */
export function parseOriginRepository(url: string): string | undefined {
  const trimmed = url.trim();
  const path = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i.exec(trimmed)?.[1] ?? /^[^/:@]+@[^/:]+:(.+)$/.exec(trimmed)?.[1];
  if (!path) return undefined;
  const repository = path.replace(/\/+$/, '').replace(/\.git$/, '');
  return /^[\w.-]+(\/[\w.-]+)+$/.test(repository) ? repository : undefined;
}

/** Deletes a throwaway directory only when it resolves inside `<packdir>/tmp/` (NFR-3). */
async function removeTmpDir(tmpRoot: string, dir: string): Promise<void> {
  const rel = relative(tmpRoot, resolve(dir));
  if (!rel || rel.startsWith('..') || rel.includes(sep)) return;
  await rm(dir, { recursive: true, force: true });
}

export async function commitSageoxBinding(projectKey: string, deps?: Partial<CommitDeps>): Promise<CommitResult> {
  const run = deps?.run ?? execFileRunner;
  const createArtifact = deps?.createArtifact ?? defaultCreateArtifact;
  const setCommitted = deps?.setCommitted ?? setSageoxBindingCommitted;
  const git = (cwd: string, args: string[]) => run('git', ['-C', cwd, ...args], { cwd, timeout: GIT_TIMEOUT_MS });

  const project = getProjectSync(projectKey);
  if (!project?.path) throw new SageoxCommitError(`unknown project: ${projectKey}`);
  const root = project.path;
  const defaultBranch = resolveDefaultBranchForRepo(root, projectKey);

  const binding = await readBinding(projectKey);
  if (!binding) {
    throw new SageoxCommitError(
      `project ${projectKey} has no SageOx link; run pan skills pack sageox link --project ${projectKey}`,
    );
  }

  try {
    await git(root, ['fetch', '--quiet', 'origin', defaultBranch]);
  } catch (error) {
    throw new SageoxCommitError(`git fetch origin ${defaultBranch} failed: ${errorMessage(error).split('\n')[0]}`);
  }
  if (await defaultBranchTracksSageox(root, defaultBranch)) {
    await setCommitted(projectKey);
    return { status: 'already-committed', branch: defaultBranch };
  }

  // Re-run: build on the branch a previous run pushed, so the push fast-forwards.
  let start = `origin/${defaultBranch}`;
  try {
    await git(root, ['fetch', '--quiet', 'origin', SAGEOX_LINK_BRANCH]);
    await git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${SAGEOX_LINK_BRANCH}`]);
    start = `origin/${SAGEOX_LINK_BRANCH}`;
  } catch {
    // No remote branch yet: start from the default branch.
  }

  const tmpRoot = join(packCacheDir('sageox'), 'tmp');
  await mkdir(tmpRoot, { recursive: true });
  const tmp = join(tmpRoot, `commit-${projectKey}-${randomBytes(4).toString('hex')}`);

  let worktreeAdded = false;
  try {
    try {
      await git(root, ['worktree', 'prune']);
      await git(root, ['worktree', 'add', '--quiet', '-B', SAGEOX_LINK_BRANCH, tmp, start]);
      worktreeAdded = true;
    } catch (error) {
      throw new SageoxCommitError(`git worktree add failed: ${errorMessage(error).split('\n')[0]}`);
    }

    const source = bindingDir(projectKey);
    for (const file of binding.files) {
      const target = join(tmp, '.sageox', file);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(source, file), target);
    }
    await git(tmp, ['add', '-f', '--', ...binding.files.map(file => `.sageox/${file}`)]);

    let staged = true;
    try {
      await git(tmp, ['diff', '--cached', '--quiet']);
      staged = false;
    } catch {
      // Exit 1: the index differs from HEAD, so there is something to commit.
    }
    try {
      if (staged) await git(tmp, ['commit', '--quiet', '-m', COMMIT_MESSAGE]);
      await git(tmp, ['push', '--quiet', 'origin', `HEAD:refs/heads/${SAGEOX_LINK_BRANCH}`]);
    } catch (error) {
      throw new SageoxCommitError(`git ${staged ? 'commit or push' : 'push'} failed: ${errorMessage(error).split('\n')[0]}`);
    }

    let repository: string | undefined;
    try {
      repository = parseOriginRepository((await git(root, ['remote', 'get-url', 'origin'])).stdout);
    } catch {
      repository = undefined;
    }
    const repo = project.workspace?.repos?.find(entry => resolve(root, entry.path ?? '') === resolve(root));
    const artifact = await createArtifact(getRepoForge(repo, project), {
      title: PR_TITLE,
      body: PR_BODY,
      sourceBranch: SAGEOX_LINK_BRANCH,
      targetBranch: defaultBranch,
      cwd: tmp,
      repository,
    });
    if (!artifact.url) throw new SageoxCommitError(`the forge returned no URL for the ${SAGEOX_LINK_BRANCH} pull request`);

    await setCommitted(projectKey);
    return { status: 'opened', url: artifact.url, created: artifact.created };
  } finally {
    if (worktreeAdded) {
      try {
        await git(root, ['worktree', 'remove', '--force', tmp]);
      } catch {
        await removeTmpDir(tmpRoot, tmp);
      }
      try {
        await git(root, ['worktree', 'prune']);
      } catch {
        // A stale worktree record is harmless; the next prune clears it.
      }
    }
  }
}
