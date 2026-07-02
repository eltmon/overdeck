/**
 * Commit feed for standing tier agents (PAN-1791, FR-7 / D10 v1).
 *
 * After each commit lands, broadcastCommit composes one ingestion-only feed
 * message (bead title + `git show <sha>` diff) and delivers it to EVERY
 * standing tier agent through deliverAgentMessage — the existing delivery
 * primitive, no new transport. v1 is everyone-hears-everything: no per-tier
 * relevance filtering, so any agent's feed is reconstructible from
 * `git log <base>..HEAD` plus the standing-tier set — exactly what replay
 * (tier-replay) consumes to rebuild a respawned session's feed.
 *
 * Feed messages are ingestion-only: the message text instructs the recipient
 * not to respond, so per-event output cost stays ~0 (NFR-1).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deliverAgentMessage, type DeliveryResult } from './delivery.js';
import type { StandingTierAgent } from './standing-tiers.js';
import { estimateFeedDeliveryTokens, recordTierFeedDelivery } from './tier-metrics.js';
import type { ValidatedTieredExecutionFeedConfig } from './tier-table.js';
import { DEFAULT_TIERED_EXECUTION_CONFIG } from './tier-table.js';

const execFileAsync = promisify(execFile);

const DEFAULT_FEED_CONFIG = DEFAULT_TIERED_EXECUTION_CONFIG.feed;

export interface BroadcastCommitOptions {
  /** Workspace (or any checkout) whose git history contains the commit. */
  workspace: string;
  /** The landed commit to broadcast. */
  sha: string;
  /** Title of the bead the commit implements, shown in the feed header. */
  beadTitle: string;
  /** Commit subject used by feed.exclude_subjects. Defaults to beadTitle for legacy callers. */
  commitSubject?: string;
  /** The standing tier agents to deliver to — every one of them hears it. */
  tiers: Array<Pick<StandingTierAgent, 'tierName' | 'agentId'>>;
  /** Issue id for delivery metrics. */
  issueId?: string;
  /** Dashboard API base URL used in the listener call-out curl snippet. */
  apiUrl?: string;
  /** Feed filtering/rendering config. Defaults preserve today's raw git-show behavior. */
  feedConfig?: ValidatedTieredExecutionFeedConfig;
  /** Injectable delivery seam for tests. Defaults to deliverAgentMessage. */
  deliver?: (agentId: string, message: string, caller?: string) => Promise<DeliveryResult>;
  /** Legacy injectable `git show` runner for tests. Defaults to the shared renderer. */
  gitShow?: (workspace: string, sha: string) => Promise<string>;
  /** Injectable shared renderer seam for tests. Defaults to renderCommitFeedDiff. */
  renderDiff?: (workspace: string, sha: string, feedConfig: ValidatedTieredExecutionFeedConfig) => Promise<string>;
  /** Injectable metric recorder for tests. Defaults to the tier metrics JSONL log. */
  recordDelivery?: typeof recordTierFeedDelivery;
  /** Injectable clock for deterministic delivery metric tests. */
  now?: () => Date;
}

export interface BroadcastDelivery {
  tierName: string;
  agentId: string;
  result: DeliveryResult;
}

export interface RenderCommitFeedDiffDeps {
  gitShow?: (workspace: string, sha: string, args: string[]) => Promise<string>;
}

export interface CommitFeedCalloutContext {
  apiUrl: string;
  issueId: string;
  tierName: string;
  agentId: string;
}

async function runGitShow(workspace: string, sha: string, args: string[] = []): Promise<string> {
  const { stdout } = await execFileAsync('git', ['show', sha, ...args], {
    cwd: workspace,
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

export function shouldSkipFeedSubject(
  subject: string,
  feedConfig: Pick<ValidatedTieredExecutionFeedConfig, 'exclude_subjects'>,
): boolean {
  return feedConfig.exclude_subjects.some(prefix => subject.startsWith(prefix));
}

export async function renderCommitFeedDiff(
  workspace: string,
  sha: string,
  feedConfig: ValidatedTieredExecutionFeedConfig = DEFAULT_FEED_CONFIG,
  deps: RenderCommitFeedDiffDeps = {},
): Promise<string> {
  const gitShow = deps.gitShow ?? runGitShow;
  const pathspecArgs = feedConfig.exclude.length > 0
    ? ['--', '.', ...feedConfig.exclude.map(glob => `:(exclude)${glob}`)]
    : [];
  const diff = await gitShow(workspace, sha, pathspecArgs);
  const maxBytes = feedConfig.max_diff_bytes;
  if (maxBytes === null || Buffer.byteLength(diff, 'utf-8') <= maxBytes) return diff;

  const stat = await gitShow(workspace, sha, ['--stat']);
  return [
    stat.trimEnd(),
    '',
    `[tiered_execution.feed.max_diff_bytes truncated commit diff: ${Buffer.byteLength(diff, 'utf-8')} bytes exceeded ${maxBytes} bytes]`,
    '',
  ].join('\n');
}

export function resolveFeedApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.OVERDECK_DASHBOARD_URL
    ?? env.DASHBOARD_URL
    ?? `http://localhost:${env.API_PORT ?? env.PORT ?? '3011'}`;
}

/**
 * Compose the ingestion-only feed message for one commit. Deterministic over
 * (sha, beadTitle, diff) so replay reconstructs byte-identical messages.
 */
export function composeCommitFeedMessage(
  sha: string,
  beadTitle: string,
  diff: string,
  callout?: CommitFeedCalloutContext,
): string {
  const lines = [
    `# Commit feed (ingestion-only): ${sha}`,
    '',
    `Bead: ${beadTitle}`,
    '',
  ];

  if (callout) {
    const body = JSON.stringify({
      issueId: callout.issueId,
      sha,
      tierName: callout.tierName,
      agentId: callout.agentId,
      claim: '<one sentence: what is wrong and where>',
    });
    lines.push(
      'This is an ingestion-only feed delivery. Read the diff below to stay',
      'current with work landing on this issue. By default: do NOT respond, do',
      'NOT take any action, do NOT produce output — wait for your next dispatch.',
      '',
      'ONE exception. If you believe this commit is WRONG — it misreads the bead\'s',
      'spec, hollows out a test, or breaks a stated invariant — you may raise at',
      'most one call-out, then return to silence:',
      '',
      `  curl -X POST ${callout.apiUrl}/api/tiered/callouts \\`,
      '    -H "Content-Type: application/json" \\',
      `    -d '${body}'`,
      '',
      'Do not fix it yourself. Do not edit files. A call-out is a flag, not a task.',
    );
  } else {
    lines.push(
      'This is an ingestion-only feed delivery. Read the diff below to stay',
      'current with work landing on this issue. Do NOT respond to this message,',
      'do NOT take any action, and do NOT produce output — wait for your next',
      'dispatch.',
    );
  }

  lines.push('', '```diff', diff.trimEnd(), '```');
  return lines.join('\n');
}

/**
 * Broadcast one landed commit to every standing tier agent. Sends exactly one
 * delivery per tier (everyone hears everything). A failed delivery to one
 * tier does not block the others; failures surface in the returned results.
 */
export async function broadcastCommit(options: BroadcastCommitOptions): Promise<BroadcastDelivery[]> {
  const feedConfig = options.feedConfig ?? DEFAULT_FEED_CONFIG;
  const subject = options.commitSubject ?? options.beadTitle;
  if (shouldSkipFeedSubject(subject, feedConfig)) return [];

  const renderDiff = options.renderDiff
    ?? (options.gitShow
      ? (workspace: string, sha: string) => options.gitShow!(workspace, sha)
      : renderCommitFeedDiff);
  const deliver = options.deliver ?? deliverAgentMessage;
  const recordDelivery = options.recordDelivery ?? recordTierFeedDelivery;
  const now = options.now ?? (() => new Date());

  const diff = await renderDiff(options.workspace, options.sha, feedConfig);
  const baseMessage = composeCommitFeedMessage(options.sha, options.beadTitle, diff);
  const baseTokenCount = estimateFeedDeliveryTokens(baseMessage);
  const includeCallout = feedConfig.callouts !== 'off' && options.issueId !== undefined;
  const apiUrl = options.apiUrl ?? resolveFeedApiUrl();

  const deliveries: BroadcastDelivery[] = [];
  for (const tier of options.tiers) {
    const message = includeCallout
      ? composeCommitFeedMessage(options.sha, options.beadTitle, diff, {
        apiUrl,
        issueId: options.issueId!,
        tierName: tier.tierName,
        agentId: tier.agentId,
      })
      : baseMessage;
    const tokenCount = includeCallout ? estimateFeedDeliveryTokens(message) : baseTokenCount;
    let result: DeliveryResult;
    try {
      result = await deliver(tier.agentId, message, 'tier-feed:broadcastCommit');
    } catch (err) {
      result = {
        ok: false,
        path: 'tmux',
        failure: err instanceof Error ? err.message : String(err),
      };
    }
    await recordDelivery({
      ts: now().toISOString(),
      issueId: options.issueId,
      sha: options.sha,
      beadTitle: options.beadTitle,
      tierName: tier.tierName,
      agentId: tier.agentId,
      tokenCount,
      result,
    });
    deliveries.push({ tierName: tier.tierName, agentId: tier.agentId, result });
  }
  return deliveries;
}
