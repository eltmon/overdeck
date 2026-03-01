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
 * Checks multiple conventional locations.
 */
export function findWorkspacePath(projectPath: string, issueLower: string): string | null {
  const candidates = [
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

  const completedPrdPath = join(
    ctx.projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR,
    PROJECT_PRDS_COMPLETED_SUBDIR, `${issueLower}-plan.md`,
  );
  const activePrdPath = join(
    ctx.projectPath, PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR,
    PROJECT_PRDS_ACTIVE_SUBDIR, `${issueLower}-plan.md`,
  );

  // Already in completed — idempotent skip
  if (existsSync(completedPrdPath)) {
    return stepSkipped(step, ['PRD already in completed/']);
  }

  // No PRD at all — skip (some issues don't have PRDs)
  if (!existsSync(activePrdPath)) {
    return stepSkipped(step, ['No PRD found in active/ (may not have had one)']);
  }

  // Ensure completed directory exists
  const completedDir = dirname(completedPrdPath);
  if (!existsSync(completedDir)) {
    mkdirSync(completedDir, { recursive: true });
  }

  // Try git mv first (proper tracking)
  try {
    await execAsync(`git mv "${activePrdPath}" "${completedPrdPath}"`, { cwd: ctx.projectPath });
    await execAsync(`git commit -m "Move ${ctx.issueId} PRD to completed"`, { cwd: ctx.projectPath });
    if (pushToRemote) {
      await execAsync('git push', { cwd: ctx.projectPath });
    }
    return stepOk(step, [`Moved PRD from active/ to completed/ via git mv`]);
  } catch {
    // git mv failed — fall back to copy
  }

  // Fallback: plain copy
  try {
    cpSync(activePrdPath, completedPrdPath);
    if (!existsSync(completedPrdPath)) {
      return stepFailed(step, 'PRD copy appeared to succeed but file not found at destination');
    }
    return stepOk(step, ['Copied PRD to completed/ (git mv failed, plain copy succeeded)']);
  } catch (err) {
    return stepFailed(step, `Failed to preserve PRD: ${(err as Error).message}`);
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
