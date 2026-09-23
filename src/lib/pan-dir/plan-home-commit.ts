/**
 * Commits in a plan home for the `.pan/` migration and the legacy ignore
 * repair (PAN-3996).
 *
 * Every commit here is pathspec-scoped (`git add -- <paths>` +
 * `git commit --only -- <paths>`), so staged or unstaged work outside those
 * paths never lands in it. A `.gitignore` edit made for a commit is undone
 * when that commit does not happen, so a failed run leaves the file exactly
 * as it found it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';

import {
  describePanIgnore,
  detectPanIgnore,
  removeLegacyPanIgnore,
  runPlanHomeGit,
  type PanIgnoreStatus,
} from './legacy-pan-ignore.js';

/**
 * A plan-home commit refused before it wrote anything, for a reason the
 * operator has to resolve. Git failures surface as `PlanHomeGitError`.
 */
export class MigratePlanHomeError extends Error {
  readonly _tag = 'MigratePlanHomeError' as const;

  constructor(
    readonly code: 'pan-ignored-by-foreign-rule' | 'gitignore-dirty' | 'state-already-migrated',
    message: string,
  ) {
    super(message);
    this.name = 'MigratePlanHomeError';
  }
}

export const IGNORE_REPAIR_COMMIT_SUBJECT = 'chore(workspace): stop git-ignoring .pan/ planning artifacts';

type LegacyPanIgnore = Extract<PanIgnoreStatus, { kind: 'legacy' }>;

/**
 * Refuse a commit that could not be made cleanly, before anything is written:
 * `.pan/` ignored by a rule that is not Overdeck's, or a `.gitignore` with
 * uncommitted changes that `git commit --only -- .gitignore` would sweep into
 * the commit along with the legacy-line removal. `untouched` says what the
 * refusal left alone, e.g. "Nothing was copied."
 */
export async function assertCommittable(planHome: string, panIgnore: PanIgnoreStatus, untouched: string): Promise<void> {
  if (panIgnore.kind === 'foreign') {
    throw new MigratePlanHomeError(
      'pan-ignored-by-foreign-rule',
      `.pan/ is ignored by ${describePanIgnore(panIgnore)}, which is not Overdeck's legacy line, so it was not `
      + `edited. ${untouched} Remove or narrow that rule, then rerun.`,
    );
  }
  if (panIgnore.kind !== 'legacy') return;
  const dirty = await runPlanHomeGit(planHome, ['status', '--porcelain', '--', panIgnore.source]);
  if (dirty.trim()) {
    throw new MigratePlanHomeError(
      'gitignore-dirty',
      `${panIgnore.source} has uncommitted changes; committing the legacy .pan/ line removal would sweep them `
      + `into the commit. Commit or revert them, then rerun. ${untouched}`,
    );
  }
}

export interface LegacyIgnoreRemoval {
  /** The edited `.gitignore`, relative to the plan home, when a line was removed. */
  readonly gitignore: string | null;
  /** Legacy lines removed, as numbered at the time of removal. */
  readonly lines: number[];
  /** Put `.gitignore` back byte-for-byte as it was before the removal. */
  restore(): Promise<void>;
}

/**
 * Remove Overdeck's legacy line(s) ahead of a commit. When another rule still
 * ignores `.pan/` afterwards, or the removal itself fails, `.gitignore` is
 * restored before the error is thrown.
 */
export async function removeLegacyLineForCommit(planHome: string, panIgnore: LegacyPanIgnore): Promise<LegacyIgnoreRemoval> {
  const original = await readFile(panIgnore.source);
  const restore = async (): Promise<void> => {
    await writeFile(panIgnore.source, original);
  };
  let repair: Awaited<ReturnType<typeof removeLegacyPanIgnore>>;
  try {
    repair = await removeLegacyPanIgnore(planHome);
  } catch (error) {
    await restore();
    throw error;
  }
  if (repair.status.kind === 'foreign') {
    await restore();
    throw new MigratePlanHomeError(
      'pan-ignored-by-foreign-rule',
      `.pan/ is also ignored by ${describePanIgnore(repair.status)}, which is not Overdeck's and was left alone. `
      + `Overdeck's legacy line in ${panIgnore.source} was kept and nothing was committed. `
      + 'Remove or narrow that rule, then rerun.',
    );
  }
  return {
    gitignore: repair.gitignorePath ? relative(planHome, repair.gitignorePath) : null,
    lines: repair.removed.map((entry) => entry.line),
    restore,
  };
}

/**
 * Stage exactly `paths` and commit only them (`git commit --only`). Returns
 * false when there was nothing to commit. On a git failure our staging is
 * undone (pathspec-scoped) and the `PlanHomeGitError` is rethrown.
 */
export async function commitOnly(planHome: string, paths: readonly string[], subject: string): Promise<boolean> {
  if (paths.length === 0) return false;
  try {
    await runPlanHomeGit(planHome, ['add', '--', ...paths]);
    const staged = await runPlanHomeGit(planHome, ['diff', '--cached', '--name-only', '--', ...paths]);
    if (!staged.trim()) return false;
    await runPlanHomeGit(planHome, ['commit', '--only', '-m', subject, '--', ...paths]);
    return true;
  } catch (error) {
    await runPlanHomeGit(planHome, ['reset', '-q', '--', ...paths]).catch(() => undefined);
    throw error;
  }
}

/** Of `paths` (relative to the plan home), the ones git reports as new, modified, or staged. */
export async function uncommittedPaths(planHome: string, paths: readonly string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  // Porcelain paths are relative to the repo root; the plan home may sit below it.
  const prefix = (await runPlanHomeGit(planHome, ['rev-parse', '--show-prefix'])).trim();
  const out = await runPlanHomeGit(planHome, ['status', '--porcelain', '-z', '--untracked-files=all', '--', ...paths]);
  const fields = out.split('\0');
  const dirty = new Set<string>();
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    dirty.add(path.startsWith(prefix) ? path.slice(prefix.length) : path);
    if (xy.includes('R') || xy.includes('C')) i += 1; // the rename/copy source follows
  }
  return paths.filter((path) => dirty.has(path));
}

export interface LegacyIgnoreRepairResult {
  /** The ignore status found before the repair. */
  readonly panIgnore: PanIgnoreStatus;
  /** Legacy lines removed and committed. Empty on a dry run or when there was nothing to remove. */
  readonly linesRemoved: number[];
  readonly committed: boolean;
}

/**
 * The repair on its own: remove Overdeck's legacy `.pan/` line and commit
 * `.gitignore` alone. No artifacts are copied and no tracker is consulted. A
 * `.gitignore` with other uncommitted changes, or a rule that is not
 * Overdeck's, is refused before anything is written; a failed commit restores
 * the line.
 */
export async function repairLegacyPanIgnore(
  planHome: string,
  options: { dryRun?: boolean } = {},
): Promise<LegacyIgnoreRepairResult> {
  const panIgnore = await detectPanIgnore(planHome);
  const nothing = { panIgnore, linesRemoved: [], committed: false };
  if (options.dryRun) return nothing;
  await assertCommittable(planHome, panIgnore, 'Nothing was changed.');
  if (panIgnore.kind !== 'legacy') return nothing;

  const removal = await removeLegacyLineForCommit(planHome, panIgnore);
  try {
    const committed = await commitOnly(
      planHome,
      removal.gitignore ? [removal.gitignore] : [],
      IGNORE_REPAIR_COMMIT_SUBJECT,
    );
    return { panIgnore, linesRemoved: removal.lines, committed };
  } catch (error) {
    await removal.restore();
    throw error;
  }
}
