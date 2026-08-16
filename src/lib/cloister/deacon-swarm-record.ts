import {
  readIssueRecordForWorkspaceSync,
  type PanIssueRecord,
  type PanIssueSwarmRecord,
  type PanIssueSwarmSlotCompletion,
} from '../pan-dir/record.js';
import { updateIssueRecordForWorkspace } from '../pan-dir/record-update.js';

export function createMinimalIssueRecord(issueId: string): PanIssueRecord {
  const now = new Date().toISOString();
  return {
    issueId,
    schemaVersion: 2,
    created: now,
    updated: now,
    feedback: [],
    pipeline: {
      issueId,
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
      readyForMerge: false,
      updatedAt: now,
    },
    closeOut: {
      usage: {
        byStage: {},
        totals: {},
      },
      merges: [],
      ranOn: '',
    },
  };
}

export async function writeSwarmFinalizedAt(workspacePath: string, issueId: string, finalizedAt: string): Promise<void> {
  const normalizedIssueId = issueId.toUpperCase();
  await updateIssueRecordForWorkspace(workspacePath, normalizedIssueId, (record) => ({
    ...record,
    swarm: {
      ...(record.swarm ?? {}),
      finalizedAt,
    },
  }));
}

export function readSwarmHold(workspacePath: string, issueId: string): PanIssueSwarmRecord['hold'] {
  return readIssueRecordForWorkspaceSync(workspacePath, issueId.toUpperCase())?.swarm?.hold;
}

export async function writeSwarmHold(
  workspacePath: string,
  issueId: string,
  hold: NonNullable<PanIssueSwarmRecord['hold']>,
): Promise<void> {
  await updateIssueRecordForWorkspace(workspacePath, issueId.toUpperCase(), (record) => ({
    ...record,
    swarm: { ...(record.swarm ?? {}), hold },
  }));
}

export async function clearSwarmHold(workspacePath: string, issueId: string): Promise<void> {
  await updateIssueRecordForWorkspace(workspacePath, issueId.toUpperCase(), (record) => {
    if (!record.swarm?.hold) return record;
    const swarm = { ...record.swarm };
    delete swarm.hold;
    return { ...record, swarm };
  });
}

export function readSwarmInterventionCount(
  workspacePath: string,
  issueId: string,
  slotIndex: number,
  failureClass: string,
): number {
  return readIssueRecordForWorkspaceSync(workspacePath, issueId.toUpperCase())
    ?.swarm?.interventions?.[String(slotIndex)]?.[failureClass] ?? 0;
}

export function readSwarmInterventions(
  workspacePath: string,
  issueId: string,
): NonNullable<PanIssueSwarmRecord['interventions']> {
  return readIssueRecordForWorkspaceSync(workspacePath, issueId.toUpperCase())?.swarm?.interventions ?? {};
}

export function readSwarmCompletionObservation(
  workspacePath: string,
  issueId: string,
  progressKey: string,
): NonNullable<PanIssueSwarmRecord['completionObservations']>[string] | undefined {
  return readIssueRecordForWorkspaceSync(workspacePath, issueId.toUpperCase())
    ?.swarm?.completionObservations?.[progressKey];
}

export async function writeSwarmCompletionObservation(
  workspacePath: string,
  issueId: string,
  progressKey: string,
  observation: NonNullable<PanIssueSwarmRecord['completionObservations']>[string],
): Promise<void> {
  await updateIssueRecordForWorkspace(workspacePath, issueId.toUpperCase(), record => ({
    ...record,
    swarm: {
      ...(record.swarm ?? {}),
      completionObservations: {
        ...(record.swarm?.completionObservations ?? {}),
        [progressKey]: observation,
      },
    },
  }));
}

export async function clearSwarmCompletionObservationRecord(
  workspacePath: string,
  issueId: string,
  progressKey: string,
): Promise<void> {
  await updateIssueRecordForWorkspace(workspacePath, issueId.toUpperCase(), record => {
    const existing = record.swarm?.completionObservations;
    if (!existing?.[progressKey]) return record;
    const completionObservations = { ...existing };
    delete completionObservations[progressKey];
    return { ...record, swarm: { ...(record.swarm ?? {}), completionObservations } };
  });
}

export async function writeSwarmForemanTakeover(
  workspacePath: string,
  issueId: string,
  itemId: string,
  slotIndex: number,
): Promise<void> {
  await updateIssueRecordForWorkspace(workspacePath, issueId.toUpperCase(), record => ({
    ...record,
    swarm: {
      ...(record.swarm ?? {}),
      reclaimedItems: {
        ...(record.swarm?.reclaimedItems ?? {}),
        [itemId]: { slotIndex, reclaimedAt: new Date().toISOString() },
      },
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
  await updateIssueRecordForWorkspace(workspacePath, issueId.toUpperCase(), (record) => {
    const slotKey = String(slotIndex);
    const interventions = record.swarm?.interventions ?? {};
    const slotInterventions = interventions[slotKey] ?? {};
    const current = slotInterventions[failureClass] ?? 0;
    if (current >= 3 && !options.operator) return record;
    count = current + 1;
    return {
      ...record,
      swarm: {
        ...(record.swarm ?? {}),
        interventions: {
          ...interventions,
          [slotKey]: { ...slotInterventions, [failureClass]: count as number },
        },
      },
    };
  });
  return count;
}

/**
 * PAN-3459: persist the issue-level swarm policy mode. An explicit
 * `pan swarm <id>` start opts the issue into ongoing Deacon coordination;
 * without a persisted issue-level mode, a global `swarm.mode: off` (the
 * default) makes every subsequent patrol skip the issue entirely — wave 1
 * dispatches and the swarm orphans: completed slot branches never merge and
 * remaining items never dispatch.
 */
export async function writeSwarmPolicyMode(
  workspacePath: string,
  issueId: string,
  mode: 'off' | 'auto' | 'always',
): Promise<void> {
  const normalizedIssueId = issueId.toUpperCase();
  await updateIssueRecordForWorkspace(workspacePath, normalizedIssueId, (record) => ({
    ...record,
    swarm: {
      ...(record.swarm ?? {}),
      policy: {
        ...(record.swarm?.policy ?? {}),
        mode,
      },
    },
  }));
}

/**
 * PAN-2372 WI-3 / FR-4: persist a durable per-slot completion marker keyed by
 * `String(slotIndex)`. Read-modify-write preserves every other record field
 * (statusOverrides, slotAssignments, etc.) — see the byte-identical
 * preservation test in deacon-swarm-slot-completion.test.ts.
 */
export async function writeSwarmSlotCompletion(
  workspacePath: string,
  issueId: string,
  completion: PanIssueSwarmSlotCompletion,
): Promise<void> {
  const normalizedIssueId = issueId.toUpperCase();
  await updateIssueRecordForWorkspace(workspacePath, normalizedIssueId, (record) => ({
    ...record,
    swarm: {
      ...(record.swarm ?? {}),
      slotCompletions: {
        ...(record.swarm?.slotCompletions ?? {}),
        [String(completion.slotIndex)]: completion,
      },
    },
  }));
}

/**
 * PAN-2372 WI-3 / FR-6: clear a slot's completion marker once the coordinator
 * (WI-4) has consumed it (merge/requeue). No-op when no marker exists for the
 * slot, so callers can clear unconditionally on the terminal transition.
 */
export async function clearSwarmSlotCompletion(workspacePath: string, issueId: string, slotIndex: number): Promise<void> {
  const normalizedIssueId = issueId.toUpperCase();
  const current = readIssueRecordForWorkspaceSync(workspacePath, normalizedIssueId);
  if (!current?.swarm?.slotCompletions || !(String(slotIndex) in current.swarm.slotCompletions)) return;
  await updateIssueRecordForWorkspace(workspacePath, normalizedIssueId, (record) => {
    const existing = record.swarm?.slotCompletions;
    if (!existing || !(String(slotIndex) in existing)) return record;
    const next: Record<string, PanIssueSwarmSlotCompletion> = { ...existing };
    delete next[String(slotIndex)];
    return { ...record, swarm: { ...record.swarm, slotCompletions: next } };
  });
}

/**
 * Consume all durable ownership for a slot in one record update. Merged-slot
 * GC uses this after it removes the worktree and branch so a completion marker
 * cannot outlive the assignment and keep the freed index occupied.
 */
export async function clearSwarmSlotOwnership(
  workspacePath: string,
  issueId: string,
  slotIndex: number,
  _itemId?: string,
): Promise<void> {
  const normalizedIssueId = issueId.toUpperCase();
  await updateIssueRecordForWorkspace(workspacePath, normalizedIssueId, (record) => {
    const swarm = record.swarm ?? {};
    const slotAssignments = (swarm.slotAssignments ?? []).filter(
      assignment => assignment.slotIndex !== slotIndex,
    );
    const slotCompletions = { ...(swarm.slotCompletions ?? {}) };
    delete slotCompletions[String(slotIndex)];
    return { ...record, swarm: { ...swarm, slotAssignments, slotCompletions } };
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
  const normalizedIssueId = issueId.toUpperCase();
  await updateIssueRecordForWorkspace(workspacePath, normalizedIssueId, (record) => {
    const swarm = record.swarm ?? {};
    const slotAssignments = (swarm.slotAssignments ?? []).filter(
      assignment => assignment.slotIndex !== slotIndex,
    );
    const slotCompletions = { ...(swarm.slotCompletions ?? {}) };
    delete slotCompletions[String(slotIndex)];
    return {
      ...record,
      swarm: {
        ...swarm,
        slotAssignments,
        slotCompletions,
        releasedBlockedSlots: {
          ...(swarm.releasedBlockedSlots ?? {}),
          [String(slotIndex)]: {
            slotIndex,
            itemId,
            branch,
            ...archived,
            releasedAt: archived?.releasedAt ?? new Date().toISOString(),
          },
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
  await updateIssueRecordForWorkspace(workspacePath, issueId.toUpperCase(), record => {
    const releasedBlockedSlots = { ...(record.swarm?.releasedBlockedSlots ?? {}) };
    delete releasedBlockedSlots[String(slotIndex)];
    return { ...record, swarm: { ...(record.swarm ?? {}), releasedBlockedSlots } };
  });
}

/**
 * Drop every superseded-attempt record (PAN-3694). A work-preserving swarm
 * reset removes all slot worktrees and branches, so the slot indexes the
 * superseded attempts occupied are genuinely free — but
 * `applySupersededSlotHighWater` kept reserving indexes 1..high-water,
 * leaving a fresh swarm able to dispatch only high-water+1. The archived
 * branches remain on origin; only the index-blocking record is cleared.
 */
export async function clearSupersededSwarmAttempts(workspacePath: string, issueId: string): Promise<void> {
  const normalizedIssueId = issueId.toUpperCase();
  await updateIssueRecordForWorkspace(workspacePath, normalizedIssueId, (record) => ({
    ...record,
    swarm: {
      ...(record.swarm ?? {}),
      supersededAttempts: [],
    },
  }));
}

/**
 * PAN-2372 WI-3 / FR-4, FR-5: write the durable slot-completion marker and read
 * it straight back to confirm it persisted. Returns true only when the keyed
 * marker exists on disk with a matching agentId. The slot `pan done` caller MUST
 * refuse to mark the slot done when this returns false — that is the whole point
 * of the issue: a slot used to finish without durably recording completion, so
 * the coordinator could not observe it. Keeping the write+verify here (not inline
 * in the CLI command) keeps the god-file done.ts from growing and co-locates the
 * swarm-record mechanics with the other slot-completion door functions.
 */
export async function persistAndVerifySwarmSlotCompletion(
  workspacePath: string,
  issueId: string,
  completion: PanIssueSwarmSlotCompletion,
): Promise<boolean> {
  await writeSwarmSlotCompletion(workspacePath, issueId, completion);
  const reread = readIssueRecordForWorkspaceSync(workspacePath, issueId.toUpperCase());
  const persisted = reread?.swarm?.slotCompletions?.[String(completion.slotIndex)];
  return Boolean(persisted && persisted.agentId === completion.agentId);
}
