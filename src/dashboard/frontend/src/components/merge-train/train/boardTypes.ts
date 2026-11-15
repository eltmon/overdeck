/**
 * Merge-train board payload types (PAN-4753 WI-10), copied from the server's
 * `src/dashboard/server/services/merge-train-board-types.ts`. Change both
 * together. `UatGenerationPayload` moved here from the retired merge-train view and
 * gained `statusReason` (WI-3).
 */

export type CarState = 'merging' | 'failed' | 'blocked' | 'cooldown' | 'held' | 'ready';

export type BlockerType = 'failing_checks' | 'merge_conflict' | 'unresolved_conversations'
  | 'changes_requested' | 'draft_pr' | 'not_mergeable';

export interface CarBlocker { type: BlockerType; summary: string; details?: string }

export interface CarPr { label: string; url: string | null }

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
  /** False when the tracker cannot carry the labels. */
  policyWritable: boolean;
  readyAt: string | null;
  mergeAt: string | null;
  autoMergeRowId: number | null;
  step: MergeStepKey | null;
  notes: string | null;
  blockers: CarBlocker[];
  uatNotes: string | null;
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
  warning?: string;
}

export interface BatchWindowState {
  size: number;
  waitMinutes: number;
  waiting: number;
  nextBatchAt: string | null;
}

export interface UatGenerationMember {
  issueId: string;
  title: string;
  branch: string;
  pr?: number;
  prUrl?: string;
  mergeOrder: number;
  acceptanceCriteria: Array<{ title: string; status: string }>;
  /** False when the server could not resolve the issue's xBRIEF. */
  planResolved?: boolean;
}

export type UatGenerationStatus = 'assembling' | 'ready' | 'superseded' | 'invalidated' | 'promoted' | 'failed';

export interface UatGenerationPayload {
  name: string;
  status: UatGenerationStatus;
  baseSha: string;
  createdAt: string;
  updatedAt: string;
  members: UatGenerationMember[];
  heldOut: Array<{ issueId: string; reason: string }>;
  resolutions: Array<{ issueIds: string[]; files: string[]; commitSha: string }>;
  versionSyncConfigured?: boolean;
  shipStatus?: {
    status: 'pending' | 'passed' | 'partial' | 'failed';
    version?: string;
    batch: string;
    paths?: Array<{ path: string; ok: boolean; detail: string }>;
    errorCode?: string;
    at: string;
  } | null;
  /** Why the batch became superseded or invalidated (WI-3); null otherwise. */
  statusReason?: string | null;
  /** Per-repo base (polyrepo has several). */
  repos?: Array<{
    repoKey: string;
    branch: string;
    baseSha: string;
    targetBranch: string;
    mergeOrder: number;
    promotedAt?: string | null;
    mergeSha?: string | null;
  }>;
  stack: {
    status: 'running' | 'degraded' | 'unknown' | 'absent';
    frontendUrl: string;
    downServices?: string[];
    serviceErrors?: Record<string, string>;
    probeError?: string;
  };
}

export interface BoardProject {
  projectKey: string;
  projectName: string;
  repo: string | null;
  forge: 'github' | 'gitlab' | null;
  polyrepo: string[] | null;
  enabled: boolean;
  override: 'enabled' | 'disabled' | null;
  mode: 'auto' | 'hold';
  cooldownMinutes: number;
  window: BatchWindowState | null;
  /** Project-wide notes, e.g. the scheduler skipped the whole project (PAN-5036). */
  notices: string[];
  cars: TrainCar[];
  strikes: TrainStrike[];
  batches: UatGenerationPayload[];
  recent: RecentMerge[];
  error?: string;
}

export interface MergeTrainBoard { masterEnabled: boolean; projects: BoardProject[] }
