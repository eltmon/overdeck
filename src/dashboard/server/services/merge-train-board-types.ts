/**
 * The merge-train board payload (PAN-4753 WI-7): everything one `MergeTrain`
 * component renders, per project, served by `GET /api/merge-train/board`.
 *
 * The frontend keeps a copy of these types in
 * `src/dashboard/frontend/src/components/merge-train/train/boardTypes.ts`;
 * change both together.
 */
import type { UatGenerationPayload } from './uat-train.js';

/** One car's state, in the board's precedence order (merging wins). */
export type CarState = 'merging' | 'failed' | 'blocked' | 'cooldown' | 'held' | 'ready';

export type BlockerType = 'failing_checks' | 'merge_conflict' | 'unresolved_conversations'
  | 'changes_requested' | 'draft_pr' | 'not_mergeable';

export interface CarBlocker { type: BlockerType; summary: string; details?: string }

/** One PR link: `#4758`, or `frontend !612` for a polyrepo member. */
export interface CarPr { label: string; url: string | null }

/** The nine merge-run steps, in order (`MergeRun.step`). */
export type MergeStepKey = 'queued' | 'validating-pr' | 'preparing-work-agent' | 'rebasing'
  | 'stripping-planning' | 'verifying' | 'reporting-statuses' | 'squash-merging' | 'post-merge-cleanup';

export interface TrainCar {
  issueId: string;
  title: string;
  branch: string;
  prs: CarPr[];
  state: CarState;
  route: 'auto-merge' | 'batch';
  /** Label policy; null = following the project. */
  policy: 'auto' | 'hold' | null;
  effectivePolicy: 'auto' | 'hold';
  /** False when the tracker cannot carry the labels (R9). */
  policyWritable: boolean;
  /** Head approval time; null hides "ready N ago". */
  readyAt: string | null;
  /** Cooldown end for state `cooldown`. */
  mergeAt: string | null;
  /** The pending auto-merge row, for Cancel. */
  autoMergeRowId: number | null;
  /** Merge-run step for `merging` / `failed`. */
  step: MergeStepKey | null;
  /** Merge-run notes or the failure reason. */
  notes: string | null;
  blockers: CarBlocker[];
  uatNotes: string | null;
  /** Name of the live batch it belongs to (the Merge-alone confirm names it, R3). */
  liveBatch: string | null;
}

export type StrikeState = 'checks-pending' | 'reviewing' | 'flagged' | 'waiting-uat'
  | 'queued' | 'merging' | 'failed' | 'blocked' | 'ready';

export interface TrainStrike {
  issueId: string;
  title: string;
  branch: string;
  prNumber: number;
  prUrl: string;
  state: StrikeState;
  route: 'auto-merge' | 'batch';
  /** Journal `review.verdict` summary when flagged. */
  reviewSummary: string | null;
  notes: string | null;
  step: MergeStepKey | null;
  blockers: CarBlocker[];
}

export interface RecentMerge {
  issueIds: string[];
  sha: string | null;
  mergedAt: string;
  via: 'auto-merge' | 'batch' | 'overdeck' | 'outside-train';
  batchName?: string;
  version?: string;
  /** FR-16: an outside-train merge that beat its scheduled auto-merge. */
  warning?: string;
}

/**
 * D4 batch window for the project's window lane, so the card can say when
 * the next batch assembles. Null when the window does not apply (a hold
 * project, GitLab, polyrepo, the train off, or the project lacks batch CI).
 */
export interface BatchWindowState {
  size: number;
  waitMinutes: number;
  /** Normal-priority ready features waiting for the window (not in a live batch). */
  waiting: number;
  /** When the next batch assembles: now when `waiting >= size`, else oldest ready + wait. Null when nothing waits. */
  nextBatchAt: string | null;
}

export interface BoardProject {
  projectKey: string;
  projectName: string;
  /** `eltmon/overdeck`. */
  repo: string | null;
  forge: 'github' | 'gitlab' | null;
  /** Member repo keys of a polyrepo project. */
  polyrepo: string[] | null;
  /** Effective train flag (master switch, then the project override). */
  enabled: boolean;
  override: 'enabled' | 'disabled' | null;
  mode: 'auto' | 'hold';
  /** AUTO_MERGE_COOLDOWN_MS / 60_000. */
  cooldownMinutes: number;
  window: BatchWindowState | null;
  cars: TrainCar[];
  strikes: TrainStrike[];
  /** The whole chain (CHAIN_PAYLOAD_LIMIT), newest first, with status reasons. */
  batches: UatGenerationPayload[];
  /** At most five, newest first. */
  recent: RecentMerge[];
  error?: string;
}

export interface MergeTrainBoard { masterEnabled: boolean; projects: BoardProject[] }
