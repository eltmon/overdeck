import type { AgentRuntimeSnapshot } from '@overdeck/contracts';
import type { SpawnRunOptions } from '../agents/spawn-prep.js';
import type { SlotMergeResult } from '../agents/slot-merge.js';
import type { SlotReconcileResult } from '../agents/slot-reconcile.js';
import type { PanIssueSwarmSlotCompletion } from '../pan-dir/record.js';
import type { findSpecByIssue } from '../pan-dir/specs.js';
import type { ReviewStatus } from '../review-status.js';
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
  tryReserveSwarmSlot: () => boolean;
  releaseSwarmSlot: () => void;
  spawnRun: (issueId: string, role: 'work', options: SpawnRunOptions) => Promise<unknown>;
  /** Per-issue hold: deaconIgnored (operator) suppresses all swarm coordination (PAN-2214);
   *  system-set `stuck` is logged but no longer halts coordination (PAN-2469). */
  getIssueHold?: (issueId: string) => Pick<ReviewStatus, 'stuck' | 'deaconIgnored' | 'stuckReason'> | null;
  /** Per-issue record statusOverrides — the durable item done-ness the merged plan view applies. */
  readStatusOverrides?: (workspacePath: string, issueId: string) => Record<string, string> | undefined;
  /** Durable per-slot completion marker written by `pan done`. */
  readSlotCompletion?: (workspacePath: string, issueId: string, slotIndex: number) => PanIssueSwarmSlotCompletion | undefined;
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
