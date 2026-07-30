/**
 * Shared workspace-creation core (PAN-3330 WI-1).
 *
 * `pan workspace new` / `pan workspace main` and the dashboard's workspace
 * registry routes must resolve an operator's creation intent through literally
 * the same code, so the dialog's resolve-before-create preview can never
 * disagree with what confirming actually does.
 *
 * Two functions, deliberately split along the write boundary:
 *
 *   - `resolveWorkspaceCreateIntent()` — resolution and validation only. It
 *     reads projects.yaml, the registry (through the resolver door) and the
 *     filesystem; it writes nothing and spawns no mutating git command, so it
 *     is safe to call on every keystroke. Invalid input comes back as
 *     `findings`, never as a throw, so a UI can render each problem against
 *     the field that caused it.
 *   - `performWorkspaceCreate()` — the writes: the optional `git worktree add`,
 *     project seeding, and the registry row through the writer door.
 *
 * This module never reads the ambient working directory. A browser request has
 * none, so the caller passes `projectKey` or an explicit `cwd`; when neither
 * disambiguates, that surfaces as a `project-ambiguous` finding, never a guess.
 *
 * Every filesystem and config read here is asynchronous. Resolution runs on
 * the dashboard's single event loop once per settled keystroke, so a sync
 * `statSync`/`readFileSync` on a slow or network-mounted path would stall
 * unrelated HTTP, WebSocket and terminal traffic (PAN-3330 review).
 *
 * NOTE: `child_process`/`util` are imported unprefixed (not `node:`) because
 * the CLI suites mock those specifiers to assert the argument-vector spawn.
 */
import { execFile } from 'child_process';
import { stat } from 'fs/promises';
import { join, resolve } from 'path';
import { promisify } from 'util';
import { listProjectsAsync, type ProjectConfig } from '../projects.js';
import { getDefaultWorkspaceConfigSync } from '../workspace-config.js';
import { validateFeatureName } from '../workspace-manager/worktree-ops.js';
import { listProjectTargets, resolveWorkspaceForCwd } from './resolver.js';
import { createWorkspace, upsertProjectFromConfig } from './writer.js';

const execFileAsync = promisify(execFile);

/** Kinds an operator may create by intent. `issue` workspaces are pipeline-owned. */
export type WorkspaceCreateKind = 'scratch' | 'main';

/** The field a finding belongs against, so a form can render it inline. */
export type WorkspaceIntentField = 'name' | 'project' | 'targetPath' | 'parentBranch';

export type WorkspaceIntentCode =
  | 'invalid-name'
  | 'mode-conflict'
  | 'project-not-found'
  | 'project-ambiguous'
  | 'target-not-a-directory'
  | 'path-exists';

/**
 * A validation problem. `message` is surface-neutral prose for a UI; `detail`
 * carries the offending value so a caller (the CLI) can render its own phrasing
 * without re-deriving anything.
 */
export interface WorkspaceIntentFinding {
  field: WorkspaceIntentField;
  code: WorkspaceIntentCode;
  message: string;
  detail?: string;
}

/**
 * The resolved-intent payload `pan workspace new --dry-run` prints, verbatim
 * and in this key order (PAN-3286 FR-2). Kept as its own type so both the CLI
 * and the resolve route serialize exactly the same nine fields.
 */
export interface WorkspaceIntentDryRun {
  projectId: string | null;
  kind: WorkspaceCreateKind;
  name: string;
  path: string | null;
  branchName: string | null;
  parentBranch: string | null;
  parentBranchGuessed: boolean;
  isGitRepository: boolean;
  wouldCreateWorktree: boolean;
}

export interface ResolvedWorkspaceIntent extends WorkspaceIntentDryRun {
  /** True when `path` sits under no registered target for the project — informational, never an error. */
  unregisteredTargetPath: boolean;
  /** Empty when the intent is ready to perform. */
  findings: WorkspaceIntentFinding[];
}

export interface WorkspaceCreateInput {
  /** Required for `scratch`; defaults to `'main'` for `kind: 'main'`. */
  name?: string;
  /** Defaults to `'scratch'`. */
  kind?: WorkspaceCreateKind;
  /** Explicit project key. Preferred — a browser request has no cwd to infer from. */
  projectKey?: string;
  /** Fallback disambiguation for CLI callers; this module never reads an ambient one. */
  cwd?: string;
  /** Bypass the parent-branch memo — set on the resolve that precedes a write. */
  refreshParentBranch?: boolean;
  isolated?: boolean;
  targetPath?: string;
  parentBranch?: string;
}

interface ResolvedProjectRef {
  key: string;
  config: ProjectConfig;
}

/** True when `path` exists and is a directory. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** True when anything exists at `path`. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** True when `<dir>/.git` exists — the same signal the CLI has always used. */
async function looksLikeGitRepository(dir: string): Promise<boolean> {
  return pathExists(join(dir, '.git'));
}

/** True when `path` equals, or is nested under, `candidate`. */
function isPathUnder(path: string, candidate: string): boolean {
  return path === candidate || path.startsWith(candidate.endsWith('/') ? candidate : `${candidate}/`);
}

type ProjectRefResult = { ref: ResolvedProjectRef } | { finding: WorkspaceIntentFinding };

/** Resolve an explicit key, else the sole registered project, else the caller's cwd. */
async function resolveProjectRef(projectKey?: string, cwd?: string): Promise<ProjectRefResult> {
  const all = await listProjectsAsync();
  if (projectKey) {
    const found = all.find((p) => p.key === projectKey);
    if (!found) {
      return {
        finding: {
          field: 'project',
          code: 'project-not-found',
          message: `No project registered with key '${projectKey}'.`,
          detail: projectKey,
        },
      };
    }
    return { ref: found };
  }
  if (all.length === 1) return { ref: all[0] };
  if (cwd) {
    const ws = resolveWorkspaceForCwd(cwd);
    if (ws) {
      const fromCwd = all.find((p) => p.key === ws.projectId);
      if (fromCwd) return { ref: fromCwd };
    }
  }
  return {
    finding: {
      field: 'project',
      code: 'project-ambiguous',
      message: `Multiple projects are registered — choose one.`,
    },
  };
}

/**
 * Short-lived memo of the inferred parent branch per checkout. The dialog
 * re-resolves on every settled field change, and spawning `git rev-parse` for
 * an edit to an unrelated field is pure waste; a checkout's current branch
 * does not change on a keystroke timescale (PAN-3330 review). The mutation
 * path passes `refreshParentBranch` so the value written to the row is always
 * freshly read.
 */
const PARENT_BRANCH_TTL_MS = 3_000;
const parentBranchCache = new Map<string, { branch: string | null; readAt: number }>();

async function inferParentBranch(cwd: string, refresh = false): Promise<string | null> {
  const cached = parentBranchCache.get(cwd);
  if (!refresh && cached && Date.now() - cached.readAt < PARENT_BRANCH_TTL_MS) {
    return cached.branch;
  }
  let branch: string | null = null;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    const value = String(stdout).trim();
    branch = value && value !== 'HEAD' ? value : null;
  } catch {
    branch = null;
  }
  parentBranchCache.set(cwd, { branch, readAt: Date.now() });
  return branch;
}

/** Test seam — the memo is process-global, so suites must be able to clear it. */
export function clearParentBranchCache(): void {
  parentBranchCache.clear();
}

/** Upsert the projects row for a registered project key (idempotent). */
export async function ensureProjectSeeded(projectKey: string): Promise<void> {
  const project = (await listProjectsAsync()).find((p) => p.key === projectKey);
  if (!project) throw new Error(`No project registered with key '${projectKey}'.`);
  upsertProjectFromConfig(project.key, project.config);
}

/** Project the resolved intent down to the nine dry-run fields, in their canonical order. */
export function toDryRunPayload(intent: ResolvedWorkspaceIntent): WorkspaceIntentDryRun {
  return {
    projectId: intent.projectId,
    kind: intent.kind,
    name: intent.name,
    path: intent.path,
    branchName: intent.branchName,
    parentBranch: intent.parentBranch,
    parentBranchGuessed: intent.parentBranchGuessed,
    isGitRepository: intent.isGitRepository,
    wouldCreateWorktree: intent.wouldCreateWorktree,
  };
}

/**
 * Resolve a creation intent into its concrete outcome. Read-only: no registry
 * row, no project row, no worktree, no memory home. Validation problems are
 * returned as `findings` in the order the CLI has always checked them, so a
 * caller that wants fail-fast semantics can simply take `findings[0]`.
 */
export async function resolveWorkspaceCreateIntent(input: WorkspaceCreateInput): Promise<ResolvedWorkspaceIntent> {
  const kind: WorkspaceCreateKind = input.kind ?? 'scratch';
  const name = kind === 'main' ? (input.name ?? 'main') : (input.name ?? '');
  const findings: WorkspaceIntentFinding[] = [];
  const intent: ResolvedWorkspaceIntent = {
    projectId: null,
    kind,
    name,
    path: null,
    branchName: null,
    parentBranch: null,
    parentBranchGuessed: false,
    isGitRepository: false,
    wouldCreateWorktree: false,
    unregisteredTargetPath: false,
    findings,
  };

  if (kind === 'scratch') {
    // The name becomes a literal path segment (`scratch-<name>`) and a git ref
    // fragment (`scratch/<name>`), so separators, `..`, spaces and other
    // ref-invalid characters are rejected up front rather than producing an
    // unexpected nested path or failing late inside git.
    if (!validateFeatureName(name)) {
      findings.push({
        field: 'name',
        code: 'invalid-name',
        message: `Use letters, numbers, and hyphens only.`,
        detail: name,
      });
    }
    if (input.targetPath && input.isolated) {
      findings.push({
        field: 'targetPath',
        code: 'mode-conflict',
        message: `A target directory cannot be combined with an isolated worktree.`,
      });
    }
  }

  // Fail fast, exactly as the CLI always has: with the name rejected or the
  // mode undetermined, everything downstream — the project lookup, the git
  // rev-parse, the filesystem stats — would be derived from input we have
  // already refused, so we touch neither git nor the filesystem.
  if (findings.length > 0) return intent;

  const project = await resolveProjectRef(input.projectKey, input.cwd);
  if ('finding' in project) {
    findings.push(project.finding);
    return intent;
  }
  const { key, config } = project.ref;
  intent.projectId = key;

  if (kind === 'scratch') {
    const parentBranch = input.parentBranch ?? (await inferParentBranch(config.path, input.refreshParentBranch));
    intent.parentBranch = parentBranch;
    intent.parentBranchGuessed = !input.parentBranch && parentBranch !== null;
  }

  if (kind === 'main') {
    intent.path = config.path;
    intent.isGitRepository = await looksLikeGitRepository(config.path);
  } else if (input.targetPath) {
    const resolvedTarget = resolve(input.targetPath);
    if (!(await isDirectory(resolvedTarget))) {
      findings.push({
        field: 'targetPath',
        code: 'target-not-a-directory',
        message: `Not an existing directory: ${input.targetPath}`,
        detail: input.targetPath,
      });
    } else {
      intent.path = resolvedTarget;
      const registeredPaths = [config.path, ...listProjectTargets(key).map((t) => t.path)];
      intent.unregisteredTargetPath = !registeredPaths.some((candidate) => isPathUnder(resolvedTarget, candidate));
      intent.isGitRepository = await looksLikeGitRepository(resolvedTarget);
    }
  } else if (input.isolated) {
    const workspaceConfig = config.workspace || getDefaultWorkspaceConfigSync();
    const workspacesDir = join(config.path, workspaceConfig.workspaces_dir || 'workspaces');
    const worktreePath = join(workspacesDir, `scratch-${name}`);
    if (await pathExists(worktreePath)) {
      findings.push({
        field: 'name',
        code: 'path-exists',
        message: `Path already exists: ${worktreePath}`,
        detail: worktreePath,
      });
    } else {
      intent.path = worktreePath;
      intent.branchName = `scratch/${name}`;
      intent.wouldCreateWorktree = true;
      intent.isGitRepository = true;
    }
  } else {
    intent.path = config.path;
    intent.isGitRepository = await looksLikeGitRepository(config.path);
  }

  return intent;
}

/**
 * Apply a resolved intent: create the worktree when the intent calls for one,
 * seed the project row, and write the workspace row through the writer door.
 *
 * Ordering matches the CLI's historical behavior — the worktree is created
 * before the project row is seeded, so a failed `git worktree add` leaves no
 * trace in the registry.
 */
export async function performWorkspaceCreate(intent: ResolvedWorkspaceIntent): Promise<{ id: string }> {
  if (intent.findings.length > 0) throw new Error(intent.findings[0].message);
  if (!intent.projectId || !intent.path) {
    throw new Error(`Workspace intent did not resolve to a project and path.`);
  }
  const project = (await listProjectsAsync()).find((p) => p.key === intent.projectId);
  if (!project) throw new Error(`No project registered with key '${intent.projectId}'.`);

  if (intent.wouldCreateWorktree && intent.branchName) {
    // A new worktree cannot check out `parentBranch` directly — it is normally
    // the project's currently-checked-out branch, and git refuses to have the
    // same branch checked out in two worktrees at once. Create a distinct
    // scratch branch off of it instead. Argument-vector spawn (execFile, not a
    // shell string) so name/path/parent-branch cannot inject metacharacters.
    // `--` terminates option parsing: an operator-supplied parent branch like
    // `--no-checkout` would otherwise be read by git as a flag and quietly
    // change how the worktree is made (PAN-3330 review).
    const worktreeArgs = intent.parentBranch
      ? ['worktree', 'add', '-b', intent.branchName, '--', intent.path, intent.parentBranch]
      : ['worktree', 'add', '-b', intent.branchName, '--', intent.path];
    await execFileAsync('git', worktreeArgs, { cwd: project.config.path });
  }

  await ensureProjectSeeded(project.key);
  const id = await createWorkspace({
    projectId: project.key,
    kind: intent.kind,
    name: intent.name,
    path: intent.path,
    branchName: intent.branchName ?? undefined,
    parentBranch: intent.parentBranch ?? undefined,
    parentBranchGuessed: intent.parentBranchGuessed,
    isGitRepository: intent.isGitRepository,
  });
  return { id };
}
