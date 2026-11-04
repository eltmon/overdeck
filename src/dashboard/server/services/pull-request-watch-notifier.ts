/**
 * PR watch notifier (PAN-4943 W-PR1, WI-4): compares each watched PR's fresh
 * snapshot with its watch's own baseline, persists the result, then delivers
 * one message per wake. Called once per sweep pass, at the end of
 * `runPullRequestSyncOnce` (WI-5); never its own timer.
 *
 * D-6: the new store state is written under the watch store's file lock
 * first; delivery happens afterwards, outside the lock, so a crash between
 * the two loses a message rather than sending it twice. D-13: an owner with
 * no active, unrevoked agent token is dropped in the same locked update,
 * without a message — the backstop for a crash between token revocation and
 * `revokeAgentMcpTokens`'s own watch cleanup.
 */
import type { PullRequestSnapshot } from '@overdeck/contracts';

import { listAccessTokens } from '../../../lib/access-tokens.js';
import { messageAgent } from '../../../lib/agents/messaging.js';
import { isSupersededConversation, resolveClearChainHead } from '../../../lib/overdeck/conversation-clear-chain.js';
import { isPiControlChannelHarness } from '../../../lib/overdeck/conversation-delivery.js';
import { handleConversationMessage } from '../../../lib/overdeck/conversation-message.js';
import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import { resolveSessionFile } from '../../../lib/overdeck/conversation-reads.js';
import {
  baselineFromSnapshot,
  listPullRequestWatches,
  updatePullRequestWatches,
  type PullRequestWatch,
  type PullRequestWatchBaseline,
  type PullRequestWatchOwner,
} from '../../../lib/overdeck/pull-request-watches.js';

export type WatchEvent = 'merged' | 'closed' | 'checks-failed' | 'checks-passed' | 'conflicting' | 'review-changed';

/** D-5: the 11th consecutive review-only wake ends the watch. */
const MAX_QUIET_WAKES = 10;

export interface WatchWakeResult {
  events: WatchEvent[];
  last: PullRequestWatchBaseline;
  quietWakes: number;
  ends: boolean;
  text: string | null;
}

function phrase(event: WatchEvent, last: PullRequestWatchBaseline, snapshot: PullRequestSnapshot): string {
  switch (event) {
    case 'merged':
      return 'merged';
    case 'closed':
      return 'closed without merging';
    case 'checks-failed':
      return `checks failed (was ${last.checks})`;
    case 'checks-passed':
      return `checks passed (was ${last.checks})`;
    case 'conflicting':
      return 'has merge conflicts';
    case 'review-changed':
      return `review is now ${snapshot.reviewState} (was ${last.reviewState})`;
  }
}

/** PAN-4943 D-3 to D-5: pure comparison of one watch's baseline with a fresh snapshot. */
export function watchWake(watch: PullRequestWatch, snapshot: PullRequestSnapshot): WatchWakeResult {
  const last = watch.last;
  const events: WatchEvent[] = [];
  if (last.state === 'open' && snapshot.state === 'merged') events.push('merged');
  if (last.state === 'open' && snapshot.state === 'closed') events.push('closed');
  if (snapshot.checks === 'red' && last.checks !== 'red') events.push('checks-failed');
  if (snapshot.checks === 'green' && last.checks !== 'green') events.push('checks-passed');
  if (snapshot.mergeable === false && last.mergeable !== false) events.push('conflicting');
  if (snapshot.reviewState !== last.reviewState) events.push('review-changed');

  const nextLast = baselineFromSnapshot(snapshot, last);
  if (events.length === 0) return { events, last: nextLast, quietWakes: watch.quietWakes, ends: false, text: null };

  let quietWakes = watch.quietWakes;
  if (events.includes('checks-failed') || events.includes('checks-passed')) quietWakes = 0;
  else if (events.includes('review-changed')) quietWakes += 1;

  const mergedOrClosed = events.includes('merged') || events.includes('closed');
  const quietLimitReached = quietWakes === MAX_QUIET_WAKES + 1;
  const ends = mergedOrClosed || quietLimitReached;

  let text = `[Overdeck] ${watch.repository}#${watch.number}: ${events.map((event) => phrase(event, last, snapshot)).join('; ')}. ${watch.url}`;
  if (mergedOrClosed) text += ' The watch has ended.';
  else if (quietLimitReached) text += ' The watch has ended after 10 review-only updates; call watch_pull_request again to keep watching.';

  return { events, last: nextLast, quietWakes, ends, text };
}

function keyString(watch: Pick<PullRequestWatch, 'host' | 'repository' | 'number'>): string {
  return `${watch.host}/${watch.repository}#${watch.number}`;
}

function ownerKey(owner: PullRequestWatchOwner): string {
  return `${owner.agentKind}:${owner.agentId}`;
}

/** Distinct PR keys across every stored watch, for the sweep's uncovered-key pass (WI-5). */
export async function listWatchedPullRequestKeys(): Promise<Array<{ host: string; repository: string; number: number; url: string }>> {
  const watches = await listPullRequestWatches();
  const byKey = new Map<string, { host: string; repository: string; number: number; url: string }>();
  for (const watch of watches) {
    const id = keyString(watch);
    if (!byKey.has(id)) byKey.set(id, { host: watch.host, repository: watch.repository, number: watch.number, url: watch.url });
  }
  return [...byKey.values()];
}

export interface WatchNotifierDeps {
  listActiveOwners(): Promise<ReadonlySet<string>>;
  deliverToAgent(agentId: string, text: string, dedupKey: string): Promise<boolean>;
  deliverToConversation(name: string, text: string): Promise<boolean>;
}

async function defaultListActiveOwners(): Promise<ReadonlySet<string>> {
  const owners = new Set<string>();
  for (const record of await listAccessTokens()) {
    if (record.kind !== 'token' || record.revokedAt || record.agentId === undefined || record.agentKind === undefined) continue;
    owners.add(`${record.agentKind}:${record.agentId}`);
  }
  return owners;
}

/** D-7: agentKind 'agent' delivers through messageAgent; success includes a mail-queued fallback. */
async function defaultDeliverToAgent(agentId: string, text: string, dedupKey: string): Promise<boolean> {
  const outcome = await messageAgent(agentId, text, 'pr-watch', { dedupKey });
  return outcome.delivered || outcome.queuedToMail;
}

/** D-7: agentKind 'conversation' delivers through handleConversationMessage, following a superseded /clear chain. */
async function defaultDeliverToConversation(name: string, text: string): Promise<boolean> {
  let conv = getConversationByName(name);
  if (!conv) return false;
  if (isSupersededConversation(conv)) {
    conv = resolveClearChainHead(conv);
    if (!conv) return false;
  }
  const response = await handleConversationMessage(
    conv.name,
    { message: text, ...(isPiControlChannelHarness(conv.harness ?? 'claude-code') ? { deliverAs: 'follow_up' } : {}) },
    { resolveSessionFile, generateAiTitle: async () => {} },
  );
  return response.status >= 200 && response.status < 300;
}

const defaultDeps: WatchNotifierDeps = {
  listActiveOwners: defaultListActiveOwners,
  deliverToAgent: defaultDeliverToAgent,
  deliverToConversation: defaultDeliverToConversation,
};

export interface NotifyPullRequestWatchesResult {
  delivered: number;
  ended: number;
  dropped: number;
}

interface PendingDelivery {
  owner: PullRequestWatchOwner;
  text: string;
  dedupKey: string;
}

/** One notifier pass: compare, persist, then deliver (D-6). Keyed by the sweep's `host/repository#number` string. */
export async function notifyPullRequestWatches(
  snapshots: ReadonlyMap<string, PullRequestSnapshot>,
  deps: WatchNotifierDeps = defaultDeps,
): Promise<NotifyPullRequestWatchesResult> {
  if ((await listPullRequestWatches()).length === 0) return { delivered: 0, ended: 0, dropped: 0 };

  const active = await deps.listActiveOwners();
  const pending: PendingDelivery[] = [];
  let ended = 0;
  let dropped = 0;

  await updatePullRequestWatches<void>((watches) => {
    const next: PullRequestWatch[] = [];
    for (const watch of watches) {
      if (!active.has(ownerKey(watch))) {
        dropped += 1; // D-13: orphan backstop, no message
        continue;
      }
      const snapshot = snapshots.get(keyString(watch));
      if (!snapshot) {
        next.push(watch);
        continue;
      }
      const wake = watchWake(watch, snapshot);
      if (wake.text === null) {
        next.push({ ...watch, last: wake.last, quietWakes: wake.quietWakes });
        continue;
      }
      const wakes = watch.wakes + 1;
      pending.push({ owner: watch, text: wake.text, dedupKey: `pr-watch:${watch.id}:${wakes}` });
      if (wake.ends) {
        ended += 1;
        continue; // removed: merged, closed, or the 11th quiet wake
      }
      next.push({ ...watch, last: wake.last, quietWakes: wake.quietWakes, wakes });
    }
    const unchanged = next.length === watches.length && next.every((watch, index) => watch === watches[index]);
    return { watches: unchanged ? watches : next, result: undefined };
  });

  let delivered = 0;
  for (const item of pending) {
    try {
      const ok =
        item.owner.agentKind === 'agent'
          ? await deps.deliverToAgent(item.owner.agentId, item.text, item.dedupKey)
          : await deps.deliverToConversation(item.owner.agentId, item.text);
      if (ok) delivered += 1;
      else console.warn(`[pr-watch] delivery to ${ownerKey(item.owner)} failed: delivery was not accepted`);
    } catch (error) {
      console.warn(`[pr-watch] delivery to ${ownerKey(item.owner)} failed: ${(error as Error).message}`);
    }
  }

  return { delivered, ended, dropped };
}
