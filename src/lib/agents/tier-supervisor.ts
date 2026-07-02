/**
 * Standing supervisor agent for tiered execution (PAN-1791).
 *
 * The supervisor is a long-lived, review-only agent spawned once per issue
 * from the tier table's `supervisor` block. It subscribes to the commit feed
 * according to the configured subscription policy and reviews work at commit
 * boundaries — it NEVER implements. This module owns spawn + subscription
 * only; verdict posting to the inspect-status surface is the next bead
 * (supervisor-verdict-surface).
 */

import type { VBriefItem } from '../vbrief/types.js';
import type { AgentState } from './agent-state.js';
import type {
  TieredExecutionSubscription,
  TieredExecutionSupervisorConfig,
} from './tier-table.js';
import { spawnRun } from './spawn.js';
import { runAgentId } from './spawn-prep.js';

/**
 * Sub-role under 'review' for the standing supervisor. Review sub-roles skip
 * the roles/review.md convoy definition injection (roleAgentDefinitionPath
 * returns null for review+subRole), so the supervisor's behavior comes
 * entirely from the prompt delivered here.
 */
export const SUPERVISOR_SUB_ROLE = 'supervisor';

/** Default fraction of beads reviewed under the 'sampled' subscription policy. */
export const DEFAULT_SUPERVISOR_SAMPLE_RATE = 0.25;

export function supervisorAgentId(issueId: string): string {
  return runAgentId(issueId, 'review', SUPERVISOR_SUB_ROLE);
}

export interface ShouldSuperviseOptions {
  /**
   * Sampling rate in (0, 1] applied under the 'sampled' policy.
   * Defaults to DEFAULT_SUPERVISOR_SAMPLE_RATE.
   */
  sampleRate?: number;
}

/**
 * Subscription policy: does the supervisor review commits for this bead?
 *
 * - 'all'     → every bead.
 * - 'flagged' → only beads with metadata.requiresInspection === true.
 * - 'sampled' → a deterministic per-bead sample at the configured rate.
 */
export function shouldSupervise(
  bead: Pick<VBriefItem, 'id' | 'metadata'>,
  policy: TieredExecutionSubscription,
  options: ShouldSuperviseOptions = {},
): boolean {
  switch (policy) {
    case 'all':
      return true;
    case 'flagged':
      return bead.metadata?.requiresInspection === true;
    case 'sampled': {
      const rate = options.sampleRate ?? DEFAULT_SUPERVISOR_SAMPLE_RATE;
      if (rate <= 0) return false;
      if (rate >= 1) return true;
      return sampleFraction(bead.id) < rate;
    }
  }
}

/**
 * Deterministic per-bead sample position: FNV-1a over the bead id mapped to
 * [0, 1). Deterministic (never Math.random) so a bead's subscription decision
 * is stable across the live commit feed, replay re-delivery (tier-replay),
 * and tests.
 */
function sampleFraction(beadId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < beadId.length; i++) {
    hash ^= beadId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

export interface SpawnTierSupervisorOptions {
  /** Workspace to run in. Defaults to spawnRun's per-issue default workspace. */
  workspace?: string;
  /** Override the generated standing-supervisor kickoff prompt. */
  prompt?: string;
}

/**
 * Spawn the standing supervisor as a registered role run (agent state +
 * conversation record + tmux session on the overdeck socket), so the
 * dashboard discovers it under its issue like any other specialist.
 *
 * Model comes from the tier table's supervisor block. The configured harness
 * is passed through for the spawn record, but per PAN-1984 harness resolution
 * is provider-default-only — the tier-table validator already guarantees the
 * configured model+harness+auth combination is policy-legal.
 */
export async function spawnTierSupervisor(
  issueId: string,
  supervisor: TieredExecutionSupervisorConfig,
  options: SpawnTierSupervisorOptions = {},
): Promise<AgentState> {
  return spawnRun(issueId, 'review', {
    agentId: supervisorAgentId(issueId),
    subRole: SUPERVISOR_SUB_ROLE,
    model: supervisor.model,
    harness: supervisor.harness,
    workspace: options.workspace,
    prompt: options.prompt ?? buildSupervisorPrompt(issueId, supervisor.subscribe),
  });
}

export function buildSupervisorPrompt(
  issueId: string,
  subscribe: TieredExecutionSubscription,
): string {
  const policyLine = {
    all: 'You are subscribed to EVERY commit in this issue.',
    flagged: 'You are subscribed only to commits for beads flagged requiresInspection=true.',
    sampled: 'You are subscribed to a deterministic sample of the beads in this issue.',
  }[subscribe];

  return [
    `# Standing Supervisor: ${issueId}`,
    '',
    'You are the standing supervisor for tiered execution on this issue. You are a',
    'review-only agent: you NEVER write, edit, or commit implementation code.',
    '',
    `Subscription policy: ${subscribe}. ${policyLine}`,
    '',
    'Commit diffs will be delivered to this session as the tier agents land work.',
    'For each delivered commit, read the diff against the bead\'s acceptance',
    'criteria and note whether the work satisfies them. Ingest each delivery and',
    'wait for the next; do not take action beyond review. The verdict-posting',
    'surface is wired separately — until it is, record findings in your replies',
    'to each delivery.',
    '',
    'Stay resident. Do not exit after a review; the next commit delivery arrives',
    'in this same session.',
  ].join('\n');
}
