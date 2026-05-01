/**
 * createBeadsFromVBrief
 *
 * Converts a vBRIEF plan document into beads tasks, preserving dependency
 * relationships from blocking edges. This replaces LLM-generated `bd create`
 * shell commands with a deterministic, programmatic conversion.
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import { readWorkspacePlan, updateItemStatus, updateSubItemStatus } from './io.js';
import { extractACFromDocument } from './acceptance-criteria.js';
import type { AcceptanceCriterion } from './acceptance-criteria.js';
import type { VBriefDocument, VBriefItem, VBriefItemStatus } from './types.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Derive a consistent project-level bead prefix from a workspace path.
 * Workspaces live at <projectRoot>/workspaces/feature-<id>/, so the project
 * root is two levels up. We use the repo directory name as the prefix.
 * This prevents each issue from getting a different prefix (e.g. pan-569,
 * pan-821) which breaks cross-issue bead scoping.
 */
function deriveProjectPrefix(workspacePath: string): string {
  const projectRoot = resolve(workspacePath, '..', '..');
  const repoName = basename(projectRoot).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return repoName;
}

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
    await execFileAsync('which', ['bd'], { encoding: 'utf-8', timeout: 5000 });
  } catch {
    return { success: false, created: [], errors: ['bd (beads) CLI not found in PATH'], beadIds };
  }

  // Ensure beads is reachable from this workspace.
  // Workspaces are git worktrees: only committed .beads files (issues.jsonl) are present.
  // The .beads/redirect file — which points bd at the main repo's shared Dolt database —
  // is gitignored and must be created explicitly if missing.
  const beadsDir = join(workspacePath, '.beads');
  const redirectPath = join(beadsDir, 'redirect');
  if (!existsSync(redirectPath)) {
    // Worktrees live at <projectRoot>/workspaces/feature-<id>/ — two levels up
    const projectRoot = resolve(workspacePath, '..', '..');
    const mainBeadsDir = join(projectRoot, '.beads');
    if (existsSync(mainBeadsDir)) {
      mkdirSync(beadsDir, { recursive: true });
      chmodSync(beadsDir, 0o700);
      writeFileSync(redirectPath, '../../.beads', 'utf-8');
      console.log(`[beads] Created redirect to main repo .beads/ in ${workspacePath}`);
    } else if (!existsSync(beadsDir)) {
      // No main .beads/ and no local .beads/ — fall back to bd init
      const prefix = deriveProjectPrefix(workspacePath);
      try {
        await execFileAsync('bd', ['init', '--prefix', prefix], { encoding: 'utf-8', cwd: workspacePath, timeout: 15000 });
        await execFileAsync('git', ['config', 'beads.role', 'contributor'], { cwd: workspacePath }).catch(() => {});
        // Disable beads' auto-export git-add to prevent "git add failed" warnings in worktrees
        await execFileAsync('bd', ['config', 'set', 'export.git-add', 'false'], {
          encoding: 'utf-8', cwd: workspacePath, timeout: 10000,
        }).catch(() => {});
        console.log(`[beads] Initialized beads database in ${workspacePath} (prefix: ${prefix})`);
      } catch (initErr: any) {
        return { success: false, created: [], errors: [`Failed to initialize beads: ${initErr.message}`], beadIds };
      }
    }
  }

  // Read the vBRIEF plan — must be spec-compliant format
  const doc = readWorkspacePlan(workspacePath);
  if (!doc) {
    return { success: false, created: [], errors: ['No plan.vbrief.json found in workspace'], beadIds };
  }

  const { plan } = doc;

  // Verify db connectivity — the Dolt database for this project may not exist yet
  // on fresh installs (bd was installed but bd init was never run at the project root).
  // If connectivity fails for any reason and a redirect exists, auto-initialize with
  // the right prefix so beads creation can proceed without manual intervention.
  const issueLabel = plan.id.toLowerCase();
  const redirectExists = existsSync(redirectPath);
  try {
    await execFileAsync('bd', ['list', '--json', '--limit', '0'], {
      encoding: 'utf-8', cwd: workspacePath, timeout: 8000,
    });
  } catch (connectErr: any) {
    // When redirect exists but DB is unreachable (not found, connection refused, timeout,
    // or any other error), always attempt bd init --prefix to initialize the database.
    // This covers fresh installs, corrupted DBs, and cases where the redirect was created
    // but bd init was never run for this prefix.
    if (redirectExists) {
      const prefix = deriveProjectPrefix(workspacePath);
      const connectErrMsg = String(connectErr?.message ?? connectErr?.stderr ?? '');

      // Categorize the connectivity error for diagnostic clarity
      let connectCategory: string;
      if (connectErrMsg.toLowerCase().includes('connect') || connectErrMsg.toLowerCase().includes('refused') || connectErrMsg.toLowerCase().includes('econnrefused')) {
        connectCategory = 'Dolt server not running';
      } else if (connectErrMsg.toLowerCase().includes('not found') || connectErrMsg.toLowerCase().includes('not exist') || connectErrMsg.toLowerCase().includes('no such')) {
        connectCategory = 'database not found';
      } else {
        connectCategory = connectErrMsg.split('\n')[0] || 'unknown connectivity error';
      }

      console.log(`[beads] Database unreachable (${connectCategory}) — auto-running bd init --prefix ${prefix}`);
      try {
        await execFileAsync('bd', ['init', '--prefix', prefix], {
          encoding: 'utf-8', cwd: workspacePath, timeout: 20000,
        });
        await execFileAsync('git', ['config', 'beads.role', 'contributor'], { cwd: workspacePath }).catch(() => {});
        // Disable beads' auto-export git-add to prevent "git add failed: exit status 128"
        // warnings in worktrees. Panopticon handles git operations explicitly.
        await execFileAsync('bd', ['config', 'set', 'export.git-add', 'false'], {
          encoding: 'utf-8', cwd: workspacePath, timeout: 10000,
        }).catch(() => {});
        console.log(`[beads] bd init succeeded for prefix ${prefix}`);
      } catch (initErr: any) {
        // Init failed — return early with a specific error so callers know exactly what happened
        // rather than proceeding with bead creation against a broken database.
        const initErrMsg = String(initErr?.message ?? initErr?.stderr ?? '');
        const detail = `database init failed: ${initErrMsg.split('\n')[0]} (connectivity: ${connectCategory})`;
        console.warn(`[beads] ${detail}`);
        return { success: false, created: [], errors: [detail], beadIds };
      }
    }
  }

  // Idempotency: clear any existing beads for this issue before creating new ones.
  // Re-planning means "the old plan was invalid" — start fresh.
  try {
    const { stdout: existingJson } = await execFileAsync(
      'bd',
      ['list', '--json', '-l', issueLabel, '--status', 'all', '--limit', '0'],
      { encoding: 'utf-8', cwd: workspacePath, timeout: 15000 }
    );
    const existingBeads = JSON.parse(existingJson || '[]');
    if (Array.isArray(existingBeads) && existingBeads.length > 0) {
      const ids = existingBeads.map((b: any) => b.id).filter(Boolean);
      for (const id of ids) {
        try {
          await execFileAsync('bd', ['delete', id, '--force'], { encoding: 'utf-8', cwd: workspacePath, timeout: 10000 });
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

  // Create beads in dependency order.
  //
  // IMPORTANT: We use execFile (argv array), NOT exec (shell string).
  // Plan titles/descriptions are arbitrary prose that can contain backticks,
  // $, quotes, pipes, newlines, etc. Building a shell command string and trying
  // to escape those is a losing game — one missed edge case and we end up
  // executing user content as shell code, or hanging on an unclosed quote.
  // execFile passes each arg directly to bd via execve, so no shell ever sees
  // it and the content is treated as literal bytes.
  for (let i = 0; i < orderedIds.length; i++) {
    const itemId = orderedIds[i];
    const item = itemById.get(itemId);
    if (!item) continue;

    const fullTitle = `${plan.id}: ${item.title}`;
    const difficulty = item.metadata?.difficulty ?? 'medium';
    const issueLabel = item.metadata?.issueLabel ?? plan.id.toLowerCase();
    const phase = item.metadata?.phase;

    const labels = [issueLabel, `difficulty:${difficulty}`];
    if (phase !== undefined) labels.push(`phase-${phase}`);
    const labelStr = labels.join(',');

    const actionText = item.narrative?.Action ?? '';
    const acLines = (item.subItems ?? [])
      .filter(s => s.metadata?.kind === 'acceptance_criterion')
      .map(s => `- AC: ${s.title}`)
      .join('\n');
    const description = [actionText, acLines].filter(Boolean).join('\n');

    const blockingDeps = [...(blockers.get(itemId) ?? [])].map(blockerId => {
      const beadId = beadIds.get(blockerId);
      return beadId ? `blocks:${beadId}` : null;
    }).filter((d): d is string => d !== null);

    const args = ['create', fullTitle, '--type', 'task', '--silent', '-l', labelStr];
    if (description) args.push('-d', description);
    if (blockingDeps.length > 0) args.push('--deps', blockingDeps.join(','));

    console.log(`[beads] (${i + 1}/${orderedIds.length}) creating "${item.title}"`);

    try {
      const { stdout } = await execFileAsync('bd', args, {
        encoding: 'utf-8',
        cwd: workspacePath,
        timeout: 30000,
      });
      const beadId = stdout.trim();

      if (beadId) {
        beadIds.set(itemId, beadId);
        created.push(fullTitle);
      } else {
        errors.push(`Created "${item.title}" but could not capture bead ID`);
        created.push(fullTitle);
      }
    } catch (error: any) {
      // killed === true means execFile hit the timeout — surface that specifically
      // so hangs don't look like generic failures.
      const timedOut = error?.killed === true || /ETIMEDOUT/i.test(String(error?.code ?? ''));
      const errMsg = error?.stderr?.toString() || error?.message || String(error);
      const prefix = timedOut ? 'timed out after 30s' : errMsg.split('\n')[0];
      errors.push(`Failed to create "${item.title}": ${prefix}`);
      console.warn(`[beads] (${i + 1}/${orderedIds.length}) FAILED "${item.title}": ${prefix}`);
    }
  }

  return { success: errors.length === 0, created, errors, beadIds };
}

/**
 * Syncs a bead's status to the corresponding vBRIEF item.
 * Returns the vBRIEF item ID that was updated, or null if no match was found.
 * Callers must provide knownTitle (from bd list/show output).
 */
/** Read a bead title from .beads/issues.jsonl by bead ID. */
function readBeadTitleFromJsonl(beadId: string, workspacePath: string): string | null {
  try {
    const jsonlPath = join(workspacePath, '.beads', 'issues.jsonl');
    if (!existsSync(jsonlPath)) return null;
    const raw = readFileSync(jsonlPath, 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.id === beadId && typeof entry.title === 'string') {
          return entry.title;
        }
      } catch { /* skip malformed lines */ }
    }
    return null;
  } catch {
    return null;
  }
}

export function syncBeadStatusToVBrief(
  beadId: string,
  workspacePath: string,
  status: VBriefItemStatus = 'completed',
  knownTitle?: string
): string | null {
  try {
    const doc = readWorkspacePlan(workspacePath);
    if (!doc) return null;

    let beadTitle: string | null = knownTitle ?? null;
    if (!beadTitle) {
      beadTitle = readBeadTitleFromJsonl(beadId, workspacePath);
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

    // io.ts handles vBRIEFInfo.updated, plan.updated, plan.sequence, and item.completed
    // timestamps automatically. Each call below constitutes one write → one sequence increment.
    updateItemStatus(workspacePath, matchingItem.id, status);

    // Also mark all AC subItems as completed when the parent item is completed.
    // Each updateSubItemStatus call increments sequence separately (one write per subItem).
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
 * Used by: verification gate, pan done, merge agent, prompt injection.
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
