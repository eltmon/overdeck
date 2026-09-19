import type { AgentRuntimeSnapshot } from '@overdeck/contracts';
import type { SpawnRunOptions } from '../agents/spawn-prep.js';
import type { SlotMergeResult } from '../agents/slot-merge.js';
import type { SlotReconcileResult } from './swarm-slot-reconcile.js';
import type { SwarmSlotCompletion } from './swarm-slot-store.js';
import type { findSpecByIssue } from '../pan-dir/specs.js';
import type { resolveAutomaticSwarmPolicy } from '../swarm-policy.js';
import type { PersistedTaskOperation } from '../xbrief/dag.js';
import type { XBriefDocument, XBriefItem } from '../xbrief/types.js';
import type { FeatureWorkspace } from './deacon-workspaces.js';
import type {
  clearSwarmCompletionObservationRecord,
  readSwarmCompletionObservation,
  readSwarmHold,
  writeSwarmCompletionObservation,
  writeSwarmForemanTakeover,
} from './deacon-swarm-record.js';
import type { ensureSwarmForeman } from './swarm-foreman.js';
import type { SwarmForemanLivenessDeps } from './swarm-foreman-liveness.js';

export interface ArchivedBlockedSlot {
  archivedBranch: string;
  archivedWorktree: string;
  replacementBranch: string;
  releasedAt: string;
}

/** Dependencies used by one swarm coordinator patrol. */
export interface CoordinateSwarmSlotsDeps {
  findSpecByIssue?: typeof findSpecByIssue;
  listFeatureWorkspaces: () => FeatureWorkspace[];
  reconcileSlotState: (
    issueId: string,
    workspace: string,
    doc: XBriefDocument,
  ) => Promise<SlotReconcileResult>;
  listSessionNames: () => Promise<readonly string[]>;
  isPaneDead: (sessionName: string) => Promise<boolean>;
  getPaneExitStatus: (sessionName: string) => Promise<number | null>;
  /**
   * PAN-3720: diagnostics only — NEVER merge authority. `classifyInFlightSlots`
   * deliberately does not consult this: static slot ids cross assignment
   * generations, so a terminal `done|completed` resolution may belong to a
   * prior assignment and can never classify a slot ready-to-merge.
   */
  getAgentRuntimeState: (agentId: string) => Promise<Pick<AgentRuntimeSnapshot, 'resolution'> | null>;
  getPaneOutputDigest: (sessionName: string) => Promise<string>;
  getBranchTipCommitTime: (workspacePath: string, branch: string) => Promise<number | null>;
  getSlotBranchAheadCount: (workspacePath: string, issueId: string, branch: string) => Promise<number>;
  isSlotWorktreeClean: (slotWorkspacePath: string) => Promise<boolean>;
  isSlotBranchPushed?: (workspacePath: string, issueId: string, branch: string) => Promise<boolean>;
  sendCompletionNudge?: (agentId: string, issueId: string) => Promise<void>;
  readCompletionObservation?: typeof readSwarmCompletionObservation;
  writeCompletionObservation?: typeof writeSwarmCompletionObservation;
  clearCompletionObservation?: typeof clearSwarmCompletionObservationRecord;
  archiveBlockedSlot?: (issueId: string, workspacePath: string, slotIndex: number, branch: string) => Promise<ArchivedBlockedSlot>;
  prepareReleasedSlot?: (issueId: string, workspacePath: string, slotIndex: number, itemId: string, branch: string) => Promise<void>;
  slotWorktreeExists: (slotWorkspacePath: string) => boolean;
  verifyAndMergeSlot: (
    issue: { issueId: string; featureWorkspace: string; slotBranch?: string; slotWorkspace?: string },
    slotIndex: number,
    item: XBriefItem,
  ) => Promise<SlotMergeResult>;
  applyTaskOperationToPlanFile: (issueId: string, operation: PersistedTaskOperation, workspacePath?: string) => Promise<unknown>;
  /** PAN-2385: fire the tiered commit feed + supervisor review after a slot merges. */
  fireTieredCommitHooks: (
    options: { issueId: string; workspacePath: string; item: XBriefItem; doc: XBriefDocument },
  ) => Promise<string[]>;
  recordSlotAssignment: (workspacePath: string, issueId: string, assignment: SlotAssignment) => Promise<void>;
  clearSlotAssignment: (workspacePath: string, issueId: string, slotIndex: number, itemId?: string) => Promise<void>;
  runGitCommand: (command: string, cwd: string) => Promise<unknown>;
  registeredSlotCapacityAvailable: (issueId: string, selectedCount: number) => boolean;
  /** PAN-3917: the running count comes from the backend inventory, so this is async. */
  tryReserveSwarmSlot: () => Promise<boolean>;
  releaseSwarmSlot: () => void;
  spawnRun: (issueId: string, role: 'work', options: SpawnRunOptions) => Promise<unknown>;
  /**
   * Per-issue swarm hold (PAN-3917): the swarm's own ledger entry, set by
   * `pan swarm hold`, is the only per-issue halt. The old system-set `stuck`
   * and operator `deaconIgnored` flags lived on the review-status row and are
   * gone with it.
   */
  getIssueHold?: (issueId: string, workspacePath: string) => { reason: string } | null;
  /** Item id → status from the issue's continue file — the one home for item progress. */
  readItemStatuses?: (workspacePath: string, issueId: string) => Record<string, string>;
  /** Per-slot completion marker written by `pan done`. */
  readSlotCompletion?: (workspacePath: string, issueId: string, slotIndex: number) => SwarmSlotCompletion | undefined;
  /** Delete a stale durable marker that does not belong to the active item. */
  clearSlotCompletion?: (workspacePath: string, issueId: string, slotIndex: number) => Promise<void>;
  /** Re-evaluated immediately before every slot spawn. */
  shouldDispatch?: (issueId: string) => boolean;
  readSwarmHold?: typeof readSwarmHold;
  /** Inclusive upper bound for slot index allocation. */
  getMaxSlotIndex?: () => number;
  /** Durable slot assignments from the issue record. */
  listSlotAssignments?: (issueId: string, workspacePath: string) => Array<{ slotIndex: number }>;
  listReleasedSlotIndexes?: (issueId: string, workspacePath: string) => number[];
  recordForemanTakeover?: typeof writeSwarmForemanTakeover;
  ensureSwarmForeman?: typeof ensureSwarmForeman;
  workResumeSlotsAvailable?: SwarmForemanLivenessDeps['workResumeSlotsAvailable'];
  writeSwarmHold?: SwarmForemanLivenessDeps['writeSwarmHold'];
  emitActivityEntry?: SwarmForemanLivenessDeps['emitActivityEntry'];
  sendStallEvent?: (agentId: string, message: string) => Promise<unknown>;
  resolveAutomaticSwarmPolicy?: typeof resolveAutomaticSwarmPolicy;
  getReleasedSlotBranch?: (issueId: string, workspacePath: string, slotIndex: number) => string | undefined;
  clearReleasedSlot?: (workspacePath: string, issueId: string, slotIndex: number) => Promise<void>;
}

export interface SlotAssignment {
  slotIndex: number;
  itemId: string;
  agentId?: string;
  branch?: string;
}
