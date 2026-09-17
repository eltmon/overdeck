/**
 * The write half of project creation (PAN-3836 WI-1.4/1.5).
 *
 * `create.ts` resolves — it reads, validates and previews, and is safe to call
 * on every keystroke. This module is everything that changes the machine: the
 * clone or init, registration, and the setup that has to follow it. The split is
 * the module boundary the two doors already imply, and it keeps the read path
 * free of anything that can leave a half-made project behind.
 *
 * Two responsibilities live here that are easy to get wrong:
 *
 *   - **Owning the clone child.** One settlement guard, settle on `close` rather
 *     than `exit` so nothing deletes a directory the child can still write to,
 *     and SIGTERM → SIGKILL escalation so a cancel actually finishes.
 *   - **Making setup repeatable.** `finishProjectSetup` is idempotent, so the
 *     happy path and the repair path are the same code. Without that, a
 *     registration that succeeded before setup failed stranded a project which
 *     ordinary create could never retry, because the duplicate guard rejected it.
 *
 * Cleanup never guesses. A target is removed only when this operation created it
 * and its dev/inode/birthtime still match, because `rm -rf` on a path we no
 * longer own is the one mistake in here with no undo.
 */

import { execFile, spawn } from 'child_process';
import { mkdir, rm, stat, lstat, readFile, appendFile } from 'fs/promises';
import { join, dirname } from 'path';
import { promisify } from 'util';

import { getProjectSync, type ProjectConfig } from '../projects.js';
import { registerProjectFromPath, installGitHooksInDir } from '../project-registration.js';
import { ensureProjectLayer } from '../context-layers/index.js';
import { resolveWorkspaceCreateIntent, performWorkspaceCreate } from '../workspaces/create.js';
import { getMainWorkspace } from '../workspaces/resolver.js';
import {
  canonicalizePath,
  promptGuardGitEnv,
  type ProjectCreateHooks,
  type ProjectCreateResult,
  type ResolvedProjectIntent,
} from './create.js';
import {
  cancelledFailure,
  classifyGitFailure,
  sanitizeCreationFailure,
  setupIncompleteFailure,
  ProjectCreateFailureError,
  MAX_DETAIL_BYTES,
} from './create-errors.js';

const execFileAsync = promisify(execFile);

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

/**
 * Add the workspaces directory to `.git/info/exclude`, idempotently (D-8).
 *
 * Never the tracked `.gitignore`: a freshly cloned repository must not come back
 * dirty because Overdeck decided to edit a file the project owns. A `.git` file
 * means a linked worktree, whose gitdir lives elsewhere; rather than improvise a
 * second resolver for it, skip.
 */
async function excludeWorkspacesDir(root: string, dir: string): Promise<void> {
  const gitDir = join(root, '.git');
  try {
    const gitStats = await stat(gitDir);
    if (!gitStats.isDirectory()) return;
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
  if (lines.includes(`${dir}/`) || lines.includes(dir)) return;

  // A file whose last line has no newline would otherwise concatenate, producing
  // `*.logworkspaces/` — which breaks the previous pattern *and* fails to exclude.
  const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  await appendFile(excludeFile, `${prefix}${dir}/\n`);
}

/** How long a clone gets to exit after SIGTERM before it is killed outright. */
const CLONE_TERM_GRACE_MS = 5_000;

/**
 * Run `git clone`, owning its cancellation and its output (WI-1.4).
 *
 * Three things here are deliberate and were wrong before:
 *
 *   - **One settlement guard.** `exit`, `close`, `error`, abort and the deadline
 *     can all fire, sometimes in combination. Settling on the first one and
 *     ignoring the rest is what stops a cancelled clone from also reporting a
 *     spawn error, and stops cleanup from running twice.
 *   - **Settle on `close`, not `exit`.** `exit` fires when the process ends but
 *     its stdio may still be draining; deleting the target then races a child
 *     that can still write into it.
 *   - **Abort escalates.** SIGTERM first so git can unwind, then SIGKILL after a
 *     grace period, because a wedged transport ignores SIGTERM and the operator
 *     is waiting on a cancel that must actually finish.
 */
async function runClone(
  cloneUrl: string,
  targetPath: string,
  hooks: ProjectCreateHooks,
): Promise<void> {
  const signal = hooks.signal;
  if (signal?.aborted) throw new ProjectCreateFailureError(cancelledFailure());

  return new Promise<void>((resolveClone, rejectClone) => {
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let aborted = false;
    // A rolling tail rather than every chunk: `git clone --progress` repaints
    // continuously, so retaining all of it costs hundreds of KB for 20 useful lines.
    let stderrTail = '';

    const proc = spawn('git', ['clone', '--progress', '--', cloneUrl, targetPath], {
      env: promptGuardGitEnv(),
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const cleanup = (): void => {
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
    };

    const settle = (err?: ProjectCreateFailureError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) rejectClone(err);
      else resolveClone();
    };

    function onAbort(): void {
      if (settled || aborted) return;
      aborted = true;
      proc.kill('SIGTERM');
      killTimer = setTimeout(() => {
        // Still alive after the grace period: the transport is wedged and only
        // SIGKILL ends it. `close` below is what actually settles the promise.
        proc.kill('SIGKILL');
      }, CLONE_TERM_GRACE_MS);
      // Not unref'd on purpose: this timer must fire even if nothing else keeps
      // the loop alive, or a cancel would hang waiting on a process nobody killed.
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-MAX_DETAIL_BYTES);

      for (const line of text.split(/[\r\n]+/)) {
        // Git's own phase words, with a percentage local to that phase. There is
        // no honest overall percent to compute from them (D-13).
        const match = line.match(/^([\w ]+):\s+(\d+)%/);
        if (match) hooks.onProgress?.({ phase: match[1].trim(), percent: Number(match[2]) });
      }
    });

    proc.on('error', (err) => {
      // A spawn failure: there is no child, so nothing to wait for.
      settle(new ProjectCreateFailureError(sanitizeCreationFailure(err)));
    });

    proc.on('close', (code: number | null) => {
      if (aborted) {
        settle(new ProjectCreateFailureError(cancelledFailure(stderrTail)));
        return;
      }
      if (code === 0) {
        settle();
        return;
      }
      settle(
        new ProjectCreateFailureError(classifyGitFailure(stderrTail, { targetPath })),
      );
    });
  });
}

/**
 * Finish everything a registered project needs beyond its `projects.yaml` entry,
 * idempotently (D-9).
 *
 * This is split out of `performProjectCreate` for one reason: registration can
 * succeed and setup can then fail, which used to strand a registered project
 * that ordinary create could never retry (the duplicate guard rejected it) and
 * that nothing else could repair. Every step here is safe to run again, so the
 * repair path and the happy path are the same code.
 *
 * It never clones, never registers, and never overwrites configuration the
 * operator or a previous run already set.
 */
export async function finishProjectSetup(args: {
  key: string;
  expectedPath: string;
}): Promise<ProjectCreateResult> {
  const config = getProjectSync(args.key);
  if (!config) {
    throw new ProjectCreateFailureError({
      code: 'operation-unknown',
      message: `No project is registered under '${args.key}'.`,
      retrySafe: false,
    });
  }

  const canonicalRegistered = await canonicalizePath(config.path);
  const canonicalExpected = await canonicalizePath(args.expectedPath);
  if (canonicalRegistered !== canonicalExpected) {
    // Repairing the wrong project is worse than refusing: the caller's expected
    // path is a claim about identity, and it does not hold.
    throw new ProjectCreateFailureError({
      code: 'destination-conflict',
      message: `Project '${args.key}' is registered at ${canonicalRegistered}, not ${canonicalExpected}.`,
      retrySafe: false,
    });
  }

  // Context layer: seeds only when absent, so operator edits survive repair.
  const seededContextLayer = ensureProjectLayer(canonicalRegistered);

  try {
    const { preTrustDirectorySync } = await import('../workspace-manager.js');
    preTrustDirectorySync(canonicalRegistered);
  } catch {
    // Non-fatal: trust is a convenience, not a correctness requirement.
  }

  let hooksInstalled = 0;
  const rootGit = join(canonicalRegistered, '.git');
  try {
    await stat(rootGit);
    hooksInstalled = installGitHooksInDir(rootGit);
  } catch {
    // Not a git repository (a plain folder added as a project): nothing to hook.
  }

  await excludeWorkspacesDir(canonicalRegistered, config.workspace?.workspaces_dir || 'workspaces');

  const existingMain = getMainWorkspace(args.key);
  if (existingMain) {
    const canonicalMain = await canonicalizePath(existingMain.path);
    if (canonicalMain !== canonicalRegistered) {
      throw new ProjectCreateFailureError({
        code: 'destination-conflict',
        message: `The main workspace for '${args.key}' points at ${canonicalMain}, not ${canonicalRegistered}.`,
        retrySafe: false,
      });
    }
    return {
      key: args.key,
      name: config.name,
      path: canonicalRegistered,
      mainWorkspaceId: existingMain.id,
      seededContextLayer,
      hooksInstalled,
    };
  }

  const wsIntent = await resolveWorkspaceCreateIntent({ kind: 'main', projectKey: args.key });
  if (wsIntent.findings.length > 0) {
    throw new ProjectCreateFailureError(
      setupIncompleteFailure({
        key: args.key,
        path: canonicalRegistered,
        cause: wsIntent.findings[0].message,
      }),
    );
  }
  const mainWorkspace = await performWorkspaceCreate(wsIntent);

  return {
    key: args.key,
    name: config.name,
    path: canonicalRegistered,
    mainWorkspaceId: mainWorkspace.id,
    seededContextLayer,
    hooksInstalled,
  };
}

/**
 * Perform a resolved project creation: clone or init, register, finish setup.
 *
 * Success means the project is registered *and* its main workspace exists. A
 * failure after registration is reported as `setup-incomplete` carrying a repair
 * action, never as a generic error — because at that point the repository is on
 * disk and retrying create would either clone a second copy or hit the duplicate
 * guard forever.
 */
export async function performProjectCreate(
  intent: ResolvedProjectIntent,
  hooks: ProjectCreateHooks = {},
): Promise<ProjectCreateResult> {
  const blocking = intent.findings.filter((f) => f.code !== 'project-exists-here');
  if (blocking.length > 0) {
    throw new ProjectCreateFailureError({
      code: 'internal-error',
      message: blocking[0].message,
      retrySafe: false,
    });
  }
  if (!intent.key || !intent.path) {
    throw new ProjectCreateFailureError({
      code: 'internal-error',
      message: 'Project intent did not resolve to a key and path.',
      retrySafe: false,
    });
  }

  // Claim the target with a non-recursive mkdir so "we created it" is a fact,
  // not an inference (D-5). Only a directory this operation created may ever be
  // removed on failure; a pre-existing one is the operator's and stays.
  let createdTarget = false;
  let createdIdentity: DirectoryIdentity | null = null;
  if (intent.wouldClone || intent.wouldGitInit) {
    hooks.onProgress?.({ phase: 'preparing', percent: null });
    await mkdir(dirname(intent.path), { recursive: true });
    try {
      await mkdir(intent.path);
      createdTarget = true;
      createdIdentity = await readDirectoryIdentity(intent.path);
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
    await removeOwnedTarget(intent.path, createdTarget, createdIdentity);
    throw err instanceof ProjectCreateFailureError
      ? err
      : new ProjectCreateFailureError(sanitizeCreationFailure(err));
  }

  hooks.onProgress?.({ phase: 'registering', percent: null });

  let registeredKey: string;
  try {
    const registered = await registerProjectFromPath({
      path: intent.path,
      name: intent.name,
      extras: buildExtras(intent),
    });
    registeredKey = registered.key;
  } catch (err) {
    // registerProjectFromPath writes the config before its later steps, so a
    // throw does not prove nothing landed. Reread the canonical registry rather
    // than inferring from whether the promise rejected.
    const current = getProjectSync(intent.key);
    if (current && (await canonicalizePath(current.path)) === intent.path) {
      throw new ProjectCreateFailureError(
        setupIncompleteFailure({ key: intent.key, path: intent.path, cause: err }),
      );
    }
    await removeOwnedTarget(intent.path, createdTarget, createdIdentity);
    throw err instanceof ProjectCreateFailureError
      ? err
      : new ProjectCreateFailureError(sanitizeCreationFailure(err));
  }

  try {
    const result = await finishProjectSetup({ key: registeredKey, expectedPath: intent.path });
    hooks.onProgress?.({ phase: 'done', percent: 100 });
    return result;
  } catch (err) {
    // The repository exists and the project is registered. Deleting either to
    // "undo" would destroy a successful clone, so report the repair instead.
    if (err instanceof ProjectCreateFailureError) throw err;
    throw new ProjectCreateFailureError(
      setupIncompleteFailure({ key: registeredKey, path: intent.path, cause: err }),
    );
  }
}

/**
 * Enough of a directory's identity to tell "the one we made" from "a different
 * one that now sits at the same path".
 *
 * Inode alone is not enough: filesystems reuse a just-freed inode number, so a
 * directory deleted and recreated between our claim and our cleanup can present
 * the same `ino`. Creation time is what separates them.
 */
interface DirectoryIdentity {
  dev: number;
  ino: number;
  birthtimeMs: number;
}

async function readDirectoryIdentity(target: string): Promise<DirectoryIdentity | null> {
  try {
    const stats = await lstat(target);
    return {
      dev: stats.dev,
      ino: stats.ino,
      // Some filesystems report 0; ctime is the usable fallback there.
      birthtimeMs: stats.birthtimeMs || stats.ctimeMs,
    };
  } catch {
    return null;
  }
}

function sameDirectory(a: DirectoryIdentity, b: DirectoryIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeMs === b.birthtimeMs;
}

/**
 * Remove the target only if this operation created it and it is still the same
 * directory (D-5).
 *
 * `rm -rf` on a path we no longer own is the one mistake in this file with no
 * undo, so the bar is proof of identity, not absence of evidence: anything we
 * cannot confirm is ours is left exactly where it is.
 */
async function removeOwnedTarget(
  targetPath: string,
  created: boolean,
  identity: DirectoryIdentity | null,
): Promise<void> {
  if (!created || !identity) return;
  const current = await readDirectoryIdentity(targetPath);
  if (!current || !sameDirectory(current, identity)) return;
  try {
    if (!(await lstat(targetPath)).isDirectory()) return;
  } catch {
    return;
  }
  await rm(targetPath, { recursive: true, force: true });
}
