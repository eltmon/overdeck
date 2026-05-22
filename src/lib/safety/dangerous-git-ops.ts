/**
 * Chokepoint for destructive git operations on a workspace.
 *
 * Every code path that wants to run `git clean`, `git checkout -- .`, or any
 * other op that can wipe untracked agent artifacts MUST go through this module.
 * Direct `execAsync('git clean ...')` calls are forbidden — see the lint rule
 * in `.claude/rules/no-direct-git-clean.md`.
 *
 * Design (per CLAUDE.md "no bandaids", confirmed in the original audit that
 * found `.devcontainer/` was being silently destroyed by an automatic
 * `git clean -fd -e .pan -e .beads`):
 *
 *   - `git clean` is HARD-FAILED for any non-user caller. Agents and dashboard
 *     auto-flows can never trigger it. There is no `userToken`, no override,
 *     no escape hatch. The only way to run it is via `pan workspace deep-clean
 *     <id>` from an interactive TTY.
 *   - Other dangerous ops (`git reset --hard`, `git checkout -- .`) are
 *     allowed but routed through this module so every call site is logged with
 *     a justification and a giant banner. This makes regressions visible.
 *
 * Errors from this module are structured (DangerousOpBlockedError) so callers
 * can render a useful message instead of a stack trace.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { Data, Effect } from 'effect';
import { GIT_CLEAN_EXCLUDES, gitCleanExcludeFlags } from './protected-paths.js';

const execAsync = promisify(exec);

export type DangerousOp =
  | 'git_clean'
  | 'git_reset_hard'
  | 'git_checkout_overwrite';

/**
 * Structured error returned when a dangerous op is blocked.
 *
 * Routes can catch this and serialize to JSON; the CLI can chalked-print it.
 */
export class DangerousOpBlockedError extends Error {
  readonly code = 'DANGEROUS_OP_BLOCKED';
  constructor(
    public readonly operation: DangerousOp,
    public readonly reason: string,
    public readonly recovery: string,
  ) {
    super(`[${operation}] blocked: ${reason}`);
    this.name = 'DangerousOpBlockedError';
  }

  toJSON() {
    return {
      code: this.code,
      operation: this.operation,
      reason: this.reason,
      recovery: this.recovery,
    };
  }
}

/**
 * Mark a banner around a destructive operation in the server logs so the
 * call site is impossible to miss when something later breaks.
 */
function dangerBanner(operation: DangerousOp, cwd: string, reason: string): void {
  const bar = '═'.repeat(72);
  console.warn(`\n${bar}`);
  console.warn(`⚠️  DANGEROUS GIT OPERATION: ${operation}`);
  console.warn(`   cwd:    ${cwd}`);
  console.warn(`   reason: ${reason}`);
  console.warn(bar + '\n');
}async function runGitCleanPromise(opts: {
  workspacePath: string;
  /** Must be `true` and the caller must have just confirmed at a TTY. */
  userInvoked: boolean;
  /** Free-text reason for log breadcrumbs. */
  reason: string;
  /** Additional `-e` excludes layered on top of GIT_CLEAN_EXCLUDES. */
  extraExcludes?: readonly string[];
  /** Timeout (ms). Default 30s. */
  timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string }> {
  if (!opts.userInvoked) {
    throw new DangerousOpBlockedError(
      'git_clean',
      `git clean refused — agent / auto flow attempted to wipe untracked files in ${opts.workspacePath}. ` +
        `Reason given: ${opts.reason}. This op can only run after explicit user confirmation.`,
      `Run \`pan workspace deep-clean ${pathLeaf(opts.workspacePath)}\` from a terminal. ` +
        `That command will list what would be deleted and ask you to confirm interactively.`,
    );
  }

  dangerBanner('git_clean', opts.workspacePath, opts.reason);
  const excludes = gitCleanExcludeFlags(opts.extraExcludes ?? []);
  const cmd = `git clean -fd ${excludes}`;
  console.warn(`[dangerous-git-ops] running: ${cmd}`);
  return execAsync(cmd, {
    cwd: opts.workspacePath,
    encoding: 'utf-8',
    timeout: opts.timeoutMs ?? 30_000,
  });
}async function dryRunGitCleanPromise(opts: {
  workspacePath: string;
  extraExcludes?: readonly string[];
}): Promise<string[]> {
  const excludes = gitCleanExcludeFlags(opts.extraExcludes ?? []);
  const { stdout } = await execAsync(`git clean -fdn ${excludes}`, {
    cwd: opts.workspacePath,
    encoding: 'utf-8',
    timeout: 15_000,
  });
  return stdout
    .split('\n')
    .map(l => l.replace(/^Would remove\s+/, '').trim())
    .filter(Boolean);
}async function runGitResetHardPromise(opts: {
  workspacePath: string;
  /** What to reset to (e.g. "ORIG_HEAD", "HEAD~1", a SHA). */
  ref: string;
  /** Why this op is happening — appears in the banner. */
  reason: string;
  timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string }> {
  dangerBanner('git_reset_hard', opts.workspacePath, `${opts.reason} → ${opts.ref}`);
  return execAsync(`git reset --hard ${shellEscape(opts.ref)}`, {
    cwd: opts.workspacePath,
    encoding: 'utf-8',
    timeout: opts.timeoutMs ?? 15_000,
  });
}async function runGitCheckoutOverwritePromise(opts: {
  workspacePath: string;
  /** Ref to read files from (e.g. "main", "HEAD"). */
  ref: string;
  reason: string;
  timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string }> {
  dangerBanner('git_checkout_overwrite', opts.workspacePath, `${opts.reason} ← ${opts.ref}`);
  return execAsync(`git checkout ${shellEscape(opts.ref)} -- .`, {
    cwd: opts.workspacePath,
    encoding: 'utf-8',
    timeout: opts.timeoutMs ?? 30_000,
  });
}

function shellEscape(s: string): string {
  // refs are alnum + a small set of punctuation; reject anything weird.
  if (!/^[A-Za-z0-9_./~^@-]+$/.test(s)) {
    throw new Error(`Refusing unsafe ref: ${JSON.stringify(s)}`);
  }
  return s;
}

function pathLeaf(p: string): string {
  const idx = p.lastIndexOf('/');
  const leaf = idx >= 0 ? p.slice(idx + 1) : p;
  // feature-min-846 -> min-846
  return leaf.replace(/^feature-/, '');
}

/** Re-export for convenience so callers don't need a second import. */
export { GIT_CLEAN_EXCLUDES };

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Additive Effect-channel variants. The sync/promise variants above are
// preserved so existing CLI and route callers keep working; new Effect-based
// callers can compose without `Effect.runPromise` round-tripping.

/** Tagged error for dangerous-git-ops Effect variants. */
export class DangerousGitOpError extends Data.TaggedError('DangerousGitOpError')<{
  readonly operation: DangerousOp;
  readonly reason: string;
  readonly recovery?: string;
  readonly cause?: unknown;
}> {}

/** Effect variant of `runGitClean`. Fails with DangerousGitOpError on block or shell failure. */
export const runGitClean = (opts: {
  workspacePath: string;
  userInvoked: boolean;
  reason: string;
  extraExcludes?: readonly string[];
  timeoutMs?: number;
}): Effect.Effect<{ stdout: string; stderr: string }, DangerousGitOpError> =>
  Effect.tryPromise({
    try: () => runGitCleanPromise(opts),
    catch: (cause) => {
      if (cause instanceof DangerousOpBlockedError) {
        return new DangerousGitOpError({
          operation: cause.operation,
          reason: cause.reason,
          recovery: cause.recovery,
          cause,
        });
      }
      return new DangerousGitOpError({
        operation: 'git_clean',
        reason: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
    },
  });

/** Effect variant of `dryRunGitClean`. */
export const dryRunGitClean = (opts: {
  workspacePath: string;
  extraExcludes?: readonly string[];
}): Effect.Effect<string[], DangerousGitOpError> =>
  Effect.tryPromise({
    try: () => dryRunGitCleanPromise(opts),
    catch: (cause) =>
      new DangerousGitOpError({
        operation: 'git_clean',
        reason: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `runGitResetHard`. */
export const runGitResetHard = (opts: {
  workspacePath: string;
  ref: string;
  reason: string;
  timeoutMs?: number;
}): Effect.Effect<{ stdout: string; stderr: string }, DangerousGitOpError> =>
  Effect.tryPromise({
    try: () => runGitResetHardPromise(opts),
    catch: (cause) =>
      new DangerousGitOpError({
        operation: 'git_reset_hard',
        reason: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `runGitCheckoutOverwrite`. */
export const runGitCheckoutOverwrite = (opts: {
  workspacePath: string;
  ref: string;
  reason: string;
  timeoutMs?: number;
}): Effect.Effect<{ stdout: string; stderr: string }, DangerousGitOpError> =>
  Effect.tryPromise({
    try: () => runGitCheckoutOverwritePromise(opts),
    catch: (cause) =>
      new DangerousGitOpError({
        operation: 'git_checkout_overwrite',
        reason: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
