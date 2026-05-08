/**
 * vBRIEF File I/O Utilities
 *
 * Read and write workspace vBRIEF plans from `.pan/spec.vbrief.json`.
 *
 * IMPORTANT (PAN-946): Workspace mutations MUST NEVER reach into project-level
 * lifecycle directories. `findPlan`, `readWorkspacePlan`, `updateItemStatus`,
 * and `updateSubItemStatus` resolve only the workspace-local spec file.
 * Lifecycle (proposed/active/completed/cancelled) lookups go through
 * `findVBriefByIssue` in `lifecycle-io.ts` (read-only) or
 * `findVBriefByIssueAsync` in `vbrief-index.ts` (read-only, indexed).
 *
 * Conflating the two surfaces caused a high-severity correctness bug where
 * routine workspace progress updates (item status writes, beads sync) could
 * mutate `vbrief/active`, `vbrief/completed`, or `vbrief/cancelled` files
 * after lifecycle promotion — corrupting the archived plan.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  PROJECT_DOCS_SUBDIR,
  PROJECT_PRDS_ACTIVE_SUBDIR,
  PROJECT_PRDS_PLANNED_SUBDIR,
  PROJECT_PRDS_SUBDIR,
} from '../paths.js';
import { PAN_DIRNAME, PAN_SPEC_FILENAME } from '../pan-dir/types.js';
import type { VBriefDocument, VBriefItemStatus } from './types.js';

/**
 * Returns the path to the workspace-local spec file if it exists, or null.
 * **Workspace-only.** Does NOT scan lifecycle directories — lifecycle/discovery
 * lookups belong in `findVBriefByIssue` / `findVBriefByIssueAsync`.
 */
export function findPlan(workspacePath: string): string | null {
  const panPlanPath = join(workspacePath, PAN_DIRNAME, PAN_SPEC_FILENAME);
  return existsSync(panPlanPath) ? panPlanPath : null;
}

const PRD_VBRIEF_STATUS_DIRS = [PROJECT_PRDS_ACTIVE_SUBDIR, PROJECT_PRDS_PLANNED_SUBDIR] as const;
const PRD_VBRIEF_ROOTS = [
  [PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR],
  ['api', PROJECT_DOCS_SUBDIR, PROJECT_PRDS_SUBDIR],
] as const;

/**
 * Returns a PRD-scoped vBRIEF path for an issue when the workspace-local
 * `.pan/spec.vbrief.json` has not been materialized yet.
 *
 * Supports both legacy flat files (`docs/prds/active/PAN-123-plan.vbrief.json`)
 * and canonical subdirectory files (`docs/prds/active/pan-123/plan.vbrief.json`),
 * including the historical uppercase-directory variant and the `api/docs/prds/*`
 * mirror used by some projects.
 */
export function findVBriefInPrdDirs(projectRoot: string, issueId: string): string | null {
  const issueIdLower = issueId.toLowerCase();
  const issueIdUpper = issueId.toUpperCase();

  for (const prdRoot of PRD_VBRIEF_ROOTS) {
    for (const statusDir of PRD_VBRIEF_STATUS_DIRS) {
      const root = join(projectRoot, ...prdRoot, statusDir);
      const candidates = [
        join(root, `${issueIdUpper}-plan.vbrief.json`),
        join(root, `${issueIdLower}-plan.vbrief.json`),
        join(root, issueIdLower, 'plan.vbrief.json'),
        join(root, issueIdUpper, 'plan.vbrief.json'),
      ];

      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  return null;
}

/**
 * Reads and parses plan.vbrief.json from the given path.
 * Handles both standard format ({ vBRIEFInfo, plan: {...} }) and flat format
 * ({ issue, title, items, edges? }) produced by some planning prompts.
 * Throws if the file does not exist or is invalid JSON.
 */
export class VBriefMergeConflictError extends Error {
  constructor(planPath: string) {
    super(
      `plan.vbrief.json at ${planPath} contains unresolved git merge conflict markers. ` +
      `Resolve all <<<<<<</=======/>>>>>>> markers in that file and commit the result before re-requesting review.`
    );
    this.name = 'VBriefMergeConflictError';
  }
}

export function readPlan(planPath: string): VBriefDocument {
  const raw = readFileSync(planPath, 'utf-8');
  if (raw.includes('<<<<<<<') && raw.includes('=======') && raw.includes('>>>>>>>')) {
    throw new VBriefMergeConflictError(planPath);
  }
  const parsed = JSON.parse(raw);

  // vBRIEF v0.5 requires exactly two top-level keys: vBRIEFInfo and plan
  if (parsed.vBRIEFInfo && parsed.plan) {
    return parsed as VBriefDocument;
  }

  // Non-spec format — reject with helpful error
  throw new Error(
    `Invalid vBRIEF format in ${planPath}: missing 'vBRIEFInfo' and/or 'plan' top-level keys. ` +
    `vBRIEF v0.5 requires exactly { "vBRIEFInfo": { "version": "0.5" }, "plan": { ... } }. ` +
    `See docs/VBRIEF.md for the correct format.`
  );
}

/**
 * Reads plan.vbrief.json from a workspace directory.
 * Returns null if no plan exists.
 */
export function readWorkspacePlan(workspacePath: string): VBriefDocument | null {
  const planPath = findPlan(workspacePath);
  if (!planPath) return null;
  return readPlan(planPath);
}

/**
 * vBRIEF lifecycle statuses that mean "planning has finished" — i.e., the
 * agent can pick up work or the plan is done. Excludes 'draft' (still being
 * written) and 'cancelled' (abandoned).
 */
const PLANNING_FINISHED_STATUSES = new Set(['proposed', 'approved', 'pending', 'running', 'completed', 'blocked']);

/**
 * Check whether planning has reached the "proposed" state for this workspace.
 *
 * Returns true ONLY when `plan.status === 'proposed'`. Used to gate the
 * dashboard Done button which should hide once the user has approved the plan
 * (status moves out of 'proposed').
 *
 * Pass either a workspace root (helper looks in `<root>/.pan/`) or a direct
 * `.pan/` directory path via `planningDir`.
 */
export function isPlanningProposed(workspacePath: string, planningDir?: string): boolean {
  return checkPlanStatus(workspacePath, planningDir, status => status === 'proposed');
}

/**
 * Check whether planning has finished for this workspace — i.e., beads have
 * been generated and the agent can (or already did) start work.
 *
 * Returns true when `plan.status` is any of: 'proposed', 'approved', 'pending',
 * 'running', 'completed', or 'blocked'.
 *
 * Pass either a workspace root (helper looks in `<root>/.pan/`) or a direct
 * `.pan/` directory path via `planningDir`.
 */
export function isPlanningComplete(workspacePath: string, planningDir?: string): boolean {
  return checkPlanStatus(workspacePath, planningDir, status => PLANNING_FINISHED_STATUSES.has(status));
}

function checkPlanStatus(
  workspacePath: string,
  planningDir: string | undefined,
  matchStatus: (status: string) => boolean,
): boolean {
  const candidatePlanPaths = planningDir
    ? [join(planningDir, PAN_SPEC_FILENAME)]
    : [join(workspacePath, PAN_DIRNAME, PAN_SPEC_FILENAME)];

  for (const planPath of candidatePlanPaths) {
    if (!existsSync(planPath)) continue;
    try {
      const doc = readPlan(planPath);
      const status = doc.plan?.status;
      if (status && matchStatus(status)) return true;
      if (status) return false;
    } catch {
      // Corrupt / unreadable plan — keep checking fallbacks.
    }
  }

  return false;
}


/**
 * Updates the status of a specific item in plan.vbrief.json.
 * Uses a write-to-temp-then-rename pattern to minimize race conditions.
 * No-ops gracefully if the file or item doesn't exist.
 */
export function updateItemStatus(workspacePath: string, itemId: string, status: VBriefItemStatus): void {
  const planPath = findPlan(workspacePath);
  if (!planPath) return;

  const doc = readPlan(planPath);
  const item = doc.plan.items.find(i => i.id === itemId);
  if (!item) return;

  const now = new Date().toISOString();
  item.status = status;
  if (status === 'completed') {
    item.completed = now;
  }

  // Update timestamps and increment sequence counter
  doc.vBRIEFInfo.updated = now;
  doc.plan.updated = now;
  doc.plan.sequence = (doc.plan.sequence ?? 0) + 1;

  // Atomic rename: write to .tmp then rename to avoid partial reads
  const tempPath = planPath + '.tmp';
  writeFileSync(tempPath, JSON.stringify(doc, null, 2), 'utf-8');
  renameSync(tempPath, planPath);
}

/**
 * Updates the status of a specific subItem within an item in plan.vbrief.json.
 * Uses write-to-temp-then-rename pattern for atomicity.
 * No-ops gracefully if the file, item, or subItem doesn't exist.
 */
export function updateSubItemStatus(
  workspacePath: string,
  itemId: string,
  subItemId: string,
  status: VBriefItemStatus,
): void {
  const planPath = findPlan(workspacePath);
  if (!planPath) return;

  const doc = readPlan(planPath);
  const item = doc.plan.items.find(i => i.id === itemId);
  if (!item?.subItems) return;

  const subItem = item.subItems.find(s => s.id === subItemId);
  if (!subItem) return;

  const now = new Date().toISOString();
  subItem.status = status;
  if (status === 'completed') {
    subItem.completed = now;
  }

  // Update timestamps and increment sequence counter
  doc.vBRIEFInfo.updated = now;
  doc.plan.updated = now;
  doc.plan.sequence = (doc.plan.sequence ?? 0) + 1;

  const tempPath = planPath + '.tmp';
  writeFileSync(tempPath, JSON.stringify(doc, null, 2), 'utf-8');
  renameSync(tempPath, planPath);
}
