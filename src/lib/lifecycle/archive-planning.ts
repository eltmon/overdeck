/**
 * archive-planning — PRD active→completed + .planning/ preservation.
 *
 * Consolidates PRD moving from close-out.ts, merge-agent.ts, and the
 * approve endpoint into a single idempotent operation.
 *
 * Steps:
 *   1. Move PRD from docs/prds/active/ → docs/prds/completed/ (git mv, fallback to copy)
 *   2. Archive workspace .planning/ artifacts to ~/.panopticon/archives/<issue>/
 *   3. Rotate previous archives to prevent overwrite
 */

import { existsSync } from 'fs';
import { mkdir, cp, rm, rename } from 'fs/promises';
import { join, dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  ARCHIVES_DIR,
  PROJECT_DOCS_SUBDIR,
  PROJECT_PRDS_SUBDIR,
  PROJECT_PRDS_ACTIVE_SUBDIR,
  PROJECT_PRDS_COMPLETED_SUBDIR,
} from '../paths.js';
import { findPrdAtStatus, canonicalPrdSubdir } from '../prd-locations.js';
import type { LifecycleContext, StepResult, ArchiveOptions } from './types.js';
import { stepOk, stepSkipped, stepFailed } from './types.js';

const execAsync = promisify(exec);

/**
 * Find the workspace path for an issue.
 * Checks multiple conventional locations, including legacy numeric-suffix naming.
 */
export function findWorkspacePath(projectPath: string, issueLower: string): string | null {
  // e.g. "pan-488" → "488" for legacy workspaces named feature-488
  const numericSuffix = issueLower.replace(/^[a-z]+-/, '');
  const candidates = [
    join(projectPath, 'workspaces', `feature-${issueLower}`),
    join(projectPath, 'workspaces', `feature-${numericSuffix}`),
    join(projectPath, 'workspaces', issueLower),
    join(projectPath, '.worktrees', issueLower),
    join(dirname(projectPath), `feature-${issueLower}`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Move PRD from active/ to completed/ directory.
 * Uses git mv with fallback to plain copy. Idempotent — skips if already completed.
 */
export async function movePrd(
  ctx: LifecycleContext,
  opts: ArchiveOptions = {},
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
 * Archive workspace .planning/ artifacts to ~/.panopticon/archives/<issue>/.
 * Rotates previous archives to prevent overwrite.
 * Returns a hard failure if archiving fails — callers must NOT proceed with
 * workspace deletion after an archive failure.
 */
export async function archiveWorkspaceArtifacts(
  ctx: LifecycleContext,
): Promise<StepResult> {
  const issueLower = ctx.issueId.toLowerCase();
  const step = 'archive-planning:archive-artifacts';

  const workspacePath = findWorkspacePath(ctx.projectPath, issueLower);
  if (!workspacePath || !existsSync(workspacePath)) {
    return stepSkipped(step, ['No workspace found to archive']);
  }

  try {
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

    // Archive .planning/feedback/
    const feedbackDir = join(workspacePath, '.planning', 'feedback');
    if (existsSync(feedbackDir)) {
      await cp(feedbackDir, join(archiveDir, 'feedback'), { recursive: true });
      details.push('Archived feedback/');
    }

    // Archive continue file (replaces STATE.md)
    const issueUpper = ctx.issueId.toUpperCase();
    const continueFile = join(workspacePath, '.planning', `continue-${issueUpper}.vbrief.json`);
    if (existsSync(continueFile)) {
      await cp(continueFile, join(archiveDir, `continue-${issueUpper}.vbrief.json`));
      details.push('Archived continue.vbrief.json');
    }

    // Archive plan.vbrief.json — the canonical structured plan. Moved to
    // docs/prds/completed/ above, but the workspace copy may have agent-driven
    // updates (sequence, completion timestamps) not yet copied to docs/. Preserve
    // both so the archive reflects the true final state of the workspace.
    const vbriefJson = join(workspacePath, '.planning', 'plan.vbrief.json');
    if (existsSync(vbriefJson)) {
      await cp(vbriefJson, join(archiveDir, 'plan.vbrief.json'));
      details.push('Archived plan.vbrief.json');
    }

    // Archive beads/
    const beadsDir = join(workspacePath, '.planning', 'beads');
    if (existsSync(beadsDir)) {
      await cp(beadsDir, join(archiveDir, 'beads'), { recursive: true });
      details.push('Archived beads/');
    }

    // Archive PRD.md (workspace copy — the docs/prds/ copy is canonical,
    // but this preserves the workspace-specific version with agent annotations)
    const prdMd = join(workspacePath, '.planning', 'PRD.md');
    if (existsSync(prdMd)) {
      await cp(prdMd, join(archiveDir, 'PRD.md'));
      details.push('Archived workspace PRD.md');
    }

    details.push(`Archived to ${archiveDir}`);
    return stepOk(step, details);
  } catch (err) {
    return stepFailed(step, `Failed to archive: ${(err as Error).message}`);
  }
}

/**
 * Full archive-planning operation: move PRD + archive workspace artifacts.
 * Archive failure is a hard fail — do not proceed with workspace deletion.
 */
export async function archivePlanning(
  ctx: LifecycleContext,
  opts: ArchiveOptions = {},
): Promise<StepResult[]> {
  const results: StepResult[] = [];

  // Step 1: Move PRD
  const prdResult = await movePrd(ctx, opts);
  results.push(prdResult);

  // Step 2: Archive workspace artifacts
  const archiveResult = await archiveWorkspaceArtifacts(ctx);
  results.push(archiveResult);

  return results;
}
