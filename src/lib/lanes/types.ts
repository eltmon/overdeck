/**
 * Lane door request, result and error types (.pan/drafts/pan-4223.md WI-3 step 1).
 */
import type { PlacementRejection } from '@overdeck/contracts';

import type { LaneRole } from '../overdeck/conversations.js';
import type { LaneAnswering } from './contract.js';

export interface LaneLaunchRequest {
  /** Launching conversation: numeric id, name or `conv-<name>`. */
  parent: string;
  run?: string;
  /** Required, except for a critic or verifier with `for` (it defaults to `for`). */
  key?: string;
  role: LaneRole;
  /** Critic (required) and verifier (optional): the builder lane key judged (FR-31, D29). */
  for?: string;
  /** Default: the parent's projectKey. */
  project?: string;
  model?: string;
  harness?: string;
  effort?: string;
  /** Brief text (the CLI reads --brief <file> or --prompt). */
  brief: string;
  /** Original brief path, recorded in the brief header only. */
  briefSource?: string;
  title?: string;
  /** Builder only. */
  branch?: string;
  /** Base ref override. */
  from?: string;
  /** Critic and verifier: required. Orchestrator: optional, default the base ref. */
  at?: string;
  reuse?: boolean;
  replace?: boolean;
  /** PAN-4311: launch even while CPU pressure is saturated. */
  force?: boolean;
  /** PAN-4638 FR-1: a linked machine's label or environment id, or `auto`; the route resolves it. */
  machine?: string;
  /** PAN-4638 FR-1: capability tags Auto placement must match. */
  needs?: string[];
}

/** The launched lane's identity. A remote lane has no local row, so its id is null (D-4638-4). */
export interface LaneLaunchConversation {
  id: number | null;
  name: string;
  gauntletRun: string;
  laneKey: string;
  laneRole: LaneRole;
}

/** PAN-5006: why Auto placement chose the lane's machine, and the machines it passed over. */
export interface LanePlacement {
  label: string;
  reason: string;
  rejections: PlacementRejection[];
}

export interface LaneLaunchResult {
  conversation: LaneLaunchConversation;
  cwd: string;
  branch: string | null;
  iteration: number;
  warnings: string[];
  /** PAN-4638: the machine that runs the lane; null for a lane on this machine. */
  machine: { environmentId: string; label: string; reason: string | null } | null;
  /** PAN-5006: set when Auto chose the machine (this one or a linked one); null otherwise. */
  placement: LanePlacement | null;
}

export class LaneLaunchError extends Error {
  /** A machine-readable refusal code, e.g. `name-taken` (PAN-4638 D-4638-2). */
  constructor(readonly status: 400 | 403 | 404 | 409 | 429 | 500 | 503, message: string, readonly code?: string) {
    super(message);
    this.name = 'LaneLaunchError';
  }
}

/** Branch, head, commits ahead of upstream and dirtiness of a lane's worktree (NFR-3 of PAN-4223). */
export interface LaneGitFacts {
  branch: string | null;
  head: string | null;
  ahead: number | null;
  dirty: boolean;
}

/** PAN-4638 WI-2: what home sends the owner; home computed every field from the run's rows (D-4638-1). */
export interface OwnerLaneSpec {
  name: string;
  run: string;
  key: string;
  role: LaneRole;
  iteration: number;
  brief: string;
  briefHeader: string;
  title: string;
  model: string;
  harness: string;
  effort: string | null;
  /** Builder only: the lane branch. */
  branch: string | null;
  /** Builder only: the ref a new branch is cut from; null = the owner's base ref. */
  base: string | null;
  /** Critic and verifier: the commit judged. */
  at: string | null;
  /** `--reuse`: continue in this directory on the owner. */
  reuseCwd: string | null;
  answering: LaneAnswering | null;
  force: boolean;
}

export interface OwnerLaneResult {
  name: string;
  cwd: string;
  branch: string | null;
  warnings: string[];
}
