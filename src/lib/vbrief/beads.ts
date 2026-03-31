/**
 * createBeadsFromVBrief
 *
 * Converts a vBRIEF plan document into beads tasks, preserving dependency
 * relationships from blocking edges. This replaces LLM-generated `bd create`
 * shell commands with a deterministic, programmatic conversion.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readWorkspacePlan } from './io.js';
import type { VBriefDocument, VBriefItem } from './types.js';

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

  // Read the vBRIEF plan
  const doc = readWorkspacePlan(workspacePath);
  if (!doc) {
    return { success: false, created: [], errors: ['No plan.vbrief.json found in workspace'], beadIds };
  }

  const { plan } = doc;

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

  // Flush beads to persist
  if (created.length > 0) {
    try {
      await execAsync('bd flush', { encoding: 'utf-8', cwd: workspacePath });
    } catch {
      // Flush failure is non-fatal
    }
  }

  return { success: errors.length === 0, created, errors, beadIds };
}
