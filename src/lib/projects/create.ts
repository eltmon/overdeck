/**
 * Shared project-creation core (PAN-3836 WI-1).
 *
 * `pan project clone` / `pan project add` / `pan project new` and the dashboard's project
 * registry routes must resolve an operator's creation intent through literally
 * the same code, so the dialog's resolve-before-create preview can never
 * disagree with what confirming actually does.
 *
 * Two functions, deliberately split along the write boundary:
 *
 *   - `resolveProjectCreateIntent()` — resolution and validation only. It
 *     checks remote reachability (for clone/existing), detects the git remote,
 *     default branch, and proposed issue_prefix; it writes nothing and spawns
 *     no mutating git command, so it is safe to call on every keystroke. Invalid
 *     input comes back as `findings`, never as a throw, so a UI can render each
 *     problem against the field that caused it.
 *   - `performProjectCreate()` — the writes: the optional clone/init, optional
 *     .gitignore worktrees/ addition, project registration with auto-detected
 *     fields (remote, tracker, issue_prefix), and the main workspace creation.
 *
 * This module never reads the ambient working directory. A browser request has
 * none, so the caller passes explicit `parentDir` or `path`; when either is
 * invalid, that surfaces as a `findings`, never a guess.
 *
 * Filesystem work here is asynchronous. Resolution runs on the dashboard's single
 * event loop once per settled keystroke, so a sync `statSync`/`readFileSync` on a
 * slow or network-mounted path would stall unrelated HTTP, WebSocket and terminal
 * traffic (PAN-3330 review). The two exceptions are the registry and workspace
 * lookups (`getProjectSync`, `getMainWorkspace`): both are mtime-cached or
 * better-sqlite3 reads against local state, microsecond-scale, and they are the
 * canonical read doors — a parallel async door would be the worse trade.
 *
 * Paths are canonicalized (`realpath` on the nearest existing ancestor) before the
 * home-boundary check and before registration, so a symlink cannot carry a project
 * outside the boundary the dashboard enforces.
 *
 * NOTE: `child_process`/`util` are imported unprefixed (not `node:`) because
 * the CLI suites mock those specifiers to assert the argument-vector spawn.
 * Long-running clones are handed off to a job store with TTL-based cleanup
 * (see Dashboard routes: POST /api/projects returns 202 {jobId} for polling).
 */

import { execFile, spawn } from 'child_process';
import { mkdir, rm, stat, readFile, appendFile, readdir, realpath } from 'fs/promises';
import { join, resolve, dirname, basename, isAbsolute, sep } from 'path';
import { homedir } from 'os';
import { promisify } from 'util';

import { parseRepoUrl } from './repo-url.js';
import {
  getProjectSync,
  listProjectsAsync,
  type ProjectConfig,
} from '../projects.js';
import { registerProjectFromPath } from '../project-registration.js';
import { resolveWorkspaceCreateIntent, performWorkspaceCreate } from '../workspaces/create.js';
import { getMainWorkspace } from '../workspaces/resolver.js';

const execFileAsync = promisify(execFile);

export type ProjectCreateMode = 'clone' | 'existing' | 'new';

export type ProjectIntentField = 'url' | 'path' | 'parentDir' | 'name' | 'issuePrefix';

export type ProjectIntentCode =
  | 'url-invalid'
  | 'remote-unreachable'
  | 'path-not-a-directory'
  | 'path-outside-home'
  | 'target-exists'
  | 'name-invalid'
  | 'project-exists'
  | 'issue-prefix-invalid'
  | 'issue-prefix-taken'
  /** A relative path, or `~otheruser`, from a caller that has no working directory. */
  | 'path-not-absolute'
  /** The path exists but this server cannot stat or read it. */
  | 'path-unreadable'
  /** The chosen folder sits inside a repository rooted somewhere else (D-15). */
  | 'repository-root-elsewhere'
  /** This exact folder is already registered under this key — open or repair it. */
  | 'project-exists-here';

export interface ProjectIntentFinding {
  field: ProjectIntentField;
  code: ProjectIntentCode;
  message: string;
  detail?: string;
}

export interface ProjectCreateInput {
  mode: ProjectCreateMode;
  url?: string;
  path?: string;
  parentDir?: string;
  name?: string;
  issuePrefix?: string;
  homeBoundary: boolean;
  refreshRemote?: boolean;
  homeDir?: string;
}

export interface ResolvedProjectIntent {
  mode: ProjectCreateMode;
  key: string | null;
  name: string;
  path: string | null;
  /**
   * The resolved parent directory, always populated — including before the form
   * has enough input to validate. The UI shows it as a real value rather than a
   * `~/Projects` placeholder the operator would have to guess at (D-4).
   */
  parentDir: string;
  /** The server's home directory, so a browser never has to infer one (D-4). */
  homeDir: string;
  cloneUrl: string | null;
  provider: 'github' | 'gitlab' | null;
  repoSlug: string | null;
  defaultBranch: string | null;
  remoteChecked: boolean;
  isGitRepository: boolean;
  /** Canonical root of the repository containing `path`, when there is one. */
  gitRoot: string | null;
  proposedIssuePrefix: string | null;
  wouldClone: boolean;
  wouldGitInit: boolean;
  willCreateMainWorkspace: boolean;
  /** Set when this exact path is already registered under this key (repair target). */
  registeredKeyAtPath: string | null;
  findings: ProjectIntentFinding[];
}

export interface ProjectCreateProgress {
  phase: string;
  percent: number | null;
}

export interface ProjectCreateHooks {
  onProgress?: (progress: ProjectCreateProgress) => void;
  signal?: AbortSignal;
}

export interface ProjectCreateResult {
  key: string;
  name: string;
  path: string;
  mainWorkspaceId: string;
}

/** Git environment that disables interactive credential prompts. */
export function promptGuardGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'true',
    SSH_ASKPASS: 'true',
    GCM_INTERACTIVE: 'never',
    GIT_SSH_COMMAND: base.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
  };
}

const REMOTE_PROBE_TTL_MS = 60_000;
/**
 * Failed probes expire fast. A 60 s failure memo would pin `remote-unreachable`
 * on a URL that came back a second later, and the operator cannot clear it.
 */
const REMOTE_PROBE_FAILURE_TTL_MS = 5_000;
const REMOTE_PROBE_TIMEOUT_MS = 15_000;

interface RemoteProbeResult {
  ok: boolean;
  defaultBranch?: string | null;
  error?: string;
}

const remoteProbeMemo = new Map<string, { at: number; result: RemoteProbeResult }>();
const remoteProbeInFlight = new Map<string, Promise<RemoteProbeResult>>();

function remoteProbeTtl(result: RemoteProbeResult): number {
  return result.ok ? REMOTE_PROBE_TTL_MS : REMOTE_PROBE_FAILURE_TTL_MS;
}

/** At most this many settled probe results are kept (D-2). */
const REMOTE_PROBE_MAX_ENTRIES = 128;

/**
 * Drop expired entries, then the oldest ones if the memo is still over its cap.
 *
 * The memo is consulted only on the read path, so without this the Map gains a
 * permanent entry per distinct clone URL for the life of a dashboard process
 * that never restarts — and the operator types many distinct URLs.
 */
function pruneRemoteProbeMemo(now: number): void {
  for (const [url, entry] of remoteProbeMemo) {
    if (now - entry.at >= remoteProbeTtl(entry.result)) remoteProbeMemo.delete(url);
  }
  if (remoteProbeMemo.size <= REMOTE_PROBE_MAX_ENTRIES) return;
  const byAge = [...remoteProbeMemo.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [url] of byAge.slice(0, remoteProbeMemo.size - REMOTE_PROBE_MAX_ENTRIES)) {
    remoteProbeMemo.delete(url);
  }
}

/** Probe a remote repository for its default branch via git ls-remote. Memoized. */
async function probeRemote(
  cloneUrl: string,
  opts: { refresh?: boolean } = {},
): Promise<RemoteProbeResult> {
  pruneRemoteProbeMemo(Date.now());

  const hit = remoteProbeMemo.get(cloneUrl);
  if (!opts.refresh && hit) {
    return hit.result;
  }

  // Coalesce concurrent probes for the same URL onto one child process: two
  // resolves racing on the same field must not each hold a 15 s `git ls-remote`.
  const pending = remoteProbeInFlight.get(cloneUrl);
  if (pending) return pending;

  const run = (async (): Promise<RemoteProbeResult> => {
    let result: RemoteProbeResult;
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-remote', '--symref', '--', cloneUrl, 'HEAD'],
        {
          env: promptGuardGitEnv(),
          timeout: REMOTE_PROBE_TIMEOUT_MS,
          killSignal: 'SIGKILL',
        },
      );
      const match = stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m);
      result = { ok: true, defaultBranch: match?.[1] ?? null };
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    remoteProbeMemo.set(cloneUrl, { at: Date.now(), result });
    return result;
  })();

  remoteProbeInFlight.set(cloneUrl, run);
  try {
    return await run;
  } finally {
    remoteProbeInFlight.delete(cloneUrl);
  }
}

/** Reset the remote probe memo for tests. */
export function __resetRemoteProbeMemoForTests(): void {
  remoteProbeMemo.clear();
  remoteProbeInFlight.clear();
}

/**
 * Canonicalize a path: `realpath` its nearest existing ancestor and re-anchor the
 * not-yet-created tail onto the result.
 *
 * `resolve()` alone is lexical — it collapses `..` but never expands a symlink, so
 * an in-home link pointing outside the tree passes a naive prefix test. The
 * dashboard route this core replaced canonicalized with `realpath` for exactly that
 * reason ("rejects symlink escapes"); that property lives here now. The tail comes
 * from an already-resolved absolute path, so it carries no `.` or `..` segment and
 * cannot walk back out of the canonical ancestor.
 */
async function canonicalizePath(filePath: string): Promise<string> {
  const abs = resolve(filePath);
  const tail: string[] = [];
  let current = abs;

  for (;;) {
    try {
      const real = await realpath(current);
      return tail.length > 0 ? join(real, ...tail) : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return abs; // reached the root with nothing existing
      tail.unshift(basename(current));
      current = parent;
    }
  }
}

/** True when an already-canonical path is the home directory or below it. */
async function isWithinHome(canonicalPath: string, home: string): Promise<boolean> {
  const homeReal = await canonicalizePath(home);
  return canonicalPath === homeReal || canonicalPath.startsWith(homeReal + sep);
}

/** Bounded git metadata reads: local, so slow here means something is wrong. */
const GIT_METADATA_TIMEOUT_MS = 5_000;

/**
 * Expand a user-supplied directory against the *server's* home (D-4).
 *
 * A browser has no idea what `~` means on the machine that will hold the
 * repository, so expansion happens here and the resolved absolute path goes back
 * to the UI as a real value instead of a placeholder the operator has to guess.
 */
function expandServerPath(raw: string, home: string): { path: string } | { reason: 'tilde-user' } {
  const trimmed = raw.trim();
  if (trimmed === '~') return { path: home };
  if (trimmed.startsWith('~/')) return { path: join(home, trimmed.slice(2)) };
  // `~someone` names another account's home, which this server has no business
  // writing into on the operator's behalf.
  if (trimmed.startsWith('~')) return { reason: 'tilde-user' };
  return { path: trimmed };
}

type PathKind = 'directory' | 'file' | 'missing' | 'blocked-by-file' | 'unreadable';

/**
 * Classify a path so each way of being unusable reads differently (D-11).
 *
 * "Not found" sends the operator to create it; "a file is in the way" and "this
 * server cannot read it" send them somewhere else entirely, and collapsing all
 * three into one message is how a permissions problem gets mistaken for a typo.
 */
async function classifyPath(target: string): Promise<PathKind> {
  try {
    const stats = await stat(target);
    return stats.isDirectory() ? 'directory' : 'file';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 'missing';
    // ENOTDIR means an ancestor is a regular file, not that this path is absent.
    if (code === 'ENOTDIR') return 'blocked-by-file';
    return 'unreadable';
  }
}

const PATH_KIND_MESSAGE: Record<Exclude<PathKind, 'directory'>, string> = {
  file: 'That path is a file. Choose a directory.',
  missing: 'Directory not found.',
  'blocked-by-file': 'Part of that path is a file, so it cannot contain a directory.',
  unreadable: 'This server cannot read that path. Check its permissions.',
};

/**
 * The repository root containing `dir`, or null when `dir` is not inside a repo.
 *
 * `rev-parse --show-toplevel` is the only correct check (D-15). `.git` is a
 * *file* in a linked worktree, and a subdirectory of a repository has no `.git`
 * at all — the `.git.isDirectory()` test this replaces called both of those
 * "not a repository", so adding a worktree silently registered a non-Git folder.
 */
async function detectGitRoot(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      timeout: GIT_METADATA_TIMEOUT_MS,
      env: promptGuardGitEnv(),
    });
    const root = stdout.trim();
    return root || null;
  } catch {
    return null;
  }
}

/** The origin URL of a repository, or null when it has no origin. */
async function detectOriginUrl(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
      cwd: dir,
      timeout: GIT_METADATA_TIMEOUT_MS,
      env: promptGuardGitEnv(),
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The repository's default branch, or null when it genuinely cannot be told.
 *
 * Null matters: writing a guessed `main` into `workspace.default_branch` sends
 * every later workspace at a branch that may not exist.
 */
async function detectDefaultBranch(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      { cwd: dir, timeout: GIT_METADATA_TIMEOUT_MS, env: promptGuardGitEnv() },
    );
    const branch = stdout.trim().replace(/^origin\//, '');
    if (branch) return branch;
  } catch {
    // No origin/HEAD recorded; fall back to whatever is checked out.
  }

  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: dir,
      timeout: GIT_METADATA_TIMEOUT_MS,
      env: promptGuardGitEnv(),
    });
    const branch = stdout.trim();
    // A detached HEAD reports the literal string "HEAD"; an unborn branch errors.
    // Both mean unknown.
    return branch && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a project creation intent to a computed preview with findings.
 * Writes nothing; safe to call on every keystroke.
 */
export async function resolveProjectCreateIntent(
  input: ProjectCreateInput,
): Promise<ResolvedProjectIntent> {
  const findings: ProjectIntentFinding[] = [];
  const home = await canonicalizePath(input.homeDir ?? homedir());

  // Defaults are computed before any early return. An empty form still has to
  // show where files would land, and a missing URL is not a reason to hide it.
  let parentDir = join(home, 'Projects');
  if (input.parentDir?.trim()) {
    const expanded = expandServerPath(input.parentDir, home);
    if ('reason' in expanded) {
      findings.push({
        field: 'parentDir',
        code: 'path-not-absolute',
        message: 'Only ~ for your own home directory is supported. Enter an absolute path.',
        detail: input.parentDir,
      });
    } else if (input.homeBoundary && !isAbsolute(expanded.path)) {
      // There is no working directory to be relative to: the request is a browser's.
      findings.push({
        field: 'parentDir',
        code: 'path-not-absolute',
        message: 'Enter an absolute path, for example /home/you/Projects.',
        detail: input.parentDir,
      });
    } else {
      parentDir = resolve(expanded.path);
    }
  }

  const intent: ResolvedProjectIntent = {
    mode: input.mode,
    key: null,
    name: '',
    path: null,
    parentDir,
    homeDir: home,
    cloneUrl: null,
    provider: null,
    repoSlug: null,
    defaultBranch: null,
    remoteChecked: false,
    isGitRepository: false,
    gitRoot: null,
    proposedIssuePrefix: null,
    wouldClone: false,
    wouldGitInit: false,
    willCreateMainWorkspace: false,
    registeredKeyAtPath: null,
    findings,
  };

  // 1. Mode-specific source validation
  if (input.mode === 'clone') {
    const parsed = input.url ? parseRepoUrl(input.url) : null;
    if (!parsed) {
      findings.push({
        field: 'url',
        code: 'url-invalid',
        message: 'Enter a GitHub or GitLab URL, or owner/repo.',
        detail: input.url,
      });
      return intent;
    }
    intent.cloneUrl = parsed.cloneUrl;
    intent.provider = parsed.provider;
    intent.repoSlug = parsed.slug;
    intent.name = input.name?.trim() || parsed.folderName || '';
    intent.wouldClone = true;
    intent.isGitRepository = true;
  } else if (input.mode === 'existing') {
    const rawPath = input.path?.trim();
    if (!rawPath) {
      findings.push({
        field: 'path',
        code: 'path-not-a-directory',
        message: 'Choose an existing directory.',
        detail: input.path,
      });
      return intent;
    }
    const expanded = expandServerPath(rawPath, home);
    if ('reason' in expanded) {
      findings.push({
        field: 'path',
        code: 'path-not-absolute',
        message: 'Only ~ for your own home directory is supported. Enter an absolute path.',
        detail: rawPath,
      });
      return intent;
    }
    if (!isAbsolute(expanded.path)) {
      findings.push({
        field: 'path',
        code: 'path-not-absolute',
        message: 'Enter an absolute path, for example /home/you/Projects/my-repo.',
        detail: rawPath,
      });
      return intent;
    }
    intent.name = input.name?.trim() || basename(expanded.path);
    // Stashed for step 3, which canonicalizes it alongside the clone/new branch.
    input = { ...input, path: expanded.path };
  } else {
    intent.name = input.name?.trim() ?? '';
    intent.wouldGitInit = true;
    intent.isGitRepository = true;
  }

  // 2. Key
  const key = intent.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!key.replace(/-/g, '')) {
    findings.push({
      field: 'name',
      code: 'name-invalid',
      message: 'Name must contain a letter or number.',
      detail: intent.name,
    });
    return intent;
  }
  intent.key = key;

  // 3. Path + home boundary + fs checks
  if (input.mode === 'clone' || input.mode === 'new') {
    // Canonical from here on: the boundary check below and the registration that
    // follows must agree on one path, not on a symlink and its target.
    intent.path = await canonicalizePath(join(parentDir, key));
  } else {
    intent.path = await canonicalizePath(input.path!);
    const kind = await classifyPath(intent.path);
    if (kind !== 'directory') {
      findings.push({
        field: 'path',
        code: kind === 'unreadable' ? 'path-unreadable' : 'path-not-a-directory',
        message: PATH_KIND_MESSAGE[kind],
        detail: intent.path,
      });
      return intent;
    }
  }

  // A project already registered at this exact path is not a duplicate to argue
  // with — it is the same project, and the operator wants to open or repair it.
  const registered = getProjectSync(key);
  if (registered) {
    const registeredPath = await canonicalizePath(registered.path);
    if (registeredPath === intent.path) {
      intent.registeredKeyAtPath = key;
      findings.push({
        field: 'name',
        code: 'project-exists-here',
        message: `This folder is already registered as project '${key}'.`,
        detail: intent.path,
      });
    } else {
      findings.push({
        field: 'name',
        code: 'project-exists',
        message: `Project '${key}' is already registered at ${registeredPath}.`,
        detail: registeredPath,
      });
    }
  }

  // Home boundary check
  if (input.homeBoundary && !(await isWithinHome(intent.path, home))) {
    findings.push({
      field: input.mode === 'existing' ? 'path' : 'parentDir',
      code: 'path-outside-home',
      message: 'Path must be within your home directory.',
      detail: intent.path,
    });
  }

  // Target exists check for clone/new
  if ((input.mode === 'clone' || input.mode === 'new') && intent.path) {
    const kind = await classifyPath(intent.path);
    if (kind === 'file') {
      findings.push({
        field: input.mode === 'clone' ? 'url' : 'name',
        code: 'path-not-a-directory',
        message: 'A file already exists at that destination.',
        detail: intent.path,
      });
    } else if (kind === 'unreadable' || kind === 'blocked-by-file') {
      findings.push({
        field: 'parentDir',
        code: kind === 'unreadable' ? 'path-unreadable' : 'path-not-a-directory',
        message: PATH_KIND_MESSAGE[kind],
        detail: intent.path,
      });
    } else if (kind === 'directory') {
      try {
        const children = await readdir(intent.path);
        if (children.length > 0) {
          findings.push({
            field: input.mode === 'clone' ? 'url' : 'name',
            code: 'target-exists',
            message: 'Target directory already exists and is not empty.',
            detail: intent.path,
          });
        }
      } catch {
        findings.push({
          field: 'parentDir',
          code: 'path-unreadable',
          message: 'This server cannot read the destination. Check its permissions.',
          detail: intent.path,
        });
      }
    }
  }

  // 4. Detection
  if (input.mode === 'clone' && intent.cloneUrl) {
    // Each probe is a real `git ls-remote` child process, so skip it while the form
    // already has something to fix. A half-typed URL never gets this far: the
    // parser rejects an incomplete known-provider path as `url-invalid`.
    if (findings.length === 0) {
      const probe = await probeRemote(intent.cloneUrl, { refresh: input.refreshRemote });
      intent.remoteChecked = true;
      if (probe.ok) {
        intent.defaultBranch = probe.defaultBranch ?? null;
      } else {
        findings.push({
          field: 'url',
          code: 'remote-unreachable',
          message: 'Could not reach the remote repository.',
          detail: probe.error,
        });
      }
    }
  } else if (input.mode === 'existing' && intent.path) {
    const root = await detectGitRoot(intent.path);
    if (root) {
      const canonicalRoot = await canonicalizePath(root);
      intent.isGitRepository = true;
      intent.gitRoot = canonicalRoot;
      if (canonicalRoot !== intent.path) {
        // Registering here would root a second project inside an existing repo,
        // which is how you end up with two projects fighting over one checkout.
        findings.push({
          field: 'path',
          code: 'repository-root-elsewhere',
          message: `That folder is inside a Git repository rooted at ${canonicalRoot}. Add that folder instead.`,
          detail: canonicalRoot,
        });
      }

      const originUrl = await detectOriginUrl(intent.path);
      if (originUrl) {
        const parsedOrigin = parseRepoUrl(originUrl);
        if (parsedOrigin) {
          intent.provider = parsedOrigin.provider;
          intent.repoSlug = parsedOrigin.slug;
        }
      }
      intent.defaultBranch = await detectDefaultBranch(intent.path);
    } else {
      // A plain folder is a perfectly good project; `new` mode's init is what
      // would turn it into a repository, and existing mode must not do that.
      intent.isGitRepository = false;
    }
  }

  // 5. Issue prefix. Computed whenever a key exists so a prefix problem can open
  // Options even while another field is still being fixed (D-3).
  if (intent.key) {
    const proposed = (input.issuePrefix ?? key.toUpperCase().replace(/-/g, '').slice(0, 10)).trim();
    if (!/^[A-Z][A-Z0-9]{0,9}$/.test(proposed)) {
      findings.push({
        field: 'issuePrefix',
        code: 'issue-prefix-invalid',
        message:
          'Issue prefix must start with a letter and contain only uppercase letters and digits (max 10 chars).',
        detail: proposed,
      });
    } else {
      intent.proposedIssuePrefix = proposed;
      const projectConfigs = await listProjectsAsync();
      const taken = projectConfigs.some(
        ({ key: otherKey, config }) =>
          otherKey !== key &&
          (config.issue_prefix === proposed || config.issue_prefixes?.includes(proposed)),
      );
      if (taken) {
        findings.push({
          field: 'issuePrefix',
          code: 'issue-prefix-taken',
          message: `Issue prefix '${proposed}' is already used by another project.`,
          detail: proposed,
        });
      }
    }
  }

  // 6. willCreateMainWorkspace
  if (intent.key) {
    intent.willCreateMainWorkspace = getMainWorkspace(intent.key) === null;
  }

  return intent;
}

/**
 * Build the detected configuration a fresh registration should carry (D-10).
 *
 * Typed as a `Pick` of `ProjectConfig` rather than a `Record<string, …>` so a
 * future field cannot be spelled wrong on the way into `projects.yaml`, and so
 * `name` and `path` — which registration owns — cannot be overwritten from here.
 */
export type ProjectRegistrationExtras = Pick<
  ProjectConfig,
  'tracker' | 'github_repo' | 'gitlab_repo' | 'issue_prefix' | 'workspace'
>;

function buildExtras(intent: ResolvedProjectIntent): ProjectRegistrationExtras {
  const extras: ProjectRegistrationExtras = {};

  if (intent.provider === 'github' && intent.repoSlug) {
    extras.tracker = 'github';
    extras.github_repo = intent.repoSlug;
  } else if (intent.provider === 'gitlab' && intent.repoSlug) {
    extras.tracker = 'gitlab';
    extras.gitlab_repo = intent.repoSlug;
  }

  if (intent.proposedIssuePrefix) {
    extras.issue_prefix = intent.proposedIssuePrefix;
  }

  // Only a branch we actually determined. A guessed `main` here would point
  // every later workspace at a branch that may not exist.
  if (intent.defaultBranch) {
    extras.workspace = { default_branch: intent.defaultBranch };
  }

  return extras;
}

/** Exclude workspaces directory from git. */
async function excludeWorkspacesDir(root: string, dir: string): Promise<void> {
  const gitDir = join(root, '.git');
  try {
    const gitStats = await stat(gitDir);
    if (!gitStats.isDirectory()) return; // .git is a file (worktree), skip
  } catch {
    return; // No .git, skip
  }

  const infoDir = join(gitDir, 'info');
  const excludeFile = join(infoDir, 'exclude');

  try {
    await mkdir(infoDir, { recursive: true });
  } catch {
    // ignore
  }

  let content = '';
  try {
    content = await readFile(excludeFile, 'utf-8');
  } catch {
    // File doesn't exist, that's ok
  }

  const lines = content.split('\n').map((line) => line.trim());
  const shouldAdd = !lines.includes(`${dir}/`) && !lines.includes(dir);

  if (shouldAdd) {
    const newEntry = `${dir}/\n`;
    await appendFile(excludeFile, newEntry);
  }
}

/** Run git clone with progress reporting. */
async function runClone(
  cloneUrl: string,
  targetPath: string,
  hooks: ProjectCreateHooks,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['clone', '--progress', '--', cloneUrl, targetPath], {
      env: promptGuardGitEnv(),
      stdio: ['ignore', 'ignore', 'pipe'],
      signal: hooks.signal,
    });

    const stderrChunks: Buffer[] = [];

    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      const text = chunk.toString();
      const lines = text.split(/[\r\n]+/);

      for (const line of lines) {
        const match = line.match(/^([\w ]+):\s+(\d+)%/);
        if (match) {
          const phase = match[1].trim();
          hooks.onProgress?.({ phase, percent: Number(match[2]) });
        }
      }
    });

    proc.on('exit', (code: number) => {
      if (code === 0) {
        hooks.onProgress?.({ phase: 'done', percent: 100 });
        resolve();
      } else {
        const stderr = Buffer.concat(stderrChunks).toString();
        const lines = stderr.split('\n').slice(-20).join('\n');
        reject(new Error(`git clone failed: ${lines}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Perform a resolved project creation: clone/init, register, exclude,
 * bootstrap main workspace.
 */
export async function performProjectCreate(
  intent: ResolvedProjectIntent,
  hooks: ProjectCreateHooks = {},
): Promise<ProjectCreateResult> {
  if (intent.findings.length > 0) {
    throw new Error(intent.findings[0].message);
  }
  if (!intent.key || !intent.path) {
    throw new Error('Project intent did not resolve to a key and path.');
  }

  let createdTarget = false;
  if (intent.wouldClone || intent.wouldGitInit) {
    await mkdir(dirname(intent.path), { recursive: true });
    try {
      await mkdir(intent.path);
      createdTarget = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }

  try {
    if (intent.wouldClone) {
      await runClone(intent.cloneUrl!, intent.path, hooks);
    } else if (intent.wouldGitInit) {
      await execFileAsync('git', ['init', '--quiet'], { cwd: intent.path });
    }
  } catch (err) {
    if (createdTarget) {
      await rm(intent.path, { recursive: true, force: true });
    }
    throw err;
  }

  hooks.onProgress?.({ phase: 'registering', percent: null });
  const extras = buildExtras(intent);
  const registered = await registerProjectFromPath({
    path: intent.path,
    name: intent.name,
    extras: Object.keys(extras).length > 0 ? extras : undefined,
  });

  await excludeWorkspacesDir(intent.path, 'workspaces');

  const wsIntent = await resolveWorkspaceCreateIntent({
    kind: 'main',
    projectKey: registered.key,
  });
  if (wsIntent.findings.length > 0) {
    throw new Error(wsIntent.findings[0].message);
  }

  const existing = getMainWorkspace(registered.key);
  const mainWorkspace = existing
    ? existing
    : await performWorkspaceCreate(wsIntent);

  hooks.onProgress?.({ phase: 'done', percent: 100 });
  return {
    key: registered.key,
    name: registered.config.name,
    path: registered.config.path,
    mainWorkspaceId: mainWorkspace.id,
  };
}
