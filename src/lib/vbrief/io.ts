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
 * Throws if the file does not exist or is invalid JSON.
 */
export function readPlan(planPath: string): VBriefDocument {
  const raw = readFileSync(planPath, 'utf-8');
  return JSON.parse(raw) as VBriefDocument;
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

  item.status = status;

  // Atomic rename: write to .tmp then rename to avoid partial reads
  const tempPath = planPath + '.tmp';
  writeFileSync(tempPath, JSON.stringify(doc, null, 2), 'utf-8');
  renameSync(tempPath, planPath);
}
