/**
 * The SageOx merge guard (PAN-4852 WI-15): a PR may not carry `.sageox/`
 * link files unless the project opted in to committing them.
 *
 * Overdeck places a project's SageOx binding into a worktree and hides it
 * from git, so the link files should never reach a PR by accident. The rule
 * runs for every issue in every project (AD-19): a PR whose diff touches any
 * path under `.sageox/` is refused unless the project has a committed binding
 * (`sageox_binding: committed` in `projects.yaml`, or the default branch
 * already tracks `.sageox/config.json`).
 *
 * `evaluateSageoxMergeGuard` is the pure rule. `sageoxMergeGuardForIssue`
 * composes the local git reads (AD-20) and fails closed: when the PR head or
 * the diff cannot be read, the PR is not mergeable. A polyrepo workspace is
 * out of scope for SageOx placement and passes.
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { getIssueWorkspacePath } from '../overdeck/issue-projects.js';
import { defaultBranchForRepo } from '../project-repos.js';
import { getProjectSync, resolveProjectFromIssueSync, type ProjectConfig } from '../projects.js';
import { defaultBranchTracksSageox } from './binding.js';
import { readSageoxBindingCommitted } from './config.js';

const execFileAsync = promisify(execFile);
const DIFF_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 64 * 1024 * 1024;
const SAGEOX_DIR = '.sageox';

export type SageoxGuardVerdict = { ok: true } | { ok: false; reason: string; paths: string[] };

const isSageoxPath = (path: string): boolean => path === SAGEOX_DIR || path.startsWith(`${SAGEOX_DIR}/`);

export function evaluateSageoxMergeGuard(input: {
  changedPaths: readonly string[];
  committed: boolean;
  projectKey: string;
}): SageoxGuardVerdict {
  if (input.committed) return { ok: true };
  const paths = input.changedPaths.filter(isSageoxPath);
  if (paths.length === 0) return { ok: true };
  return {
    ok: false,
    reason: `PR changes SageOx link files (.sageox/) but ${input.projectKey} has not opted in to committing them; remove them from the PR or run pan skills pack sageox commit --project ${input.projectKey}`,
    paths,
  };
}

// ── reads ────────────────────────────────────────────────────────────────

async function hasCommit(cwd: string, sha: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, timeout: DIFF_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/**
 * The PR's changed paths under `.sageox` (AD-20):
 * `git diff --name-only -z <baseRef>...<headSha> -- .sageox`. When the head
 * commit is not local, fetches `origin <headBranch>` once first. Throws when
 * the head cannot be found or the diff fails.
 */
export async function readSageoxChangedPaths(
  cwd: string,
  baseRef: string,
  headSha: string,
  headBranch: string | null,
): Promise<string[]> {
  for (const [name, value] of [['base ref', baseRef], ['head', headSha]] as const) {
    if (!value || value.startsWith('-')) throw new Error(`invalid ${name}: ${JSON.stringify(value)}`);
  }
  if (!(await hasCommit(cwd, headSha))) {
    if (!headBranch || headBranch.startsWith('-')) {
      throw new Error(`PR head ${headSha} is not in ${cwd} and the PR has no head branch to fetch`);
    }
    await execFileAsync('git', ['fetch', '--quiet', 'origin', headBranch], {
      cwd,
      timeout: FETCH_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  }
  const { stdout } = await execFileAsync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', `${baseRef}...${headSha}`, '--', SAGEOX_DIR],
    { cwd, timeout: DIFF_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
  );
  return stdout.split('\0').filter(Boolean);
}

async function isGitWorkTree(dir: string): Promise<boolean> {
  try {
    if (!(await stat(dir)).isDirectory()) return false;
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, timeout: DIFF_TIMEOUT_MS });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export interface SageoxGuardDeps {
  resolveProject: (issueId: string) => { projectKey: string; projectPath: string; config: ProjectConfig | null } | null;
  workspacePath: (issueId: string) => string | null;
  isGitWorkTree: (dir: string) => Promise<boolean>;
  readCommitted: (projectKey: string) => Promise<boolean>;
  defaultBranchTracks: (root: string, defaultBranch: string) => Promise<boolean>;
  readChangedPaths: typeof readSageoxChangedPaths;
}

const defaultDeps: SageoxGuardDeps = {
  resolveProject: issueId => {
    const resolved = resolveProjectFromIssueSync(issueId);
    if (!resolved) return null;
    return { projectKey: resolved.projectKey, projectPath: resolved.projectPath, config: getProjectSync(resolved.projectKey) };
  },
  workspacePath: getIssueWorkspacePath,
  isGitWorkTree,
  readCommitted: readSageoxBindingCommitted,
  defaultBranchTracks: defaultBranchTracksSageox,
  readChangedPaths: readSageoxChangedPaths,
};

const couldNotRead = (message: string, cwd: string): SageoxGuardVerdict => ({
  ok: false,
  reason: `SageOx merge guard could not read the PR's changed files: ${message}; fetch the PR head in ${cwd}`,
  paths: [],
});

/**
 * The guard for one issue's PR. A committed project passes without a diff
 * read, because the rule cannot refuse it. Otherwise any failure to read the
 * head or the diff refuses.
 */
export async function sageoxMergeGuardForIssue(
  issueId: string,
  headSha: string | null,
  headBranch: string | null,
  deps: Partial<SageoxGuardDeps> = {},
): Promise<SageoxGuardVerdict> {
  const d = { ...defaultDeps, ...deps };
  const project = d.resolveProject(issueId);
  if (!project) {
    return {
      ok: false,
      reason: `SageOx merge guard could not resolve the project for ${issueId.toUpperCase()}`,
      paths: [],
    };
  }
  if (project.config?.workspace?.type === 'polyrepo') return { ok: true };

  const workspace = d.workspacePath(issueId);
  const cwd = workspace && (await d.isGitWorkTree(workspace)) ? workspace : project.projectPath;
  const defaultBranch = defaultBranchForRepo(project.config, cwd);
  try {
    const committed =
      (await d.readCommitted(project.projectKey)) || (await d.defaultBranchTracks(project.projectPath, defaultBranch));
    if (committed) return { ok: true };
    if (!headSha) return couldNotRead('no PR head', cwd);
    const changedPaths = await d.readChangedPaths(cwd, `origin/${defaultBranch}`, headSha, headBranch);
    return evaluateSageoxMergeGuard({ changedPaths, committed, projectKey: project.projectKey });
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    return couldNotRead((e.stderr || e.message || String(error)).trim(), cwd);
  }
}
