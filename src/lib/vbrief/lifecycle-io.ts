/**
 * vBRIEF Lifecycle IO
 *
 * Operations that move vBRIEFs between lifecycle directories, find them by
 * issue, and update plan.status atomically. These are the primitives used by
 * the pipeline transitions (complete-planning → proposed, approve → active,
 * post-merge → completed, close → cancelled) and by the `pan scope` manual
 * overrides.
 */

import { exec, spawn } from 'child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';

import { continueFilename, continueFilePath, appendSessionEntry, readContinueState, writeContinueState, type ContinueSessionEntry, type ContinueState } from './continue-state.js';
import {
  VBRIEF_LIFECYCLE_DIRS,
  ensureVBriefDirs,
  generateVBriefFilename,
  parseVBriefFilename,
  resolveVBriefDir,
  slugify,
  type VBriefLifecycleDir,
} from './lifecycle.js';
import { readPlan } from './io.js';
import { invalidateVBriefIndex } from './vbrief-index.js';
import type { VBriefDocument } from './types.js';

const execAsync = promisify(exec);

export interface FoundVBrief {
  /** Absolute path to the scope vBRIEF file. */
  path: string;
  /** Lifecycle directory the vBRIEF was found in. */
  lifecycleDir: VBriefLifecycleDir;
  /** Parsed vBRIEF document. */
  document: VBriefDocument;
  /** Issue ID extracted from the canonical filename. */
  issueId: string;
  /** Slug extracted from the canonical filename. */
  slug: string;
  /** Date prefix (YYYY-MM-DD) from the canonical filename. */
  date: string;
}

/**
 * Find the scope vBRIEF for an issue by scanning all lifecycle directories.
 * Returns the first match using priority order: proposed → active → completed
 * → cancelled. Filenames must follow the canonical convention; non-matching
 * files are ignored.
 *
 * Returns null if no vBRIEF is found for the issue.
 */
export function findVBriefByIssue(projectRoot: string, issueId: string): FoundVBrief | null {
  for (const lifecycleDir of VBRIEF_LIFECYCLE_DIRS) {
    const dirPath = resolveVBriefDir(projectRoot, lifecycleDir);
    if (!existsSync(dirPath)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const parts = parseVBriefFilename(entry);
      if (!parts || parts.issueId !== issueId) continue;
      const path = join(dirPath, entry);
      try {
        const document = readPlan(path);
        return { path, lifecycleDir, document, ...parts };
      } catch {
        // If a file matches the name pattern but is corrupt, skip it — better
        // to fall through to other lifecycle dirs than to crash the caller.
        continue;
      }
    }
  }
  return null;
}

/**
 * Update `plan.status` and refresh `plan.sequence` + `plan.updated` on the
 * scope vBRIEF at the given path. Atomic via temp+rename.
 */
export function updatePlanStatus(filePath: string, newStatus: string): void {
  const doc = readPlan(filePath);
  const now = new Date().toISOString();
  doc.plan.status = newStatus;
  doc.plan.sequence = (doc.plan.sequence ?? 0) + 1;
  doc.plan.updated = now;
  doc.vBRIEFInfo.updated = now;
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf-8');
  renameSync(tmp, filePath);
}

/**
 * Atomically move a scope vBRIEF (and its companion continue file, if any)
 * between lifecycle directories. Stages the changes with `git add` so the
 * caller only needs to commit. Idempotent if the source equals the target —
 * still re-stages so the caller can rely on the index reflecting reality.
 *
 * Returns the new absolute path of the scope vBRIEF.
 */
export async function moveVBrief(
  projectRoot: string,
  issueId: string,
  targetDir: VBriefLifecycleDir,
): Promise<{ from: FoundVBrief; toPath: string; movedContinue: boolean }> {
  const found = findVBriefByIssue(projectRoot, issueId);
  if (!found) {
    throw new Error(`No vBRIEF found for issue ${issueId} under ${projectRoot}`);
  }

  ensureVBriefDirs(projectRoot);
  const targetDirPath = resolveVBriefDir(projectRoot, targetDir);
  const filename = found.path.split('/').pop()!;
  const toPath = join(targetDirPath, filename);

  if (found.path !== toPath) {
    renameSync(found.path, toPath);
  }

  // Move continue file (if it exists) alongside the scope vBRIEF.
  const sourceContinueDir = resolveVBriefDir(projectRoot, found.lifecycleDir);
  const sourceContinue = continueFilePath(sourceContinueDir, issueId);
  const targetContinue = continueFilePath(targetDirPath, issueId);
  let movedContinue = false;
  if (existsSync(sourceContinue) && sourceContinue !== targetContinue) {
    renameSync(sourceContinue, targetContinue);
    movedContinue = true;
  } else if (existsSync(targetContinue)) {
    movedContinue = true; // continue file already in target dir (no-op move)
  }

  // Stage source removals and destination additions. `git add -A <path>` works
  // for both new files and removed paths so a single command per side suffices.
  const sourceVBriefPath = found.path;
  const sourceContinuePath = sourceContinue;
  const adds: string[] = [];
  const removes: string[] = [];
  removes.push(sourceVBriefPath);
  adds.push(toPath);
  if (movedContinue && sourceContinuePath !== targetContinue) {
    removes.push(sourceContinuePath);
    adds.push(targetContinue);
  }

  await runGitAdd(projectRoot, [...adds, ...removes]);

  invalidateVBriefIndex(projectRoot);
  return { from: found, toPath, movedContinue };
}

/**
 * Stage one or more paths with `git add -A --`. Skips silently when no paths
 * are provided. Errors from git propagate so callers see the failure.
 */
async function runGitAdd(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  // -A so removed paths get recorded as deletions; -- terminates option parsing
  // so paths starting with `-` aren't treated as flags.
  const quoted = paths.map(p => `"${p.replace(/"/g, '\\"')}"`).join(' ');
  await execAsync(`git add -A -- ${quoted}`, { cwd });
}

/**
 * Like {@link moveVBrief} but synchronous and without git staging — useful for
 * code paths (CLI, tests) that don't want to depend on git or async. The
 * caller is responsible for staging the result.
 */
export function moveVBriefFilesOnly(
  projectRoot: string,
  issueId: string,
  targetDir: VBriefLifecycleDir,
): { from: FoundVBrief; toPath: string; movedContinue: boolean } {
  const found = findVBriefByIssue(projectRoot, issueId);
  if (!found) {
    throw new Error(`No vBRIEF found for issue ${issueId} under ${projectRoot}`);
  }
  ensureVBriefDirs(projectRoot);
  const targetDirPath = resolveVBriefDir(projectRoot, targetDir);
  const filename = found.path.split('/').pop()!;
  const toPath = join(targetDirPath, filename);
  if (found.path !== toPath) {
    renameSync(found.path, toPath);
  }
  const sourceContinueDir = resolveVBriefDir(projectRoot, found.lifecycleDir);
  const sourceContinue = continueFilePath(sourceContinueDir, issueId);
  const targetContinue = continueFilePath(targetDirPath, issueId);
  let movedContinue = false;
  if (existsSync(sourceContinue) && sourceContinue !== targetContinue) {
    renameSync(sourceContinue, targetContinue);
    movedContinue = true;
  } else if (existsSync(targetContinue)) {
    movedContinue = true;
  }
  invalidateVBriefIndex(projectRoot);
  return { from: found, toPath, movedContinue };
}

/** Convenience: delete a vBRIEF file and its continue companion. */
export function deleteVBrief(projectRoot: string, issueId: string): boolean {
  const found = findVBriefByIssue(projectRoot, issueId);
  if (!found) return false;
  unlinkSync(found.path);
  const continuePath = continueFilePath(resolveVBriefDir(projectRoot, found.lifecycleDir), issueId);
  if (existsSync(continuePath)) unlinkSync(continuePath);
  invalidateVBriefIndex(projectRoot);
  return true;
}

/**
 * Result of {@link transitionVBriefOnMain}.
 */
export interface VBriefTransitionResult {
  /** Lifecycle dir the vBRIEF was found in before the move. */
  fromDir: VBriefLifecycleDir;
  /** Lifecycle dir the vBRIEF lives in now. */
  toDir: VBriefLifecycleDir;
  /** Absolute path of the vBRIEF after the transition. */
  toPath: string;
  /** True if a continue file was moved alongside the vBRIEF. */
  movedContinue: boolean;
  /** True if `plan.status` was changed (false if it was already at `newStatus`). */
  statusUpdated: boolean;
  /** True if a git commit was created on main. False if not on main, or nothing changed. */
  committed: boolean;
  /** True if the vBRIEF actually moved between directories. False if it was already in target. */
  moved: boolean;
}

/**
 * Move a vBRIEF between lifecycle directories on the project root, update
 * `plan.status`, and commit on main with `commitMessage`. Idempotent: if the
 * vBRIEF is already in the target directory and has the target status, no
 * commit is created.
 *
 * The commit only happens if `projectRoot` is currently on the `main` branch.
 * Otherwise the on-disk move + status update still happens (so the file
 * reflects the new state) but no commit is created — a later sync or manual
 * commit can pick it up. This avoids accidentally committing onto a feature
 * branch when the user has the dashboard project root checked out elsewhere.
 *
 * Triggers a background `git push` after committing — non-fatal on failure.
 *
 * Throws when no vBRIEF exists for the issue.
 */
export async function transitionVBriefOnMain(
  projectRoot: string,
  issueId: string,
  targetDir: VBriefLifecycleDir,
  newStatus: string,
  commitMessage: string,
): Promise<VBriefTransitionResult> {
  const found = findVBriefByIssue(projectRoot, issueId);
  if (!found) {
    throw new Error(`No vBRIEF found for issue ${issueId} under ${projectRoot}`);
  }

  const needsMove = found.lifecycleDir !== targetDir;
  const needsStatus = found.document.plan.status !== newStatus;

  let toPath = found.path;
  let movedContinue = false;
  let fromContinuePath: string | null = null;
  let toContinuePath: string | null = null;

  if (needsMove) {
    const moveResult = moveVBriefFilesOnly(projectRoot, issueId, targetDir);
    toPath = moveResult.toPath;
    movedContinue = moveResult.movedContinue;
    fromContinuePath = continueFilePath(resolveVBriefDir(projectRoot, found.lifecycleDir), issueId);
    toContinuePath = continueFilePath(resolveVBriefDir(projectRoot, targetDir), issueId);
  }

  if (needsStatus) {
    updatePlanStatus(toPath, newStatus);
  }

  let committed = false;
  if (needsMove || needsStatus) {
    try {
      const { stdout: branchStdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectRoot,
        encoding: 'utf-8',
      });
      const currentBranch = branchStdout.trim();
      if (currentBranch === 'main') {
        // Stage the destination + (if moved) the source so the rename is recorded.
        const stageList: string[] = [toPath];
        if (needsMove) {
          stageList.push(found.path);
        }
        if (movedContinue && fromContinuePath && toContinuePath) {
          stageList.push(toContinuePath);
          stageList.push(fromContinuePath);
        }
        await runGitAdd(projectRoot, stageList);

        const quotedAll = stageList
          .map(p => `"${p.replace(/"/g, '\\"')}"`)
          .join(' ');
        try {
          await execAsync(`git diff --cached --quiet -- ${quotedAll}`, {
            cwd: projectRoot,
            encoding: 'utf-8',
          });
          // exit 0 → nothing staged for our paths → no commit needed
        } catch {
          await execAsync(
            `git commit -m ${JSON.stringify(commitMessage)} -- ${quotedAll}`,
            { cwd: projectRoot, encoding: 'utf-8' },
          );
          committed = true;
          // Background push — non-fatal on failure (no remote, auth issue, etc).
          try {
            const { stdout: remotes } = await execAsync('git remote', {
              cwd: projectRoot,
              encoding: 'utf-8',
            });
            if (remotes.trim()) {
              const pushChild = spawn('git', ['push'], {
                cwd: projectRoot,
                detached: true,
                stdio: 'ignore',
              });
              pushChild.unref();
            }
          } catch {
            /* push setup failed — non-fatal */
          }
        }
      }
    } catch {
      // Branch detection or git ops failed — leave on-disk state in place but
      // don't propagate a commit error. Caller can detect via `committed` flag.
    }
  }

  if (needsMove || needsStatus) {
    invalidateVBriefIndex(projectRoot);
  }

  return {
    fromDir: found.lifecycleDir,
    toDir: targetDir,
    toPath,
    movedContinue,
    statusUpdated: needsStatus,
    committed,
    moved: needsMove,
  };
}

/** Internal helper exported for tests — verify a file exists and is JSON. */
export function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Copy a workspace's scope vBRIEF (and its continue file, if present) from
 * `<workspacePath>/.planning/` to `<projectRoot>/vbrief/proposed/<canonical>`.
 *
 * Reads `plan.metadata.canonicalFilename` if present (set by `pan plan-finalize`),
 * otherwise generates one from the plan's title (or id, or issue ID) using the
 * same algorithm as `stampPlanForFinalization`.
 *
 * Sync — caller is responsible for git staging/commit. Returns the absolute
 * destination paths so the caller can stage them.
 *
 * Throws if the workspace plan doesn't exist.
 */
export interface PromotedVBrief {
  destVBrief: string;
  destContinue: string | null;
  canonicalFilename: string;
}

export function promoteVBriefToProposed(
  workspacePath: string,
  projectRoot: string,
  issueId: string,
): PromotedVBrief {
  const planningDir = join(workspacePath, '.planning');
  const sourceVBrief = join(planningDir, 'plan.vbrief.json');
  if (!existsSync(sourceVBrief)) {
    throw new Error(`No plan.vbrief.json found at ${sourceVBrief}`);
  }

  const planDoc = readPlan(sourceVBrief);
  const upperIssueId = issueId.toUpperCase();
  const existingFilename = planDoc.plan.metadata?.canonicalFilename;
  const canonicalFilename = (existingFilename && typeof existingFilename === 'string')
    ? existingFilename
    : generateVBriefFilename(upperIssueId, slugify(planDoc.plan.title || planDoc.plan.id || upperIssueId));

  ensureVBriefDirs(projectRoot);
  const proposedDir = resolveVBriefDir(projectRoot, 'proposed');
  const destVBrief = join(proposedDir, canonicalFilename);
  copyFileSync(sourceVBrief, destVBrief);

  const continueName = continueFilename(upperIssueId);
  const sourceContinue = join(planningDir, continueName);
  let destContinue: string | null = null;
  if (existsSync(sourceContinue)) {
    destContinue = join(proposedDir, continueName);
    copyFileSync(sourceContinue, destContinue);
  }

  invalidateVBriefIndex(projectRoot);
  return { destVBrief, destContinue, canonicalFilename };
}

/**
 * Resolve the directory where this issue's continue file should be read/written.
 * Returns the lifecycle directory containing the issue's scope vBRIEF when one
 * exists (so completed/cancelled vBRIEFs keep their continue history beside
 * them), and falls back to `vbrief/active/` for the bootstrap case where the
 * vBRIEF hasn't been promoted yet.
 *
 * Use this anywhere the dashboard or pipeline writes a continue-state
 * breadcrumb. Hard-coding `resolveVBriefDir(projectRoot, 'active')` would fork
 * session history by dropping new entries into `active/` after the vBRIEF has
 * already moved to `completed/` or `cancelled/`.
 */
export function resolveContinueStateDir(projectRoot: string, issueId: string): string {
  const found = findVBriefByIssue(projectRoot, issueId);
  if (found) {
    return resolveVBriefDir(projectRoot, found.lifecycleDir);
  }
  return resolveVBriefDir(projectRoot, 'active');
}

/**
 * Read the continue state for an issue from beside its current vBRIEF.
 * Lifecycle-aware: reads from completed/ or cancelled/ if the vBRIEF moved
 * there, otherwise from active/ (or the bootstrap location).
 */
export function readContinueStateForIssue(
  projectRoot: string,
  issueId: string,
): ContinueState | null {
  const dir = resolveContinueStateDir(projectRoot, issueId);
  return readContinueState(dir, issueId);
}

/**
 * Write the continue state beside the issue's current vBRIEF. Lifecycle-aware
 * — replaces hard-coded `writeContinueState(resolveVBriefDir(projectPath,
 * 'active'), ...)` calls so completed/cancelled history doesn't fork.
 */
export function writeContinueStateForIssue(
  projectRoot: string,
  issueId: string,
  state: ContinueState,
): void {
  const dir = resolveContinueStateDir(projectRoot, issueId);
  writeContinueState(dir, issueId, state);
}

/**
 * Append a session entry beside the issue's current vBRIEF. Lifecycle-aware
 * single source of truth — every breadcrumb write should go through this
 * helper rather than re-resolving `vbrief/active/` in route code.
 */
export function appendContinueSessionEntryForIssue(
  projectRoot: string,
  issueId: string,
  entry: Omit<ContinueSessionEntry, 'timestamp'> & { timestamp?: string },
): ContinueState {
  const dir = resolveContinueStateDir(projectRoot, issueId);
  return appendSessionEntry(dir, issueId, entry);
}
