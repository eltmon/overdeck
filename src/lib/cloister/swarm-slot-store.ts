/**
 * Swarm slot state on disk, in the repo (PAN-3917, D11).
 *
 * `pan swarm` stays in the tree but is not wired into the default work path.
 * Its slot bookkeeping — which slot holds which item, which slot reported done,
 * which blocked slot was released — used to live in the `swarm` block of a
 * per-issue record on the deleted state branch. That branch is no longer a
 * data plane, so the same document now sits beside the issue's continue file:
 *
 *   `<workspace>/.pan/continues/<ISSUE>.slots.json`
 *
 * This is genuinely owned state (a dispatch ledger for panes the swarm itself
 * created), not a copy of a fact another system owns, so it survives the cut —
 * it just moves into the repo where the rest of the plan lives.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { resolvePlanHome } from '../pan-dir/paths.js';

export interface SwarmSlotAssignment {
  slotIndex: number;
  itemId: string;
  agentId?: string;
  branch?: string;
  assignedAt?: string;
}

export interface SwarmSlotCompletion {
  slotIndex: number;
  itemId?: string;
  agentId: string;
  completedAt: string;
}

export interface SwarmFailedMergeBlock {
  issueId: string;
  itemId: string;
  slotIndex: number;
  branch?: string;
  note: string;
}

export interface SwarmSupersededAttempt {
  slotIndex: number;
  itemId: string;
  agentId?: string;
  branch?: string;
  archivedBranch?: string;
  archivedWorktree?: string;
  reason: string;
  supersededAt: string;
}

export interface SwarmReleasedBlockedSlot {
  slotIndex: number;
  itemId: string;
  branch?: string;
  archivedBranch?: string;
  archivedWorktree?: string;
  replacementBranch?: string;
  releasedAt: string;
}

/** The whole swarm document for one issue. Every field is optional. */
export interface SwarmSlotState {
  issueId: string;
  policy?: { mode?: 'off' | 'auto' | 'always'; maxSlots?: number; autoAdvance?: boolean };
  finalizedAt?: string;
  hold?: { reason: string; setBy: string; at: string };
  /** Recovery attempts keyed by slot index, then stable failure class. */
  interventions?: Record<string, Record<string, number>>;
  /** Completion-inference samples keyed by the slot progress identity. */
  completionObservations?: Record<string, { signature: string; nudged: boolean; consecutiveDoneCount: number }>;
  /** Serial foreman takeovers, keyed by item id. */
  reclaimedItems?: Record<string, { slotIndex: number; reclaimedAt: string }>;
  slotAssignments?: SwarmSlotAssignment[];
  slotCompletions?: Record<string, SwarmSlotCompletion>;
  failedMergeBlocks?: Record<string, SwarmFailedMergeBlock>;
  releasedBlockedSlots?: Record<string, SwarmReleasedBlockedSlot>;
  supersededAttempts?: SwarmSupersededAttempt[];
}

export const SWARM_SLOT_FILENAME_SUFFIX = '.slots.json';

/**
 * `<planHome>/.pan/continues/<ISSUE>.slots.json` — beside the issue's continue
 * file, because the slot ledger is the same kind of thing: per-issue progress
 * the repo owns. Callers hand in a workspace path (the natural handle at every
 * call site), so the plan home is resolved here; for a polyrepo project that is
 * the infra repo, not the workspace.
 */
export function swarmSlotStatePath(workspacePath: string, issueId: string): string {
  const planHome = resolvePlanHome(resolve(workspacePath, '..', '..'));
  return join(planHome, '.pan', 'continues', `${issueId.toUpperCase()}${SWARM_SLOT_FILENAME_SUFFIX}`);
}

export function readSwarmSlotState(workspacePath: string, issueId: string): SwarmSlotState | null {
  const path = swarmSlotStatePath(workspacePath, issueId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as SwarmSlotState;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeSwarmSlotState(workspacePath: string, state: SwarmSlotState): void {
  const path = swarmSlotStatePath(workspacePath, state.issueId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

/**
 * Read-modify-write one issue's swarm document. The updater receives the
 * current state (an empty document when none exists) and returns the next one;
 * returning the same object writes nothing.
 */
export async function updateSwarmSlotState(
  workspacePath: string,
  issueId: string,
  update: (current: SwarmSlotState) => SwarmSlotState,
): Promise<SwarmSlotState> {
  const normalized = issueId.toUpperCase();
  const current = readSwarmSlotState(workspacePath, normalized) ?? { issueId: normalized };
  const next = update(current);
  if (next === current) return current;
  writeSwarmSlotState(workspacePath, { ...next, issueId: normalized });
  return next;
}
