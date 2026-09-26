/**
 * Lane door request, result and error types (.pan/drafts/pan-4223.md WI-3 step 1).
 */
import type { LaneRole, LegacyConversation } from '../overdeck/conversations.js';

export interface LaneLaunchRequest {
  /** Launching conversation: numeric id, name or `conv-<name>`. */
  parent: string;
  run?: string;
  key: string;
  role: LaneRole;
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
}

export interface LaneLaunchResult {
  conversation: LegacyConversation;
  cwd: string;
  branch: string | null;
  iteration: number;
  warnings: string[];
}

export class LaneLaunchError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 500, message: string) {
    super(message);
    this.name = 'LaneLaunchError';
  }
}
