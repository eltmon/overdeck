/**
 * Auto-commit helper for operational state files (.pan/, .beads/).
 *
 * Background: planning and work agents continuously write to .pan/continues/,
 * .pan/specs/, .pan/drafts/, and .beads/issues.jsonl on the project root.
 * Without this helper those writes accumulate uncommitted on `main`, requiring
 * periodic manual "chore: sync workspace state" passes from the operator and
 * making the project repo stay perpetually dirty.
 *
 * This module exposes a fire-and-forget commit primitive that the pan-dir
 * writers call after they update a file. Commits are:
 *   - debounced (default 2s) so a burst of writes coalesces into one commit
 *   - serialized within a process so the git index is never contested
 *   - best-effort: failures are logged and never thrown back to the caller
 *   - main-only: feature branches have their own commit cadence owned by agents
 *
 * Cross-machine concern: when an agent's state is canonical on `main`, moving
 * the agent between machines becomes "stop on A, pull on B, resume on B." The
 * sync-state-via-commit shape this helper produces is the substrate for that.
 */

import { exec } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join, sep } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

const DEBOUNCE_MS = 2_000;

interface QueuedCommit {
  paths: Set<string>;
  subjects: string[];
  timer: NodeJS.Timeout;
}

interface FlushResult {
  committed: boolean;
  reason?: string;
}

const pending = new Map<string, QueuedCommit>();
let serializer: Promise<unknown> = Promise.resolve();

/**
 * Queue an auto-commit for one or more files. Returns immediately; the actual
 * git commit happens after the debounce window. Multiple calls for the same
 * project root inside the window coalesce.
 *
 * `paths` are absolute or project-relative paths. `subject` is the conventional
 * commit subject used when this call is the only one in the window — when
 * multiple subjects pile up, they batch under a generic "update N files"
 * message.
 */
export function queueAutoCommit(opts: {
  projectRoot: string;
  paths: string[];
  subject: string;
}): void {
  const { projectRoot, paths, subject } = opts;
  if (paths.length === 0) return;

  const existing = pending.get(projectRoot);
  if (existing) {
    paths.forEach(p => existing.paths.add(p));
    existing.subjects.push(subject);
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => void flush(projectRoot), DEBOUNCE_MS);
    return;
  }
  pending.set(projectRoot, {
    paths: new Set(paths),
    subjects: [subject],
    timer: setTimeout(() => void flush(projectRoot), DEBOUNCE_MS),
  });
}

/**
 * Force a flush of any pending commits for `projectRoot`. Useful for tests and
 * for shutdown paths that want to ensure operational state is persisted before
 * the process exits. Resolves after the commit attempt (success or no-op).
 */
export async function flushAutoCommits(projectRoot: string): Promise<FlushResult> {
  const batch = pending.get(projectRoot);
  if (!batch) return { committed: false, reason: 'no pending' };
  clearTimeout(batch.timer);
  return flush(projectRoot);
}

async function flush(projectRoot: string): Promise<FlushResult> {
  const batch = pending.get(projectRoot);
  if (!batch) return { committed: false, reason: 'no pending' };
  pending.delete(projectRoot);

  // Serialize across all projectRoots within this process so two concurrent
  // flushes don't trample git's index.
  const task = serializer.then(() => doCommit(projectRoot, batch));
  serializer = task.catch(() => undefined);
  return task;
}

async function doCommit(projectRoot: string, batch: QueuedCommit): Promise<FlushResult> {
  if (!existsSync(join(projectRoot, '.git'))) {
    return { committed: false, reason: 'not a git repo' };
  }

  // Only auto-commit on `main`. Feature/workspace branches have their own
  // commit cadence driven by work agents.
  let branch: string;
  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectRoot });
    branch = stdout.trim();
  } catch (err: any) {
    return { committed: false, reason: `branch check failed: ${err?.message ?? err}` };
  }
  if (branch !== 'main') {
    return { committed: false, reason: `not on main (${branch})` };
  }

  const paths = Array.from(batch.paths);
  const relativePaths = paths.map(p => relativizeToRoot(p, projectRoot));
  const quotedPaths = relativePaths.map(shellQuote).join(' ');

  try {
    await execAsync(`git add -- ${quotedPaths}`, { cwd: projectRoot });
    try {
      await execAsync(`git diff --cached --quiet -- ${quotedPaths}`, { cwd: projectRoot });
      // No diff staged for these paths.
      return { committed: false, reason: 'no diff' };
    } catch {
      // Diff present — proceed to commit.
    }

    const subject = batch.subjects.length === 1
      ? batch.subjects[0]
      : `chore(state): batch update ${relativePaths.length} pan/beads file(s)`;

    await execAsync(
      `git commit -m ${shellQuote(subject)} -- ${quotedPaths}`,
      { cwd: projectRoot },
    );
    return { committed: true };
  } catch (err: any) {
    // Best-effort: never break the calling write path because of a git hiccup.
    console.warn(`[pan-dir/auto-commit] failed for ${branch}: ${err?.message ?? err}`);
    return { committed: false, reason: err?.message ?? String(err) };
  }
}

/**
 * Find the project root for a `.pan/` or `.beads/` file path. Returns null
 * when the path is not under either marker.
 */
export function deriveProjectRoot(path: string): string | null {
  for (const marker of [`${sep}.pan${sep}`, `${sep}.beads${sep}`]) {
    const idx = path.indexOf(marker);
    if (idx !== -1) return path.slice(0, idx);
  }
  // Edge case: the path is the .pan/.beads directory itself.
  const base = dirname(path);
  if (base.endsWith(`${sep}.pan`) || base.endsWith(`${sep}.beads`)) {
    return dirname(base);
  }
  return null;
}

function relativizeToRoot(absOrRel: string, projectRoot: string): string {
  const rootPrefix = projectRoot.endsWith(sep) ? projectRoot : projectRoot + sep;
  if (absOrRel.startsWith(rootPrefix)) return absOrRel.slice(rootPrefix.length);
  return absOrRel;
}

function shellQuote(s: string): string {
  // POSIX-safe single-quote escape: end quote, escape the literal quote, re-open.
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
