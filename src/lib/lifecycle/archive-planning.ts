/**
 * archive-planning — PRD active→completed + workspace .pan/ preservation.
 *
 * Consolidates PRD moving from close-out.ts, merge-agent.ts, and the
 * approve endpoint into a single idempotent operation.
 *
 * Steps:
 *   1. Move PRD from docs/prds/active/ → docs/prds/completed/ (git mv, fallback to copy)
 *   2. Archive workspace .pan/ artifacts to ~/.panopticon/archives/<issue>/
 *   3. Rotate previous archives to prevent overwrite
 */

import { existsSync } from 'fs';
import { mkdir, cp, rename } from 'fs/promises';
import { join, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import {
  ARCHIVES_DIR,
  PROJECT_DOCS_SUBDIR,
  PROJECT_PRDS_SUBDIR,
  PROJECT_PRDS_ACTIVE_SUBDIR,
  PROJECT_PRDS_COMPLETED_SUBDIR,
} from '../paths.js';
import {
  PAN_CONTINUE_FILENAME,
  PAN_CONTEXT_FILENAME,
  PAN_DIRNAME,
  PAN_FEEDBACK_DIRNAME,
  PAN_SESSIONS_FILENAME,
  PAN_SPEC_FILENAME,
} from '../pan-dir/index.js';
import { findPrdAtStatus, canonicalPrdSubdir } from '../prd-locations.js';
import type { LifecycleContext, StepResult, ArchiveOptions } from './types.js';
import { stepOk, stepSkipped, stepFailed } from './types.js';

const execAsync = promisify(exec);

/**
 * Find ALL workspace paths matching an issue across canonical and legacy
 * naming conventions. Returns every candidate that exists on disk, so callers
 * (especially teardown) can clean up drift where the same issue ended up with
 * both `feature-pan-XXXX` and `feature-XXXX` directories. Order is canonical
 * → legacy, so first-match callers still prefer the canonical form.
 */
export function findAllWorkspacePaths(projectPath: string, issueLower: string): string[] {
  // e.g. "pan-488" → "488" for legacy workspaces named feature-488
  const numericSuffix = issueLower.replace(/^[a-z]+-/, '');
  const candidates = [
    join(projectPath, 'workspaces', `feature-${issueLower}`),
    join(projectPath, 'workspaces', `feature-${numericSuffix}`),
    join(projectPath, 'workspaces', issueLower),
    join(projectPath, '.worktrees', issueLower),
    join(dirname(projectPath), `feature-${issueLower}`),
  ];
  return candidates.filter((p) => existsSync(p));
}

/**
 * Find the workspace path for an issue.
 * Checks multiple conventional locations, including legacy numeric-suffix naming.
 * Prefer findAllWorkspacePaths when cleaning up — this only returns the first match.
 */
export function findWorkspacePath(projectPath: string, issueLower: string): string | null {
  return findAllWorkspacePaths(projectPath, issueLower)[0] ?? null;
}

/**
 * Move PRD from active/ to completed/ directory.
 * Uses git mv with fallback to plain copy. Idempotent — skips if already completed.
 */
export function movePrd(
  ctx: LifecycleContext,
  opts: ArchiveOptions = {},
): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => movePrdImpl(ctx, opts),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('archive-planning:move-prd', `Failed to preserve PRD: ${(err as Error).message}`)),
    ),
  );
}

async function movePrdImpl(
  ctx: LifecycleContext,
  opts: ArchiveOptions,
): Promise<StepResult> {
  const { pushToRemote = true } = opts;
  const step = 'archive-planning:move-prd';

  // Idempotent skip: if any completed PRD already exists in any format, we're done.
  if (findPrdAtStatus(ctx.projectPath, ctx.issueId, 'completed')) {
    return stepSkipped(step, ['PRD already in completed/']);
  }

  // Find source PRD in active/ in any format/case (subdir lower/upper, flat lower/upper).
  const source = findPrdAtStatus(ctx.projectPath, ctx.issueId, 'active');
  if (!source) {
    return stepSkipped(step, ['No PRD found in active/ (may not have had one)']);
  }

  // Destination is always the canonical lowercase form, mirroring source format.
  const issueLower = ctx.issueId.toLowerCase();
  const completedSubdir = canonicalPrdSubdir(ctx.projectPath, ctx.issueId, 'completed');
  const completedFlat = join(
    ctx.projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR,
    PROJECT_PRDS_COMPLETED_SUBDIR, `${issueLower}-plan.md`,
  );
  const dest = source.format === 'subdir' ? completedSubdir : completedFlat;
  const destParent = dirname(dest);
  if (!existsSync(destParent)) {
    await mkdir(destParent, { recursive: true });
  }

  const formatLabel = source.format === 'subdir' ? 'PRD subdirectory' : 'PRD';

  // For the legacy `flat` format the PRD is a single `.md` file, but the vBRIEF
  // JSON sidecar (`<id>-plan.vbrief.json`) lives next to it and was historically
  // left behind in active/ after merge (PAN-487). Detect it here so we can move
  // it alongside the `.md`. The `subdir` format already moves both files because
  // they share the directory.
  const flatActive = source.format === 'flat'
    ? join(ctx.projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR, PROJECT_PRDS_ACTIVE_SUBDIR)
    : null;
  const flatCompleted = source.format === 'flat'
    ? join(ctx.projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR, PROJECT_PRDS_COMPLETED_SUBDIR)
    : null;
  const sidecarLower = flatActive ? join(flatActive, `${issueLower}-plan.vbrief.json`) : null;
  const sidecarUpper = flatActive ? join(flatActive, `${ctx.issueId.toUpperCase()}-plan.vbrief.json`) : null;
  // Always land sidecar at canonical lowercase in completed/.
  const sidecarDest = flatCompleted ? join(flatCompleted, `${issueLower}-plan.vbrief.json`) : null;
  const resolvedSidecarSource = sidecarLower && existsSync(sidecarLower)
    ? sidecarLower
    : (sidecarUpper && existsSync(sidecarUpper) ? sidecarUpper : null);

  try {
    await execAsync(`git mv "${source.path}" "${dest}"`, { cwd: ctx.projectPath });
    if (resolvedSidecarSource && sidecarDest) {
      try {
        await execAsync(`git mv "${resolvedSidecarSource}" "${sidecarDest}"`, { cwd: ctx.projectPath });
      } catch {
        // sidecar may not be tracked — fall back to plain copy
        try { await cp(resolvedSidecarSource, sidecarDest); } catch { /* non-fatal */ }
      }
    }
    await execAsync(`git commit -m "Move ${ctx.issueId} PRD to completed"`, { cwd: ctx.projectPath });
    if (pushToRemote) {
      await execAsync('git push', { cwd: ctx.projectPath });
    }
    const sidecarNote = resolvedSidecarSource ? ' (with vBRIEF sidecar)' : '';
    return stepOk(step, [`Moved ${formatLabel} from active/ to completed/ via git mv${sidecarNote}`]);
  } catch {
    // git mv failed — fall back to plain copy. cp handles both file and directory.
    try {
      await cp(source.path, dest, { recursive: true });
      if (!existsSync(dest)) {
        return stepFailed(step, 'PRD copy appeared to succeed but destination not found');
      }
      if (resolvedSidecarSource && sidecarDest) {
        try { await cp(resolvedSidecarSource, sidecarDest); } catch { /* non-fatal */ }
      }
      return stepOk(step, [`Copied ${formatLabel} to completed/ (git mv failed, plain copy succeeded)`]);
    } catch (err) {
      return stepFailed(step, `Failed to preserve PRD: ${(err as Error).message}`);
    }
  }
}

/**
 * Archive workspace .pan/ artifacts to ~/.panopticon/archives/<issue>/.
 * Rotates previous archives to prevent overwrite.
 * Returns a hard failure if archiving fails — callers must NOT proceed with
 * workspace deletion after an archive failure.
 */
export function archiveWorkspaceArtifacts(
  ctx: LifecycleContext,
): Effect.Effect<StepResult> {
  return Effect.tryPromise({
    try: () => archiveWorkspaceArtifactsImpl(ctx),
    catch: (err) => err,
  }).pipe(
    Effect.catch((err) =>
      Effect.succeed(stepFailed('archive-planning:archive-artifacts', `Failed to archive: ${(err as Error).message}`)),
    ),
  );
}

async function archiveWorkspaceArtifactsImpl(
  ctx: LifecycleContext,
): Promise<StepResult> {
  const issueLower = ctx.issueId.toLowerCase();
  const step = 'archive-planning:archive-artifacts';

  const workspacePath = findWorkspacePath(ctx.projectPath, issueLower);
  if (!workspacePath || !existsSync(workspacePath)) {
    return stepSkipped(step, ['No workspace found to archive']);
  }

  let archiveDir = join(ARCHIVES_DIR, issueLower);

  // Rotate previous archive if it exists
  if (existsSync(archiveDir)) {
    let version = 1;
    while (existsSync(`${archiveDir}.${version}`)) {
      version++;
    }
    const rotatedDir = `${archiveDir}.${version}`;
    // Rename is O(1) metadata vs. copy+delete which is O(archive size). Both
    // paths live under ARCHIVES_DIR so they're on the same filesystem.
    await rename(archiveDir, rotatedDir);
  }

  await mkdir(archiveDir, { recursive: true });
  const details: string[] = [];

  const panDir = join(workspacePath, PAN_DIRNAME)

  const feedbackDir = join(panDir, PAN_FEEDBACK_DIRNAME)
  if (existsSync(feedbackDir)) {
    await cp(feedbackDir, join(archiveDir, 'feedback'), { recursive: true })
    details.push('Archived feedback/')
  }

  const continueFile = join(panDir, PAN_CONTINUE_FILENAME)
  if (existsSync(continueFile)) {
    await cp(continueFile, join(archiveDir, PAN_CONTINUE_FILENAME))
    details.push(`Archived ${PAN_CONTINUE_FILENAME}`)
  }

  const specFile = join(panDir, PAN_SPEC_FILENAME)
  if (existsSync(specFile)) {
    await cp(specFile, join(archiveDir, PAN_SPEC_FILENAME))
    details.push(`Archived ${PAN_SPEC_FILENAME}`)
  }

  const sessionsFile = join(panDir, PAN_SESSIONS_FILENAME)
  if (existsSync(sessionsFile)) {
    await cp(sessionsFile, join(archiveDir, PAN_SESSIONS_FILENAME))
    details.push(`Archived ${PAN_SESSIONS_FILENAME}`)
  }

  const contextFile = join(panDir, PAN_CONTEXT_FILENAME)
  if (existsSync(contextFile)) {
    await cp(contextFile, join(archiveDir, PAN_CONTEXT_FILENAME))
    details.push(`Archived ${PAN_CONTEXT_FILENAME}`)
  }

  const prdFile = join(panDir, 'prd.md')
  if (existsSync(prdFile)) {
    await cp(prdFile, join(archiveDir, 'prd.md'))
    details.push('Archived workspace prd.md')
  }

  const beadsDir = join(workspacePath, '.beads')
  if (existsSync(beadsDir)) {
    await cp(beadsDir, join(archiveDir, '.beads'), { recursive: true })
    details.push('Archived .beads/')
  }

  details.push(`Archived to ${archiveDir}`);
  return stepOk(step, details);
}

/**
 * Full archive-planning operation: move PRD + archive workspace artifacts.
 * Archive failure is a hard fail — do not proceed with workspace deletion.
 */
export function archivePlanning(
  ctx: LifecycleContext,
  opts: ArchiveOptions = {},
): Effect.Effect<StepResult[]> {
  return Effect.gen(function* () {
    const results: StepResult[] = [];
    const prdResult = yield* movePrd(ctx, opts);
    results.push(prdResult);
    const archiveResult = yield* archiveWorkspaceArtifacts(ctx);
    results.push(archiveResult);
    return results;
  });
}
