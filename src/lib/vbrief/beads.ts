/**
 * createBeadsFromVBrief
 *
 * Converts a vBRIEF plan document into beads tasks, preserving dependency
 * relationships from blocking edges. This replaces LLM-generated `bd create`
 * shell commands with a deterministic, programmatic conversion.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { readWorkspacePlan, updateItemStatus, updateSubItemStatus } from './io.js';
import { extractACFromDocument } from './acceptance-criteria.js';
import type { AcceptanceCriterion } from './acceptance-criteria.js';
import type { VBriefDocument, VBriefItem, VBriefItemStatus } from './types.js';

const execAsync = promisify(exec);

export interface CreateBeadsResult {
  success: boolean;
  created: string[];
  errors: string[];
  /** Map from vBRIEF item ID → created bead ID */
  beadIds: Map<string, string>;
}

/**
 * Converts a vBRIEF plan.vbrief.json into beads tasks with dependencies.
 *
 * @param workspacePath - Path to the workspace root (contains .planning/plan.vbrief.json)
 * @returns Result with created bead IDs and any errors
 */
export async function createBeadsFromVBrief(workspacePath: string): Promise<CreateBeadsResult> {
  const created: string[] = [];
  const errors: string[] = [];
  const beadIds = new Map<string, string>();

  // Verify bd CLI is available
  try {
    await execAsync('which bd', { encoding: 'utf-8' });
  } catch {
    return { success: false, created: [], errors: ['bd (beads) CLI not found in PATH'], beadIds };
  }

  // Ensure beads database is initialized — planning agents create the vBRIEF plan
  // but don't run `bd init`, so the workspace may not have a .beads/ directory yet.
  if (!existsSync(join(workspacePath, '.beads'))) {
    try {
      await execAsync('bd init', { encoding: 'utf-8', cwd: workspacePath, timeout: 15000 });
      console.log(`[beads] Initialized beads database in ${workspacePath}`);
    } catch (initErr: any) {
      return { success: false, created: [], errors: [`Failed to initialize beads: ${initErr.message}`], beadIds };
    }
  }

  // Read the vBRIEF plan — handle both formats:
  // 1. Standard: { vBRIEFInfo: {...}, plan: { id, items, edges } }
  // 2. Flat: { issue, title, items, edges? } (produced by some planning prompts)
  let doc: VBriefDocument | null = null;
  try {
    doc = readWorkspacePlan(workspacePath);
  } catch {
    // readWorkspacePlan may throw on format mismatch, try flat format
  }

  let plan: { id: string; items: VBriefItem[]; edges: Array<{ from: string; to: string; type: string }> };

  if (doc?.plan) {
    plan = doc.plan;
  } else {
    // Try flat format: read raw JSON
    const planPath = join(workspacePath, '.planning', 'plan.vbrief.json');
    if (!existsSync(planPath)) {
      return { success: false, created: [], errors: ['No plan.vbrief.json found in workspace'], beadIds };
    }
    try {
      const raw = JSON.parse(readFileSync(planPath, 'utf-8'));
      plan = {
        id: raw.issue || raw.id || raw.plan?.id || '',
        items: raw.items || raw.plan?.items || [],
        edges: raw.edges || raw.plan?.edges || [],
      };
      if (!plan.id) {
        return { success: false, created: [], errors: ['plan.vbrief.json missing id/issue field'], beadIds };
      }
    } catch (parseErr: any) {
      return { success: false, created: [], errors: [`Failed to parse plan.vbrief.json: ${parseErr.message}`], beadIds };
    }
  }

  // Normalize item fields — flat format may use 'description' instead of 'narrative.Action'
  for (const item of plan.items) {
    if (!item.narrative && (item as any).description) {
      item.narrative = { Action: (item as any).description };
    }
    if (!item.metadata && (item as any).difficulty) {
      item.metadata = { difficulty: (item as any).difficulty, issueLabel: plan.id.toLowerCase() };
    }
    if (!item.status) item.status = 'pending';
    if (!item.subItems) {
      // Convert flat 'acceptance' array to subItems
      const acc = (item as any).acceptance;
      if (Array.isArray(acc)) {
        item.subItems = acc.map((a: string, i: number) => ({
          id: `${item.id}.ac${i + 1}`,
          title: a,
          status: 'pending' as VBriefItemStatus,
          metadata: { kind: 'acceptance_criterion' },
        }));
      } else {
        item.subItems = [];
      }
    }
  }

  // Idempotency: clear any existing beads for this issue before creating new ones.
  // Re-planning means "the old plan was invalid" — start fresh.
  const issueLabel = plan.id.toLowerCase();
  try {
    const { stdout: existingJson } = await execAsync(
      `bd list --json -l "${issueLabel}" --status all --limit 0`,
      { encoding: 'utf-8', cwd: workspacePath, timeout: 15000 }
    );
    const existingBeads = JSON.parse(existingJson || '[]');
    if (Array.isArray(existingBeads) && existingBeads.length > 0) {
      const ids = existingBeads.map((b: any) => b.id).filter(Boolean);
      for (const id of ids) {
        try {
          await execAsync(`bd delete ${id} --force`, { encoding: 'utf-8', cwd: workspacePath, timeout: 10000 });
        } catch {
          // Individual delete failure is non-fatal
        }
      }
      console.log(`[beads] Cleared ${ids.length} existing beads for ${issueLabel} before re-creating`);
    }
  } catch {
    // If listing fails (no beads exist, bd not initialized), proceed with creation
  }

  // Build blocking-edge map: item.id → set of item IDs that block it
  // (i.e., blockers[B] = { A } means A blocks B, so B depends on A)
  const blockers = new Map<string, Set<string>>();
  for (const item of plan.items) {
    blockers.set(item.id, new Set());
  }
  for (const edge of plan.edges) {
    if (edge.type === 'blocks') {
      const blockersOfTo = blockers.get(edge.to);
      if (blockersOfTo) {
        blockersOfTo.add(edge.from);
      }
    }
  }

  // Topological sort (Kahn's algorithm) so we create items after their blockers
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>(); // from → list of items it blocks
  for (const item of plan.items) {
    inDegree.set(item.id, 0);
    adjacency.set(item.id, []);
  }
  for (const edge of plan.edges) {
    if (edge.type === 'blocks') {
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
      adjacency.get(edge.from)?.push(edge.to);
    }
  }

  const queue: string[] = [];
  for (const item of plan.items) {
    if ((inDegree.get(item.id) ?? 0) === 0) {
      queue.push(item.id);
    }
  }

  const itemById = new Map<string, VBriefItem>(plan.items.map(i => [i.id, i]));
  const sortedIds: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sortedIds.push(id);
    for (const dependent of adjacency.get(id) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // If we have a cycle, fall back to original order
  const orderedIds = sortedIds.length === plan.items.length
    ? sortedIds
    : plan.items.map(i => i.id);

  // Create beads in dependency order
  for (const itemId of orderedIds) {
    const item = itemById.get(itemId);
    if (!item) continue;

    const fullTitle = `${plan.id}: ${item.title}`;
    const difficulty = item.metadata?.difficulty ?? 'medium';
    const issueLabel = item.metadata?.issueLabel ?? plan.id.toLowerCase();
    const phase = item.metadata?.phase;

    try {
      // Build labels
      const labels = [issueLabel, `difficulty:${difficulty}`];
      if (phase !== undefined) labels.push(`phase-${phase}`);
      const labelStr = labels.join(',');

      // Build description from narrative Action + acceptance criteria
      const actionText = item.narrative?.Action ?? '';
      const acLines = (item.subItems ?? [])
        .filter(s => s.metadata?.kind === 'acceptance_criterion')
        .map(s => `- AC: ${s.title}`)
        .join('\n');
      const description = [actionText, acLines].filter(Boolean).join('\n');

      // Build deps from blocking edges (blockers that have been created)
      const blockingDeps = [...(blockers.get(itemId) ?? [])].map(blockerId => {
        const beadId = beadIds.get(blockerId);
        return beadId ? `blocks:${beadId}` : null;
      }).filter((d): d is string => d !== null);

      // Assemble bd create command
      const escapedTitle = fullTitle.replace(/"/g, '\\"');
      let cmd = `bd create "${escapedTitle}" --type task --silent -l "${labelStr}"`;

      if (description) {
        const escapedDesc = description.replace(/"/g, '\\"').replace(/\n/g, '\\n');
        cmd += ` -d "${escapedDesc}"`;
      }

      if (blockingDeps.length > 0) {
        cmd += ` --deps "${blockingDeps.join(',')}"`;
      }

      const { stdout } = await execAsync(cmd, { encoding: 'utf-8', cwd: workspacePath });
      const beadId = stdout.trim();

      if (beadId) {
        beadIds.set(itemId, beadId);
        created.push(fullTitle);
      } else {
        errors.push(`Created "${item.title}" but could not capture bead ID`);
        created.push(fullTitle);
      }
    } catch (error: any) {
      const errMsg = error.stderr?.toString() || error.message || String(error);
      errors.push(`Failed to create "${item.title}": ${errMsg.split('\n')[0]}`);
    }
  }

  return { success: errors.length === 0, created, errors, beadIds };
}

/**
 * Syncs a closed bead's status to the corresponding vBRIEF item.
 *
 * Reads the bead title from .beads/issues.jsonl, strips the issue prefix
 * (e.g. "PAN-388: Wire createBeadsFromVBrief()" → "Wire createBeadsFromVBrief()"),
 * finds the matching item in plan.vbrief.json, and calls updateItemStatus().
 *
 * No-ops gracefully when:
 * - No plan.vbrief.json exists (legacy workspace)
 * - Bead ID not found in issues.jsonl
 * - No matching vBRIEF item found
 */
/**
 * Returns the vBRIEF item ID that was updated, or null if no match was found.
 */
export function syncBeadStatusToVBrief(
  beadId: string,
  workspacePath: string,
  status: VBriefItemStatus = 'completed'
): string | null {
  try {
    const doc = readWorkspacePlan(workspacePath);
    if (!doc) return null;

    // Read bead title from .beads/issues.jsonl
    const beadsFile = join(workspacePath, '.beads', 'issues.jsonl');
    if (!existsSync(beadsFile)) return null;

    const lines = readFileSync(beadsFile, 'utf-8').split('\n').filter(Boolean);
    let beadTitle: string | null = null;
    for (const line of lines) {
      try {
        const bead = JSON.parse(line);
        if (bead.id === beadId && bead.title) {
          beadTitle = bead.title as string;
          break;
        }
      } catch {
        // skip malformed lines
      }
    }

    if (!beadTitle) return null;

    // Strip issue prefix: "{PLAN_ID}: {item.title}" → "{item.title}"
    const planId = doc.plan.id;
    const prefix = `${planId}: `;
    const itemTitle = beadTitle.startsWith(prefix)
      ? beadTitle.slice(prefix.length)
      : beadTitle;

    // Find matching item (case-insensitive)
    const itemTitleLower = itemTitle.toLowerCase();
    const matchingItem = doc.plan.items.find(
      i => i.title.toLowerCase() === itemTitleLower
    );

    if (!matchingItem) return null;

    updateItemStatus(workspacePath, matchingItem.id, status);

    // Also mark all AC subItems as completed when the parent item is completed
    if (status === 'completed' && matchingItem.subItems) {
      for (const sub of matchingItem.subItems) {
        if (sub.metadata?.kind === 'acceptance_criterion' && sub.status !== 'completed') {
          updateSubItemStatus(workspacePath, matchingItem.id, sub.id, 'completed');
        }
      }
    }

    console.log(`[vbrief-sync] Updated item "${matchingItem.id}" to "${status}" from bead ${beadId}`);
    return matchingItem.id;
  } catch (err: any) {
    // Non-fatal: log and continue
    console.warn(`[vbrief-sync] Failed to sync bead ${beadId}: ${err.message}`);
    return null;
  }
}

/** Per-item AC status summary. */
export interface ItemACStatus {
  itemId: string;
  itemTitle: string;
  completed: number;
  pending: number;
  total: number;
  criteria: AcceptanceCriterion[];
}

/** Result of getVBriefACStatus(). null means no plan or no AC found. */
export interface VBriefACStatus {
  allCompleted: boolean;
  items: ItemACStatus[];
  totalCompleted: number;
  totalPending: number;
  totalCount: number;
}

/**
 * Get structured AC status from a workspace's vBRIEF plan.
 *
 * Returns per-item AC counts (completed/pending/total) plus an overall
 * allCompleted flag. Returns null if no plan exists or no AC are found
 * (legacy workspace compatibility).
 *
 * Used by: verification gate, pan work done, merge agent, prompt injection.
 */
export function getVBriefACStatus(workspacePath: string): VBriefACStatus | null {
  const doc = readWorkspacePlan(workspacePath);
  if (!doc) return null;

  const allCriteria = extractACFromDocument(doc);
  if (allCriteria.length === 0) return null;

  // Group by item
  const itemMap = new Map<string, ItemACStatus>();
  for (const ac of allCriteria) {
    let item = itemMap.get(ac.itemId);
    if (!item) {
      item = { itemId: ac.itemId, itemTitle: ac.itemTitle, completed: 0, pending: 0, total: 0, criteria: [] };
      itemMap.set(ac.itemId, item);
    }
    item.total++;
    item.criteria.push(ac);
    if (ac.status === 'completed' || ac.status === 'cancelled') {
      item.completed++;
    } else {
      item.pending++;
    }
  }

  const items = Array.from(itemMap.values());
  const totalCompleted = items.reduce((sum, i) => sum + i.completed, 0);
  const totalPending = items.reduce((sum, i) => sum + i.pending, 0);
  const totalCount = totalCompleted + totalPending;

  return {
    allCompleted: totalPending === 0,
    items,
    totalCompleted,
    totalPending,
    totalCount,
  };
}
