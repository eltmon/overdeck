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
 * Every filesystem and config read here is asynchronous. Resolution runs on
 * the dashboard's single event loop once per settled keystroke, so a sync
 * `statSync`/`readFileSync` on a slow or network-mounted path would stall
 * unrelated HTTP, WebSocket and terminal traffic (PAN-3330 review).
 *
 * NOTE: `child_process`/`util` are imported unprefixed (not `node:`) because
 * the CLI suites mock those specifiers to assert the argument-vector spawn.
 * Long-running clones are handed off to a job store with TTL-based cleanup
 * (see Dashboard routes: POST /api/projects returns 202 {jobId} for polling).
 */

import { execFile, spawn } from 'child_process';
import { mkdir, rm, stat, readFile, appendFile, readdir } from 'fs/promises';
import { join, resolve, dirname, basename, isAbsolute } from 'path';
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
  | 'issue-prefix-taken';

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
  cloneUrl: string | null;
  provider: 'github' | 'gitlab' | null;
  repoSlug: string | null;
  defaultBranch: string | null;
  remoteChecked: boolean;
  isGitRepository: boolean;
  proposedIssuePrefix: string | null;
  wouldClone: boolean;
  wouldGitInit: boolean;
  willCreateMainWorkspace: boolean;
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
const REMOTE_PROBE_TIMEOUT_MS = 15_000;

interface RemoteProbeResult {
  ok: boolean;
  defaultBranch?: string | null;
  error?: string;
}

const remoteProbeMemo = new Map<string, { at: number; result: RemoteProbeResult }>();

/** Probe a remote repository for its default branch via git ls-remote. Memoized. */
async function probeRemote(
  cloneUrl: string,
  opts: { refresh?: boolean } = {},
): Promise<RemoteProbeResult> {
  const hit = remoteProbeMemo.get(cloneUrl);
  if (!opts.refresh && hit && Date.now() - hit.at < REMOTE_PROBE_TTL_MS) {
    return hit.result;
  }

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
}

/** Reset the remote probe memo for tests. */
export function __resetRemoteProbeMemoForTests(): void {
  remoteProbeMemo.clear();
}

/** Check if path is within home directory. Uses nearest existing ancestor. */
async function isWithinHome(filePath: string, home: string): Promise<boolean> {
  let current = filePath;
  const homeAbs = resolve(home);

  while (current !== dirname(current)) {
    try {
      await stat(current);
      return resolve(current).startsWith(homeAbs + '/') || resolve(current) === homeAbs;
    } catch {
      current = dirname(current);
    }
  }

  return false;
}

/**
 * Resolve a project creation intent to a computed preview with findings.
 * Writes nothing; safe to call on every keystroke.
 */
export async function resolveProjectCreateIntent(
  input: ProjectCreateInput,
): Promise<ResolvedProjectIntent> {
  const findings: ProjectIntentFinding[] = [];
  const intent: ResolvedProjectIntent = {
    mode: input.mode,
    key: null,
    name: '',
    path: null,
    cloneUrl: null,
    provider: null,
    repoSlug: null,
    defaultBranch: null,
    remoteChecked: false,
    isGitRepository: false,
    proposedIssuePrefix: null,
    wouldClone: false,
    wouldGitInit: false,
    willCreateMainWorkspace: false,
    findings,
  };

  const home = input.homeDir ?? homedir();
  const parentDir = resolve(input.parentDir ?? join(home, 'Projects'));

  // 1. Mode-specific source validation
  if (input.mode === 'clone') {
    const parsed = input.url ? parseRepoUrl(input.url.trim()) : null;
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
    if (!input.path || !isAbsolute(input.path)) {
      findings.push({
        field: 'path',
        code: 'path-not-a-directory',
        message: 'Choose an existing directory.',
        detail: input.path,
      });
      return intent;
    }
    intent.name = input.name?.trim() || basename(input.path);
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

  if (getProjectSync(key)) {
    findings.push({
      field: 'name',
      code: 'project-exists',
      message: `Project '${key}' is already registered.`,
      detail: key,
    });
  }

  // 3. Path + home boundary + fs checks
  if (input.mode === 'clone' || input.mode === 'new') {
    intent.path = join(parentDir, key);
  } else {
    try {
      intent.path = resolve(input.path!);
      await stat(intent.path);
    } catch {
      findings.push({
        field: 'path',
        code: 'path-not-a-directory',
        message: 'Directory not found.',
        detail: input.path,
      });
      return intent;
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
    try {
      const stats = await stat(intent.path);
      const children = await readdir(intent.path);
      if (stats.isDirectory() && children.length > 0) {
        findings.push({
          field: input.mode === 'clone' ? 'url' : 'name',
          code: 'target-exists',
          message: 'Target directory already exists and is not empty.',
          detail: intent.path,
        });
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        findings.push({
          field: 'path',
          code: 'path-not-a-directory',
          message: 'Cannot access target directory.',
          detail: String(err),
        });
      }
    }
  }

  // 4. Detection
  if (input.mode === 'clone' && intent.cloneUrl) {
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
  } else if (input.mode === 'existing' && intent.path) {
    const gitDir = join(intent.path, '.git');
    try {
      const gitStats = await stat(gitDir);
      if (gitStats.isDirectory()) {
        intent.isGitRepository = true;
        try {
          const { stdout: originUrl } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
            cwd: intent.path,
            timeout: 5000,
          });
          const parsedOrigin = parseRepoUrl(originUrl.trim());
          if (parsedOrigin) {
            intent.provider = parsedOrigin.provider;
            intent.repoSlug = parsedOrigin.slug;
          }
        } catch {
          // No origin or command failed, that's ok
        }

        try {
          const { stdout: headBranch } = await execFileAsync(
            'git',
            ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
            { cwd: intent.path, timeout: 5000 },
          );
          intent.defaultBranch = headBranch.trim().replace(/^origin\//, '');
        } catch {
          try {
            const { stdout: currentBranch } = await execFileAsync(
              'git',
              ['rev-parse', '--abbrev-ref', 'HEAD'],
              { cwd: intent.path, timeout: 5000 },
            );
            intent.defaultBranch = currentBranch.trim();
          } catch {
            // No branch, that's ok
          }
        }
      }
    } catch {
      intent.isGitRepository = false;
    }
  }

  // 5. Issue prefix
  if (findings.length === 0 && intent.key) {
    const proposed = (input.issuePrefix ?? key.toUpperCase().replace(/-/g, '').slice(0, 10)).trim();
    if (!/^[A-Z][A-Z0-9]{0,9}$/.test(proposed)) {
      findings.push({
        field: 'issuePrefix',
        code: 'issue-prefix-invalid',
        message: 'Issue prefix must start with a letter and contain only uppercase letters and digits (max 10 chars).',
        detail: proposed,
      });
    } else {
      intent.proposedIssuePrefix = proposed;
      const projectConfigs = await listProjectsAsync();
      if (
        projectConfigs.some((config) => config.issue_prefix === proposed || config.issue_prefixes?.includes(proposed))
      ) {
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
  if (findings.length === 0 && intent.key) {
    intent.willCreateMainWorkspace = getMainWorkspace(intent.key) === null;
  }

  return intent;
}

/** Build extras from resolved intent. */
function buildExtras(intent: ResolvedProjectIntent) {
  const extras: Record<string, string | object> = {};

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
