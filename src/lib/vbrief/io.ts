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
export function readPlan(planPath: string): VBriefDocument {
  const raw = readFileSync(planPath, 'utf-8');
  const parsed = JSON.parse(raw);

  // Standard format — has vBRIEFInfo and plan
  if (parsed.vBRIEFInfo && parsed.plan) {
    // Normalize any legacy status values in the standard format too
    if (parsed.plan.items) {
      for (const item of parsed.plan.items) {
        if (item.status === 'in_progress') {
          console.warn(`[vBRIEF] DEPRECATION: status 'in_progress' is not vBRIEF v0.5 spec — use 'running'. File: ${planPath}`);
          item.status = 'running';
        }
        for (const sub of item.subItems || []) {
          if (sub.status === 'in_progress') sub.status = 'running';
        }
      }
    }
    return parsed as VBriefDocument;
  }

  // ─── DEPRECATED: Flat format normalization ──────────────────────────────
  // The flat format (no vBRIEFInfo/plan wrapper) is non-spec and deprecated.
  // Planning prompts have been updated to produce the canonical format.
  // This normalizer will be removed in a future release.
  console.warn(
    `[vBRIEF] DEPRECATION: ${planPath} uses flat format (no vBRIEFInfo/plan wrapper). ` +
    `This is not vBRIEF v0.5 spec compliant and will stop being supported. ` +
    `See docs/VBRIEF.md for the correct format.`
  );

  // Detect which non-standard field name was used for the issue ID
  const planId = parsed.issue || parsed.issueId || parsed.issue_id || parsed.id || '';
  if (parsed.issue_id) {
    console.warn(`[vBRIEF] DEPRECATION: field 'issue_id' → use 'plan.id' in nested format`);
  } else if (parsed.issueId) {
    console.warn(`[vBRIEF] DEPRECATION: field 'issueId' → use 'plan.id' in nested format`);
  } else if (parsed.issue) {
    console.warn(`[vBRIEF] DEPRECATION: field 'issue' → use 'plan.id' in nested format`);
  }

  const items = (parsed.items || []).map((item: any) => {
    // Normalize deprecated fields
    if (item.description && !item.narrative) {
      console.warn(`[vBRIEF] DEPRECATION: item '${item.id}' uses 'description' → use 'narrative.Action'`);
    }
    if (item.acceptance && !item.subItems) {
      console.warn(`[vBRIEF] DEPRECATION: item '${item.id}' uses 'acceptance[]' strings → use 'subItems[]' with metadata.kind`);
    }
    if (item.status === 'in_progress') {
      console.warn(`[vBRIEF] DEPRECATION: item '${item.id}' uses status 'in_progress' → use 'running'`);
    }

    return {
      ...item,
      status: item.status === 'in_progress' ? 'running' : (item.status || 'pending'),
      narrative: item.narrative || (item.description ? { Action: item.description } : undefined),
      metadata: item.metadata || (item.difficulty ? { difficulty: item.difficulty, issueLabel: planId.toLowerCase() } : undefined),
      subItems: item.subItems || (Array.isArray(item.acceptance) ? item.acceptance.map((a: string, i: number) => ({
        id: `${item.id}.ac${i + 1}`,
        title: a,
        status: 'pending' as const,
        metadata: { kind: 'acceptance_criterion' },
      })) : []),
    };
  });

  return {
    vBRIEFInfo: {
      version: '0.5',
      created: new Date().toISOString(),
    },
    plan: {
      id: planId,
      title: parsed.title || '',
      status: parsed.status === 'in_progress' ? 'running' : (parsed.status || 'approved'),
      items,
      edges: parsed.edges || [],
    },
  } as VBriefDocument;
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

  subItem.status = status;

  const tempPath = planPath + '.tmp';
  writeFileSync(tempPath, JSON.stringify(doc, null, 2), 'utf-8');
  renameSync(tempPath, planPath);
}
