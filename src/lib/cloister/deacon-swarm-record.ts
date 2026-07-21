import {
  readIssueRecordForWorkspaceSync,
  type PanIssueRecord,
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
