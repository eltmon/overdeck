/**
 * Type definitions for the merge-sync layer (overdeck.db merge train).
 *
 * Relocated from the legacy src/lib/database/{pending-auto-merges-db,uat-generations-db}.ts
 * SQLite modules (PAN-1983) so those panopticon.db-backed modules can be deleted. These are
 * the canonical shapes; merge-sync.ts re-exports them so existing import paths keep working.
 */
import type { ForgeType } from '../forge.js';

export type PendingAutoMergeStatus = 'pending' | 'merging' | 'blocked' | 'failed' | 'merged' | 'cancelled';

export interface PendingAutoMerge {
  id: number;
  issueId: string;
  prUrl: string;
  prNumber?: number;
  projectKey: string;
  forge: ForgeType;
  status: PendingAutoMergeStatus;
  /** Absolute ISO timestamp for when the server may attempt the merge; survives process sleep. */
  scheduledMergeAt: string;
  /** Absolute ISO timestamp for when this cooldown entry was scheduled; survives process sleep. */
  scheduledAt: string;
  mergedAt?: string;
  /** Free-text failure/blocker detail, truncated to 1024 characters. */
  failureReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

export type UatGenerationStatus =
  | 'assembling'
  | 'ready'
  | 'superseded'
  | 'invalidated'
  | 'promoted'
  | 'failed';

/** A feature bundled into (or queued for) a generation. */
export interface UatGenerationMember {
  issueId: string;
  title: string;
  /** Feature branch, e.g. feature/pan-1704. */
  branch: string;
  /** Head SHA of the feature branch at assembly time — staleness detection. */
  headSha: string;
  /** 1-based position in the merge order. */
  mergeOrder: number;
  pr?: number;
  prUrl?: string;
}

export interface UatGenerationHeldOut {
  issueId: string;
  /** Feature branch attempted when the generation held this issue out. */
  branch?: string;
  /** Head SHA of the attempted feature branch at assembly time. */
  headSha?: string;
  reason: string;
}

export interface UatGenerationResolution {
  /** The member being merged plus the already-merged members it collided with. */
  issueIds: string[];
  files: string[];
  commitSha: string;
}

export interface UatGeneration {
  /** Branch name doubles as the identifier, e.g. uat/calm-otter-0610. */
  name: string;
  worktreePath: string;
  projectRoot: string;
  /** SHA of origin/main the branch was assembled off. */
  baseSha: string;
  status: UatGenerationStatus;
  members: UatGenerationMember[];
  heldOut: UatGenerationHeldOut[];
  resolutions: UatGenerationResolution[];
  /** ISO timestamp while this generation's live stack is up, else null. */
  stackStartedAt: string | null;
  /** ISO timestamp once branch/worktree/stack artifacts have been cleaned. */
  cleanedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
