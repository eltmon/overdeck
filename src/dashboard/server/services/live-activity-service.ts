/**
 * PAN-4839: this machine's counts for the phone's Live Activity, and the
 * sender that reports them to the overdeck.ai directory.
 *
 * `needsYou` is the size of this machine's Needs-You feed (the conversations
 * with an open blocking surface plus the agents with pending input), the same
 * rows the phone's Needs-you list shows. `running` counts the agents in the
 * dashboard pill's running set, so the phone and the desktop agree (D-7).
 * Fleet rows of linked machines are not counted (D-8).
 *
 * The sender runs whenever a phone record exists and the directory is online,
 * independent of the `push` config (D-9). Primary dashboard only: a peer would
 * report the same counts twice.
 */
import type { LiveActivityCounts } from '@overdeck/contracts';

import { listActiveRecordsOfKind } from '../../../lib/access-tokens.js';
import { createLiveActivitySender, type LiveActivitySender } from '../../../lib/push/live-activity-sender.js';
import { type AgentPendingRow, readAgentSnapshots } from './agent-snapshots-access.js';
import { currentDirectoryClient } from './directory-client.js';
import { buildNeedsYou, type NeedsYouFeed } from './needs-you-feed.js';

/** The dashboard pill's running set (AgentPillPopoverRow.tsx:3), so phone and desktop agree (D-7). */
export const RUNNING_AGENT_STATUSES: ReadonlySet<string> = new Set(['running', 'active', 'starting', 'thinking', 'working']);

export interface LiveActivityCountsDeps {
  needsYou: () => Promise<NeedsYouFeed>;
  agents: () => Promise<ReadonlyArray<AgentPendingRow>>;
}

const defaultCountsDeps: LiveActivityCountsDeps = { needsYou: () => buildNeedsYou(), agents: readAgentSnapshots };

export async function readLiveActivityCounts(deps: LiveActivityCountsDeps = defaultCountsDeps): Promise<LiveActivityCounts> {
  const [feed, agents] = await Promise.all([deps.needsYou(), deps.agents()]);
  return {
    needsYou: feed.conversations.length + feed.agents.length,
    running: agents.filter((agent) => agent.status !== undefined && RUNNING_AGENT_STATUSES.has(agent.status)).length,
  };
}

/** The directory clientIds of this machine's active phone records; a record without one is skipped. */
export function activityPhoneIds(): string[] {
  return listActiveRecordsOfKind('phone').flatMap((record) => (record.clientId ? [record.clientId] : []));
}

let sender: LiveActivitySender | null = null;

export function startLiveActivityService(): void {
  if (sender !== null) return;
  sender = createLiveActivitySender({ counts: () => readLiveActivityCounts(), phones: activityPhoneIds, directory: currentDirectoryClient });
  sender.start();
}

export function stopLiveActivityService(): void {
  sender?.stop();
  sender = null;
}
