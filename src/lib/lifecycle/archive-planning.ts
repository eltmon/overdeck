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

import { existsSync, mkdirSync, cpSync, rmSync } from 'fs';
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
  const issueLower = ctx.issueId.toLowerCase();
  const step = 'archive-planning:move-prd';

  // Per-issue subdirectory paths (new format: docs/prds/active/<issue-id>/STATE.md)
  const activeIssueDir = join(
    ctx.projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR,
    PROJECT_PRDS_ACTIVE_SUBDIR, issueLower,
  );
  const completedIssueDir = join(
    ctx.projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR,
    PROJECT_PRDS_COMPLETED_SUBDIR, issueLower,
  );

  // Legacy flat paths (old format: docs/prds/active/<issue-id>-plan.md)
  const legacyActivePrdPath = join(
    ctx.projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR,
    PROJECT_PRDS_ACTIVE_SUBDIR, `${issueLower}-plan.md`,
  );
  const legacyCompletedPrdPath = join(
    ctx.projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR,
    PROJECT_PRDS_COMPLETED_SUBDIR, `${issueLower}-plan.md`,
  );

  // Already in completed (either format) — idempotent skip
  if (existsSync(completedIssueDir) || existsSync(legacyCompletedPrdPath)) {
    return stepSkipped(step, ['PRD already in completed/']);
  }

  // Determine source: prefer new subdirectory format, fall back to legacy flat file
  const useNewFormat = existsSync(activeIssueDir);
  const useLegacyFormat = !useNewFormat && existsSync(legacyActivePrdPath);

  if (!useNewFormat && !useLegacyFormat) {
    return stepSkipped(step, ['No PRD found in active/ (may not have had one)']);
  }

  if (useNewFormat) {
    // Move entire issue subdirectory
    const completedParent = join(
      ctx.projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR, PROJECT_PRDS_COMPLETED_SUBDIR,
    );
    if (!existsSync(completedParent)) {
      mkdirSync(completedParent, { recursive: true });
    }
    try {
      await execAsync(`git mv "${activeIssueDir}" "${completedIssueDir}"`, { cwd: ctx.projectPath });
      await execAsync(`git commit -m "Move ${ctx.issueId} PRD to completed"`, { cwd: ctx.projectPath });
      if (pushToRemote) {
        await execAsync('git push', { cwd: ctx.projectPath });
      }
      return stepOk(step, [`Moved PRD subdirectory from active/ to completed/ via git mv`]);
    } catch {
      // git mv failed — fall back to copy
      try {
        cpSync(activeIssueDir, completedIssueDir, { recursive: true });
        return stepOk(step, ['Copied PRD subdirectory to completed/ (git mv failed, plain copy succeeded)']);
      } catch (err) {
        return stepFailed(step, `Failed to preserve PRD: ${(err as Error).message}`);
      }
    }
  } else {
    // Legacy flat file: move single file
    const completedDir = dirname(legacyCompletedPrdPath);
    if (!existsSync(completedDir)) {
      mkdirSync(completedDir, { recursive: true });
    }
    try {
      await execAsync(`git mv "${legacyActivePrdPath}" "${legacyCompletedPrdPath}"`, { cwd: ctx.projectPath });
      await execAsync(`git commit -m "Move ${ctx.issueId} PRD to completed"`, { cwd: ctx.projectPath });
      if (pushToRemote) {
        await execAsync('git push', { cwd: ctx.projectPath });
      }
      return stepOk(step, [`Moved PRD from active/ to completed/ via git mv`]);
    } catch {
      try {
        cpSync(legacyActivePrdPath, legacyCompletedPrdPath);
        if (!existsSync(legacyCompletedPrdPath)) {
          return stepFailed(step, 'PRD copy appeared to succeed but file not found at destination');
        }
        return stepOk(step, ['Copied PRD to completed/ (git mv failed, plain copy succeeded)']);
      } catch (err) {
        return stepFailed(step, `Failed to preserve PRD: ${(err as Error).message}`);
      }
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
      cpSync(archiveDir, rotatedDir, { recursive: true });
      rmSync(archiveDir, { recursive: true, force: true });
    }

    mkdirSync(archiveDir, { recursive: true });
    const details: string[] = [];

    // Archive .planning/feedback/
    const feedbackDir = join(workspacePath, '.planning', 'feedback');
    if (existsSync(feedbackDir)) {
      cpSync(feedbackDir, join(archiveDir, 'feedback'), { recursive: true });
      details.push('Archived feedback/');
    }

    // Archive STATE.md
    const stateMd = join(workspacePath, '.planning', 'STATE.md');
    if (existsSync(stateMd)) {
      cpSync(stateMd, join(archiveDir, 'STATE.md'));
      details.push('Archived STATE.md');
    }

    // Archive beads/
    const beadsDir = join(workspacePath, '.planning', 'beads');
    if (existsSync(beadsDir)) {
      cpSync(beadsDir, join(archiveDir, 'beads'), { recursive: true });
      details.push('Archived beads/');
    }

    // Archive PRD.md (workspace copy — the docs/prds/ copy is canonical,
    // but this preserves the workspace-specific version with agent annotations)
    const prdMd = join(workspacePath, '.planning', 'PRD.md');
    if (existsSync(prdMd)) {
      cpSync(prdMd, join(archiveDir, 'PRD.md'));
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
