import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ModelId } from '../settings.js';
import type { RuntimeName } from '../runtimes/types.js';
import type { VBriefDocument, VBriefItem } from '../vbrief/types.js';
import { getModelCapabilitySync, hasModelCapabilitySync, resolveModelIdSync } from '../model-capabilities.js';
import type { AgentState } from './agent-state.js';
import type { DeliveryResult } from './delivery.js';
import { deliverAgentMessage } from './delivery.js';
import { spawnRun } from './spawn.js';
import type { SpawnRunOptions } from './spawn-prep.js';
import { listSlotOwnership } from './slot-reconcile.js';
import type { InFlightBead } from './standing-tiers.js';
import {
  composeCommitFeedMessage,
  renderCommitFeedDiff,
  shouldSkipFeedSubject,
} from './tier-feed.js';
import {
  buildSupervisorReviewMessage,
  extractAcceptanceCriteria,
  extractTracedFrText,
  shouldSupervise,
  supervisorAgentId as defaultSupervisorAgentId,
  SUPERVISOR_SUB_ROLE,
} from './tier-supervisor.js';
import type { TieredExecutionSupervisorConfig, ValidatedTieredExecutionFeedConfig } from './tier-table.js';
import { DEFAULT_TIERED_EXECUTION_CONFIG } from './tier-table.js';
import { stopAgent } from './termination.js';

const execFileAsync = promisify(execFile);
const DEFAULT_REPLAY_THRESHOLD = 0.5;

export interface ReplayCommit {
  sha: string;
  subject: string;
  diff: string;
}

export interface ReplayDelivery {
  sha: string;
  result: DeliveryResult;
}

export interface ReplayResult {
  agent: AgentState;
  commits: ReplayCommit[];
  deliveries: ReplayDelivery[];
}

export interface ReplayTargetBase {
  issueId: string;
  workspace: string;
  /**
   * Base revision for replay. The feed is reconstructed from
   * `git log --reverse <base>..HEAD`.
   */
  base: string;
  /** Existing dead/stale agent id, if known. */
  agentId?: string;
  /** Optional prompt for the fresh standing session. */
  prompt?: string;
  /** Feed filtering/rendering config. Defaults preserve today's raw git-show behavior. */
  feedConfig?: ValidatedTieredExecutionFeedConfig;
}

export interface ReplayStandingTierTarget extends ReplayTargetBase {
  kind: 'tier';
  tierName: string;
  /** Registered standing slot index. Resolved from slot-reconcile when omitted. */
  slotIndex?: number;
  /** First item assigned to the standing slot. Resolved from slot-reconcile when omitted. */
  slotItemId?: string;
}

export interface ReplaySupervisorTarget extends ReplayTargetBase {
  kind: 'supervisor';
  supervisor: TieredExecutionSupervisorConfig;
  /** Plan used to apply the supervisor subscription policy to replay commits. */
  doc: VBriefDocument;
  /** PRD markdown used to replay traced requirement text, when available. */
  prdMarkdown?: string;
  apiUrl?: string;
}

export type ReplayTarget = ReplayStandingTierTarget | ReplaySupervisorTarget;

export interface TierReplayDeps {
  spawn?: typeof spawnRun;
  deliver?: typeof deliverAgentMessage;
  stop?: typeof stopAgent;
  gitLog?: (workspace: string, base: string) => Promise<Array<{ sha: string; subject: string }>>;
  gitShow?: (workspace: string, sha: string) => Promise<string>;
  renderDiff?: (workspace: string, sha: string, feedConfig: ValidatedTieredExecutionFeedConfig) => Promise<string>;
  listSlotOwnership?: typeof listSlotOwnership;
}

export interface TierReplayOptions {
  deps?: TierReplayDeps;
}

export interface TierRunCompactionInput {
  /** True only between tier runs. Compaction is forbidden inside a bead. */
  atRunBoundary: boolean;
  /** Any in-flight bead blocks compaction, even if the caller says it is at a boundary. */
  inFlightBead?: InFlightBead;
  estimatedContextTokens: number;
  modelContextWindow: number;
  replayThreshold?: number;
}

export interface TierRunCompactionOptions {
  target: ReplayTarget;
  compaction: TierRunCompactionInput;
  deps?: TierReplayDeps;
}

/**
 * Replay a dead standing tier agent or standing supervisor:
 * respawn the registered session and re-deliver its commit feed reconstructed
 * from `git log <base>..HEAD`, oldest commit first.
 */
export async function replayStandingAgent(
  target: ReplayTarget,
  options: TierReplayOptions = {},
): Promise<ReplayResult> {
  const deps = replayDeps(options.deps);
  const agent = await spawnReplayTarget(target, deps);
  const commits = await loadReplayCommits(
    target.workspace,
    target.base,
    target.feedConfig ?? DEFAULT_TIERED_EXECUTION_CONFIG.feed,
    deps,
  );
  const deliveries = target.kind === 'tier'
    ? await replayTierFeed(agent.id, commits, deps)
    : await replaySupervisorFeed(agent.id, target, commits, deps);

  return { agent, commits, deliveries };
}

/**
 * Crash/orphan entry point. The caller has already determined the old session
 * is dead; replay respawns and reconstructs the feed without human input.
 */
export async function replayCrashedStandingAgent(
  target: ReplayTarget,
  options: TierReplayOptions = {},
): Promise<ReplayResult> {
  return replayStandingAgent(target, options);
}

/**
 * Threshold-triggered compaction entry point. It only acts at a tier-run
 * boundary and only when no bead is in flight; mid-bead compaction returns
 * `null` by construction.
 */
export async function compactAtTierRunBoundary(
  options: TierRunCompactionOptions,
): Promise<ReplayResult | null> {
  if (!shouldReplayCompactAtTierRunBoundary(options.compaction)) return null;
  const deps = replayDeps(options.deps);
  if (options.target.agentId) {
    await deps.stop(options.target.agentId);
  }
  return replayStandingAgent(options.target, { deps });
}

export function shouldReplayCompactAtTierRunBoundary(input: TierRunCompactionInput): boolean {
  if (!input.atRunBoundary) return false;
  if (input.inFlightBead) return false;
  if (!Number.isFinite(input.estimatedContextTokens) || input.estimatedContextTokens < 0) return false;
  if (!Number.isFinite(input.modelContextWindow) || input.modelContextWindow <= 0) return false;
  const threshold = input.replayThreshold ?? DEFAULT_REPLAY_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) return false;
  return input.estimatedContextTokens / input.modelContextWindow >= threshold;
}

export function contextWindowForModel(model: string): number | undefined {
  const resolved = resolveModelIdSync(model);
  if (!hasModelCapabilitySync(resolved)) return undefined;
  return getModelCapabilitySync(resolved as ModelId).contextWindow;
}

async function spawnReplayTarget(target: ReplayTarget, deps: Required<TierReplayDeps>): Promise<AgentState> {
  if (target.kind === 'supervisor') {
    return deps.spawn(target.issueId, 'review', {
      agentId: target.agentId ?? defaultSupervisorAgentId(target.issueId),
      subRole: SUPERVISOR_SUB_ROLE,
      model: target.supervisor.model,
      harness: target.supervisor.harness,
      workspace: target.workspace,
      prompt: target.prompt,
    });
  }

  const slot = resolveReplaySlot(target, deps);
  const spawnOptions: SpawnRunOptions = {
    slotIndex: slot.slotIndex,
    slotItemId: slot.slotItemId,
    prompt: target.prompt,
  };
  return deps.spawn(target.issueId, 'work', spawnOptions);
}

function resolveReplaySlot(
  target: ReplayStandingTierTarget,
  deps: Required<TierReplayDeps>,
): { slotIndex: number; slotItemId: string } {
  if (target.slotIndex !== undefined && target.slotItemId !== undefined) {
    return { slotIndex: target.slotIndex, slotItemId: target.slotItemId };
  }

  const ownership = deps.listSlotOwnership(target.issueId, target.workspace);
  const match = target.slotItemId
    ? ownership.find((assignment) => assignment.itemId === target.slotItemId)
    : ownership.find((assignment) => assignment.agentId === target.agentId);
  if (!match) {
    throw new Error(
      `Cannot replay standing tier '${target.tierName}' for ${target.issueId}: slot ownership was not found`,
    );
  }
  return { slotIndex: match.slotIndex, slotItemId: match.itemId };
}

async function replayTierFeed(
  agentId: string,
  commits: ReplayCommit[],
  deps: Required<TierReplayDeps>,
): Promise<ReplayDelivery[]> {
  const deliveries: ReplayDelivery[] = [];
  for (const commit of commits) {
    const message = composeCommitFeedMessage(commit.sha, commit.subject, commit.diff);
    deliveries.push({
      sha: commit.sha,
      result: await deps.deliver(agentId, message, 'tier-replay:tier'),
    });
  }
  return deliveries;
}

async function replaySupervisorFeed(
  agentId: string,
  target: ReplaySupervisorTarget,
  commits: ReplayCommit[],
  deps: Required<TierReplayDeps>,
): Promise<ReplayDelivery[]> {
  const deliveries: ReplayDelivery[] = [];
  for (const commit of commits) {
    const item = findReplayItem(target.doc, commit);
    if (!item || !shouldSupervise(item, target.supervisor.subscribe)) continue;
    const traces = Array.isArray(item.metadata?.traces) ? item.metadata.traces as string[] : [];
    const frText = target.prdMarkdown && traces.length > 0
      ? extractTracedFrText(target.prdMarkdown, traces)
      : undefined;
    const message = buildSupervisorReviewMessage({
      issueId: target.issueId,
      beadId: item.id,
      beadTitle: item.title,
      sha: commit.sha,
      diff: commit.diff,
      acceptanceCriteria: extractAcceptanceCriteria(item),
      frText,
      apiUrl: target.apiUrl ?? 'http://localhost:3011',
    });
    deliveries.push({
      sha: commit.sha,
      result: await deps.deliver(agentId, message, 'tier-replay:supervisor'),
    });
  }
  return deliveries;
}

function findReplayItem(doc: VBriefDocument, commit: Pick<ReplayCommit, 'subject'>): VBriefItem | undefined {
  return doc.plan.items.find((item) => {
    const subject = commit.subject.toLowerCase();
    return subject.includes(item.id.toLowerCase()) || subject.includes(item.title.toLowerCase());
  });
}

async function loadReplayCommits(
  workspace: string,
  base: string,
  feedConfig: ValidatedTieredExecutionFeedConfig,
  deps: Required<TierReplayDeps>,
): Promise<ReplayCommit[]> {
  const entries = await deps.gitLog(workspace, base);
  const commits: ReplayCommit[] = [];
  for (const entry of entries) {
    if (shouldSkipFeedSubject(entry.subject, feedConfig)) continue;
    commits.push({
      ...entry,
      diff: await deps.renderDiff(workspace, entry.sha, feedConfig),
    });
  }
  return commits;
}

async function runGitLog(workspace: string, base: string): Promise<Array<{ sha: string; subject: string }>> {
  const { stdout } = await execFileAsync('git', ['log', '--reverse', '--format=%H%x00%s', `${base}..HEAD`], {
    cwd: workspace,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout
    .split('\n')
    .map((line) => {
      const [sha, subject = ''] = line.split('\0');
      return { sha, subject };
    })
    .filter((entry) => entry.sha.trim().length > 0);
}

async function runGitShow(workspace: string, sha: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['show', sha], {
    cwd: workspace,
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

function replayDeps(deps: TierReplayDeps = {}): Required<TierReplayDeps> {
  return {
    spawn: deps.spawn ?? spawnRun,
    deliver: deps.deliver ?? deliverAgentMessage,
    stop: deps.stop ?? stopAgent,
    gitLog: deps.gitLog ?? runGitLog,
    gitShow: deps.gitShow ?? runGitShow,
    renderDiff: deps.renderDiff
      ?? (deps.gitShow
        ? (workspace, sha) => deps.gitShow!(workspace, sha)
        : renderCommitFeedDiff),
    listSlotOwnership: deps.listSlotOwnership ?? listSlotOwnership,
  };
}
