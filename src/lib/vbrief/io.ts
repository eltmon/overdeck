/**
 * vBRIEF File I/O Utilities
 *
 * Single-spec-on-main model (PAN-1124): the canonical vBRIEF spec lives at
 * `<projectRoot>/.pan/specs/<canonical>.vbrief.json` and is immutable after
 * planning writes it. The only legal spec mutation is `plan.status` via
 * `updateSpecStatus()` in `pan-dir/specs.ts`.
 *
 * Runtime item/subItem status is tracked as a flat `statusOverrides` map in
 * the workspace continue file (`<workspace>/.pan/continue.json`).
 * `readWorkspacePlan()` returns a merged view (main spec + overlay) so
 * callers never need to know about the overlay.
 *
 * `updateItemStatus` and `updateSubItemStatus` write ONLY to the workspace
 * continue file — they cannot mutate the spec on main.
 */

import { readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename, join, resolve } from 'path';
import { findSpecByIssue, findSpecByIssueAsync } from '../pan-dir/specs.js';
import { readWorkspaceContinue, writeWorkspaceContinue } from '../pan-dir/continue.js';
import type { VBriefDocument, VBriefItemStatus } from './types.js';

/**
 * Extract issue ID from a workspace directory path.
 * Workspace paths follow `<projectRoot>/workspaces/feature-<issue-id>/`.
 */
export function issueIdFromWorkspacePath(workspacePath: string): string | null {
  const base = basename(workspacePath);
  const match = base.match(/^feature-([a-z]+-\d+)$/i);
  return match ? match[1].toUpperCase() : null;
}

/** Derive the project root from a workspace path (two levels up). */
function projectRootFromWorkspace(workspacePath: string): string {
  return resolve(workspacePath, '..', '..');
}

/**
 * Returns the path to the canonical vBRIEF spec on main for this workspace's issue.
 * Returns null if no spec exists — callers must handle the missing-spec case.
 */
export function findPlan(workspacePath: string): string | null {
  const issueId = issueIdFromWorkspacePath(workspacePath);
  if (!issueId) return null;
  const projectRoot = projectRootFromWorkspace(workspacePath);
  const entry = findSpecByIssue(projectRoot, issueId);
  return entry ? entry.path : null;
}

/** Async variant of findPlan — safe to call from dashboard server code. */
export async function findPlanAsync(workspacePath: string): Promise<string | null> {
  const issueId = issueIdFromWorkspacePath(workspacePath);
  if (!issueId) return null;
  const projectRoot = projectRootFromWorkspace(workspacePath);
  const entry = await findSpecByIssueAsync(projectRoot, issueId);
  return entry ? entry.path : null;
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

/** Async variant of readPlan — safe to call from server-hot-path code. */
export async function readPlanAsync(planPath: string): Promise<VBriefDocument> {
  const raw = await readFile(planPath, 'utf-8');
  if (raw.includes('<<<<<<<') && raw.includes('=======') && raw.includes('>>>>>>>')) {
    throw new VBriefMergeConflictError(planPath);
  }
  const parsed = JSON.parse(raw);
  if (parsed.vBRIEFInfo && parsed.plan) {
    return parsed as VBriefDocument;
  }
  throw new Error(
    `Invalid vBRIEF format in ${planPath}: missing 'vBRIEFInfo' and/or 'plan' top-level keys. ` +
    `vBRIEF v0.5 requires exactly { "vBRIEFInfo": { "version": "0.5" }, "plan": { ... } }. ` +
    `See docs/VBRIEF.md for the correct format.`
  );
}

/**
 * Apply statusOverrides from workspace continue.json onto a deep-cloned spec.
 * Keys are either `"item-id"` (item status) or `"item-id.sub-id"` (subItem status).
 */
export function applyStatusOverrides(doc: VBriefDocument, overrides: Record<string, string>): VBriefDocument {
  const merged = JSON.parse(JSON.stringify(doc)) as VBriefDocument;
  for (const [key, status] of Object.entries(overrides)) {
    const dotIndex = key.indexOf('.');
    if (dotIndex === -1) {
      const item = merged.plan.items.find(i => i.id === key);
      if (item) {
        item.status = status as VBriefItemStatus;
        if (status === 'completed' && !item.completed) {
          item.completed = new Date().toISOString();
        }
      }
    } else {
      const itemId = key.slice(0, dotIndex);
      const subId = key.slice(dotIndex + 1);
      const item = merged.plan.items.find(i => i.id === itemId);
      const sub = item?.subItems?.find(s => s.id === subId);
      if (sub) {
        sub.status = status as VBriefItemStatus;
        if (status === 'completed' && !sub.completed) {
          sub.completed = new Date().toISOString();
        }
      }
    }
  }
  return merged;
}

/**
 * Reads the vBRIEF plan for a workspace, returning a merged view with
 * statusOverrides applied from the workspace continue file.
 * Returns null if no plan exists on main or locally.
 */
export function readWorkspacePlan(workspacePath: string): VBriefDocument | null {
  const planPath = findPlan(workspacePath);
  if (!planPath) return null;
  const doc = readPlan(planPath);

  const continueState = readWorkspaceContinue(workspacePath);
  if (continueState?.statusOverrides && Object.keys(continueState.statusOverrides).length > 0) {
    return applyStatusOverrides(doc, continueState.statusOverrides);
  }
  return doc;
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
 */
export function isPlanningComplete(workspacePath: string, planningDir?: string): boolean {
  return checkPlanStatus(workspacePath, planningDir, status => PLANNING_FINISHED_STATUSES.has(status));
}

function checkPlanStatus(
  workspacePath: string,
  _planningDir: string | undefined,
  matchStatus: (status: string) => boolean,
): boolean {
  const planPath = findPlan(workspacePath);
  if (!planPath) return false;
  try {
    const doc = readPlan(planPath);
    const status = doc.plan?.status;
    if (status && matchStatus(status)) return true;
    if (status) return false;
  } catch {
    // Corrupt / unreadable plan
  }
  return false;
}


/**
 * Updates the status of a specific item by writing to the workspace
 * continue file's `statusOverrides` map. Does NOT mutate the spec on main.
 * No-ops gracefully if no plan exists for this workspace.
 */
export function updateItemStatus(workspacePath: string, itemId: string, status: VBriefItemStatus): void {
  const planPath = findPlan(workspacePath);
  if (!planPath) return;

  const doc = readPlan(planPath);
  const item = doc.plan.items.find(i => i.id === itemId);
  if (!item) return;

  const continueState = readWorkspaceContinue(workspacePath) ?? {
    version: '1' as const,
    issueId: issueIdFromWorkspacePath(workspacePath) ?? 'UNKNOWN',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    gitState: {},
    decisions: [],
    hazards: [],
    resumePoint: null,
    beadsMapping: {},
    sessionHistory: [],
  };

  const overrides = { ...continueState.statusOverrides };
  overrides[itemId] = status;
  continueState.statusOverrides = overrides;

  writeWorkspaceContinue(workspacePath, continueState);
}

/**
 * Updates the status of a specific subItem by writing to the workspace
 * continue file's `statusOverrides` map. Uses `itemId.subItemId` as the key.
 * Does NOT mutate the spec on main.
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

  const continueState = readWorkspaceContinue(workspacePath) ?? {
    version: '1' as const,
    issueId: issueIdFromWorkspacePath(workspacePath) ?? 'UNKNOWN',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    gitState: {},
    decisions: [],
    hazards: [],
    resumePoint: null,
    beadsMapping: {},
    sessionHistory: [],
  };

  const overrides = { ...continueState.statusOverrides };
  overrides[`${itemId}.${subItemId}`] = status;
  continueState.statusOverrides = overrides;

  writeWorkspaceContinue(workspacePath, continueState);
}
