/**
 * vBRIEF File I/O Utilities
 *
 * Read and write plan.vbrief.json from workspace .planning/ directories.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { VBriefDocument, VBriefItemStatus } from './types.js';

const PLAN_FILENAME = 'plan.vbrief.json';

/**
 * Returns the path to plan.vbrief.json for a workspace, or null if it doesn't exist.
 */
export function findPlan(workspacePath: string): string | null {
  const planPath = join(workspacePath, '.planning', PLAN_FILENAME);
  return existsSync(planPath) ? planPath : null;
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
 * (status moves out of 'proposed'). Falls back to the legacy
 * `.planning/.planning-complete` marker only when the plan is missing a
 * status field, so legacy vBRIEFs still work during the transition.
 *
 * Pass either a workspace root (helper looks in `<root>/.planning/`) or a
 * `.planning/` directory directly via `planningDir`.
 */
export function isPlanningProposed(workspacePath: string, planningDir?: string): boolean {
  return checkPlanStatus(workspacePath, planningDir, status => status === 'proposed');
}

/**
 * Check whether planning has finished for this workspace — i.e., beads have
 * been generated and the agent can (or already did) start work.
 *
 * Returns true when `plan.status` is any of: 'proposed', 'approved', 'pending',
 * 'running', 'completed', or 'blocked'. Falls back to the legacy
 * `.planning/.planning-complete` marker so older vBRIEFs without the status
 * field continue to gate "tasks generated" checks correctly.
 *
 * Pass either a workspace root (helper looks in `<root>/.planning/`) or a
 * `.planning/` directory directly via `planningDir`.
 */
export function isPlanningComplete(workspacePath: string, planningDir?: string): boolean {
  return checkPlanStatus(workspacePath, planningDir, status => PLANNING_FINISHED_STATUSES.has(status));
}

function checkPlanStatus(
  workspacePath: string,
  planningDir: string | undefined,
  matchStatus: (status: string) => boolean,
): boolean {
  const dir = planningDir ?? join(workspacePath, '.planning');
  const planPath = join(dir, 'plan.vbrief.json');
  if (existsSync(planPath)) {
    try {
      const doc = readPlan(planPath);
      const status = doc.plan?.status;
      if (status && matchStatus(status)) return true;
      // Plan exists with an explicit non-matching status — trust it. Don't
      // fall through to the marker (which could be stale).
      if (status) return false;
    } catch {
      // Corrupt / unreadable plan — fall through to the legacy marker.
    }
  }
  return existsSync(join(dir, '.planning-complete'));
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
