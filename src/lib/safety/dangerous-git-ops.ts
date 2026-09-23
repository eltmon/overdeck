/**
 * Chokepoint for destructive git operations on a workspace.
 *
 * Every code path that wants to run `git clean`, `git checkout -- .`, or any
 * other op that can wipe untracked agent artifacts MUST go through this module.
 * Direct `execAsync('git clean ...')` calls are forbidden — this module is the
 * only sanctioned door.
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
}

/**
 * Run `git clean -fd` with the protected-path excludes. Rejects with
 * {@link DangerousOpBlockedError} when the call is not user-invoked, and with the
 * shell error otherwise.
 */
export async function runGitClean(opts: {
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
}

/** List the paths `git clean -fd` would remove (dry run, same excludes). */
export async function dryRunGitClean(opts: {
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
}

/** Run `git reset --hard <ref>` in a workspace, with the danger banner. */
export async function runGitResetHard(opts: {
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
