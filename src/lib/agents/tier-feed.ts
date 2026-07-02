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

import { exec } from 'child_process';
import { promisify } from 'util';
import { deliverAgentMessage, type DeliveryResult } from './delivery.js';
import type { StandingTierAgent } from './standing-tiers.js';

const execAsync = promisify(exec);

export interface BroadcastCommitOptions {
  /** Workspace (or any checkout) whose git history contains the commit. */
  workspace: string;
  /** The landed commit to broadcast. */
  sha: string;
  /** Title of the bead the commit implements, shown in the feed header. */
  beadTitle: string;
  /** The standing tier agents to deliver to — every one of them hears it. */
  tiers: Array<Pick<StandingTierAgent, 'tierName' | 'agentId'>>;
  /** Injectable delivery seam for tests. Defaults to deliverAgentMessage. */
  deliver?: (agentId: string, message: string, caller?: string) => Promise<DeliveryResult>;
  /** Injectable `git show` runner for tests. Defaults to running git in the workspace. */
  gitShow?: (workspace: string, sha: string) => Promise<string>;
}

export interface BroadcastDelivery {
  tierName: string;
  agentId: string;
  result: DeliveryResult;
}

async function runGitShow(workspace: string, sha: string): Promise<string> {
  const { stdout } = await execAsync(`git show ${JSON.stringify(sha)}`, {
    cwd: workspace,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Compose the ingestion-only feed message for one commit. Deterministic over
 * (sha, beadTitle, diff) so replay reconstructs byte-identical messages.
 */
export function composeCommitFeedMessage(sha: string, beadTitle: string, diff: string): string {
  return [
    `# Commit feed (ingestion-only): ${sha}`,
    '',
    `Bead: ${beadTitle}`,
    '',
    'This is an ingestion-only feed delivery. Read the diff below to stay',
    'current with work landing on this issue. Do NOT respond to this message,',
    'do NOT take any action, and do NOT produce output — wait for your next',
    'dispatch.',
    '',
    '```diff',
    diff.trimEnd(),
    '```',
  ].join('\n');
}

/**
 * Broadcast one landed commit to every standing tier agent. Sends exactly one
 * delivery per tier (everyone hears everything). A failed delivery to one
 * tier does not block the others; failures surface in the returned results.
 */
export async function broadcastCommit(options: BroadcastCommitOptions): Promise<BroadcastDelivery[]> {
  const gitShow = options.gitShow ?? runGitShow;
  const deliver = options.deliver ?? deliverAgentMessage;

  const diff = await gitShow(options.workspace, options.sha);
  const message = composeCommitFeedMessage(options.sha, options.beadTitle, diff);

  const deliveries: BroadcastDelivery[] = [];
  for (const tier of options.tiers) {
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
    deliveries.push({ tierName: tier.tierName, agentId: tier.agentId, result });
  }
  return deliveries;
}
