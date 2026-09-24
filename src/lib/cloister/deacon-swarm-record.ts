/**
 * The swarm's slot ledger door (PAN-3917, D11).
 *
 * Same function surface as before; the storage underneath moved from the
 * per-issue record on the deleted state branch to `<workspace>/.pan/continues/
 * <ISSUE>.slots.json`. Every read and write goes through this door so the swarm
 * modules never touch the file directly.
 */
import {
  readSwarmSlotState,
  updateSwarmSlotState,
  type SwarmFailedMergeBlock,
  type SwarmSlotAssignment,
  type SwarmSlotCompletion,
  type SwarmSlotState,
  type SwarmSupersededAttempt,
} from './swarm-slot-store.js';

export { readSwarmSlotState } from './swarm-slot-store.js';

export type {
  SwarmFailedMergeBlock,
  SwarmSlotAssignment,
  SwarmSlotCompletion,
  SwarmSlotState,
  SwarmSupersededAttempt,
};

export async function writeSwarmSupersededAttempt(
  workspacePath: string,
  issueId: string,
  attempt: SwarmSupersededAttempt,
): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => ({
    ...state,
    supersededAttempts: [...(state.supersededAttempts ?? []), attempt],
  }));
}

export function readSwarmFailedMergeBlocks(
  workspacePath: string,
  issueId: string,
): NonNullable<SwarmSlotState['failedMergeBlocks']> {
  return readSwarmSlotState(workspacePath, issueId)?.failedMergeBlocks ?? {};
}

export async function writeSwarmFailedMergeBlock(
  workspacePath: string,
  issueId: string,
  block: SwarmFailedMergeBlock,
): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => ({
    ...state,
    failedMergeBlocks: { ...(state.failedMergeBlocks ?? {}), [String(block.slotIndex)]: block },
  }));
}

export async function clearSwarmFailedMergeBlock(
  workspacePath: string,
  issueId: string,
  slotIndex: number,
): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => {
    if (!state.failedMergeBlocks?.[String(slotIndex)]) return state;
    const failedMergeBlocks = { ...state.failedMergeBlocks };
    delete failedMergeBlocks[String(slotIndex)];
    return { ...state, failedMergeBlocks };
  });
}

export async function writeSwarmFinalizedAt(workspacePath: string, issueId: string, finalizedAt: string): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => ({ ...state, finalizedAt }));
}

export function readSwarmHold(workspacePath: string, issueId: string): SwarmSlotState['hold'] {
  return readSwarmSlotState(workspacePath, issueId)?.hold;
}

export async function writeSwarmHold(
  workspacePath: string,
  issueId: string,
  hold: NonNullable<SwarmSlotState['hold']>,
): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => ({ ...state, hold }));
}

export async function clearSwarmHold(workspacePath: string, issueId: string): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => {
    if (!state.hold) return state;
    const next = { ...state };
    delete next.hold;
    return next;
  });
}

export function readSwarmInterventionCount(
  workspacePath: string,
  issueId: string,
  slotIndex: number,
  failureClass: string,
): number {
  return readSwarmSlotState(workspacePath, issueId)?.interventions?.[String(slotIndex)]?.[failureClass] ?? 0;
}

export function readSwarmInterventions(
  workspacePath: string,
  issueId: string,
): NonNullable<SwarmSlotState['interventions']> {
  return readSwarmSlotState(workspacePath, issueId)?.interventions ?? {};
}

export function readSwarmCompletionObservation(
  workspacePath: string,
  issueId: string,
  progressKey: string,
): NonNullable<SwarmSlotState['completionObservations']>[string] | undefined {
  return readSwarmSlotState(workspacePath, issueId)?.completionObservations?.[progressKey];
}

export async function writeSwarmCompletionObservation(
  workspacePath: string,
  issueId: string,
  progressKey: string,
  observation: NonNullable<SwarmSlotState['completionObservations']>[string],
): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => ({
    ...state,
    completionObservations: { ...(state.completionObservations ?? {}), [progressKey]: observation },
  }));
}

export async function clearSwarmCompletionObservationRecord(
  workspacePath: string,
  issueId: string,
  progressKey: string,
): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => {
    if (!state.completionObservations?.[progressKey]) return state;
    const completionObservations = { ...state.completionObservations };
    delete completionObservations[progressKey];
    return { ...state, completionObservations };
  });
}

export async function writeSwarmForemanTakeover(
  workspacePath: string,
  issueId: string,
  itemId: string,
  slotIndex: number,
): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => ({
    ...state,
    reclaimedItems: {
      ...(state.reclaimedItems ?? {}),
      [itemId]: { slotIndex, reclaimedAt: new Date().toISOString() },
    },
  }));
}

export async function writeSwarmIntervention(
  workspacePath: string,
  issueId: string,
  slotIndex: number,
  failureClass: string,
  options: { operator?: boolean } = {},
): Promise<number | null> {
  let count: number | null = null;
  await updateSwarmSlotState(workspacePath, issueId, (state) => {
    const slotKey = String(slotIndex);
    const interventions = state.interventions ?? {};
    const slotInterventions = interventions[slotKey] ?? {};
    const current = slotInterventions[failureClass] ?? 0;
    if (current >= 3 && !options.operator) return state;
    count = current + 1;
    return {
      ...state,
      interventions: {
        ...interventions,
        [slotKey]: { ...slotInterventions, [failureClass]: count as number },
      },
    };
  });
  return count;
}

/**
 * PAN-3459: persist the issue-level swarm policy mode. An explicit
 * `pan swarm <id>` start opts the issue into ongoing coordination; without an
 * issue-level mode, a global `swarm.mode: off` (the default) makes every
 * subsequent patrol skip the issue entirely and the swarm orphans.
 */
export async function writeSwarmPolicyMode(
  workspacePath: string,
  issueId: string,
  mode: 'off' | 'auto' | 'always',
): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => ({
    ...state,
    policy: { ...(state.policy ?? {}), mode },
  }));
}

export function readSwarmSlotAssignments(workspacePath: string, issueId: string): SwarmSlotAssignment[] {
  return readSwarmSlotState(workspacePath, issueId)?.slotAssignments ?? [];
}

export async function writeSwarmSlotAssignment(
  workspacePath: string,
  issueId: string,
  assignment: SwarmSlotAssignment,
): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => {
    const assignments = state.slotAssignments ?? [];
    const existing = assignments.find((entry) => entry.slotIndex === assignment.slotIndex);
    const assignedAt = assignment.assignedAt ?? new Date().toISOString();
    return {
      ...state,
      slotAssignments: existing
        ? assignments.map((entry) => (entry.slotIndex === assignment.slotIndex
          ? { ...entry, ...assignment, assignedAt: entry.assignedAt ?? assignedAt }
          : entry))
        : [...assignments, { ...assignment, assignedAt }],
    };
  });
}

/**
 * PAN-2372 WI-3 / FR-4: persist a per-slot completion marker keyed by
 * `String(slotIndex)`. Read-modify-write preserves every other field.
 */
export async function writeSwarmSlotCompletion(
  workspacePath: string,
  issueId: string,
  completion: SwarmSlotCompletion,
): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => ({
    ...state,
    slotCompletions: {
      ...(state.slotCompletions ?? {}),
      [String(completion.slotIndex)]: completion,
    },
  }));
}

export function readSwarmSlotCompletion(
  workspacePath: string,
  issueId: string,
  slotIndex: number,
): SwarmSlotCompletion | undefined {
  return readSwarmSlotState(workspacePath, issueId)?.slotCompletions?.[String(slotIndex)];
}

/**
 * PAN-2372 WI-3 / FR-6: clear a slot's completion marker once the coordinator
 * has consumed it (merge/requeue). No-op when no marker exists.
 */
export async function clearSwarmSlotCompletion(workspacePath: string, issueId: string, slotIndex: number): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => {
    if (!state.slotCompletions?.[String(slotIndex)]) return state;
    const slotCompletions = { ...state.slotCompletions };
    delete slotCompletions[String(slotIndex)];
    return { ...state, slotCompletions };
  });
}

/**
 * Consume all ownership for a slot in one update. Merged-slot GC uses this
 * after it removes the worktree and branch, so a completion marker cannot
 * outlive the assignment and keep the freed index occupied.
 */
export async function clearSwarmSlotOwnership(
  workspacePath: string,
  issueId: string,
  slotIndex: number,
  _itemId?: string,
): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => {
    const slotCompletions = { ...(state.slotCompletions ?? {}) };
    delete slotCompletions[String(slotIndex)];
    return {
      ...state,
      slotAssignments: (state.slotAssignments ?? []).filter((entry) => entry.slotIndex !== slotIndex),
      slotCompletions,
    };
  });
}

export async function releaseBlockedSwarmSlot(
  workspacePath: string,
  issueId: string,
  slotIndex: number,
  itemId: string,
  branch?: string,
  archived?: { archivedBranch: string; archivedWorktree: string; replacementBranch: string; releasedAt: string },
): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => {
    const slotCompletions = { ...(state.slotCompletions ?? {}) };
    delete slotCompletions[String(slotIndex)];
    return {
      ...state,
      slotAssignments: (state.slotAssignments ?? []).filter((entry) => entry.slotIndex !== slotIndex),
      slotCompletions,
      releasedBlockedSlots: {
        ...(state.releasedBlockedSlots ?? {}),
        [String(slotIndex)]: {
          slotIndex,
          itemId,
          branch,
          ...archived,
          releasedAt: archived?.releasedAt ?? new Date().toISOString(),
        },
      },
    };
  });
}

export async function clearReleasedBlockedSwarmSlot(
  workspacePath: string,
  issueId: string,
  slotIndex: number,
): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => {
    if (!state.releasedBlockedSlots?.[String(slotIndex)]) return state;
    const releasedBlockedSlots = { ...state.releasedBlockedSlots };
    delete releasedBlockedSlots[String(slotIndex)];
    return { ...state, releasedBlockedSlots };
  });
}

/**
 * Drop every superseded-attempt entry (PAN-3694). A work-preserving swarm reset
 * removes all slot worktrees and branches, so the indexes those attempts
 * occupied are genuinely free; the archived branches remain on origin.
 */
export async function clearSupersededSwarmAttempts(workspacePath: string, issueId: string): Promise<void> {
  await updateSwarmSlotState(workspacePath, issueId, (state) => ({ ...state, supersededAttempts: [] }));
}

/**
 * PAN-2372 WI-3 / FR-4, FR-5: write the slot-completion marker and read it
 * straight back. Returns true only when the marker exists on disk with a
 * matching agentId. The slot `pan done` caller MUST refuse to mark the slot
 * done when this returns false — that is the whole point: a slot used to finish
 * without recording completion, so the coordinator could not observe it.
 */
export async function persistAndVerifySwarmSlotCompletion(
  workspacePath: string,
  issueId: string,
  completion: SwarmSlotCompletion,
): Promise<boolean> {
  await writeSwarmSlotCompletion(workspacePath, issueId, completion);
  const persisted = readSwarmSlotCompletion(workspacePath, issueId, completion.slotIndex);
  return Boolean(persisted && persisted.agentId === completion.agentId);
}
