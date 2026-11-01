/**
 * This machine's Needs-You feed for linked machines (PAN-4651 FR-5, D-4651-15;
 * absorbs PAN-4405).
 *
 * `buildNeedsYou()` answers `GET /api/machines/needs-you`: the conversations
 * with an open blocking surface (the same rows `GET
 * /api/conversations/pending-input` serves this machine's own Needs-You) and
 * the agents with pending input, plus `hash` (first 16 hex of SHA-256 over the
 * rest). One build serves every caller for 5 s. The hash rides in the link
 * heartbeat as `needsYouHash`: the heartbeat takes the last computed value
 * synchronously while a refresh runs in the background, so a beat never waits.
 */
import { createHash } from 'node:crypto';

import { type AgentPendingRow, readAgentSnapshots } from './agent-snapshots-access.js';

export const NEEDS_YOU_CACHE_MS = 5_000;

export interface NeedsYouAgent {
  id: string;
  issueId: string | null;
  pendingInputKinds: string[];
}

export interface NeedsYouFeed {
  hash: string;
  conversations: unknown[];
  agents: NeedsYouAgent[];
}

export interface NeedsYouDeps {
  conversations: () => Promise<unknown[]>;
  agents: () => Promise<ReadonlyArray<AgentPendingRow>>;
  now: () => number;
}

async function pendingConversations(): Promise<unknown[]> {
  const [{ getConversationsPendingInputFeed }, { conversationReadDependencies }] = await Promise.all([
    import('../../../lib/overdeck/conversation-reads.js'),
    import('../routes/conversations.js'),
  ]);
  const read = await getConversationsPendingInputFeed(conversationReadDependencies);
  return read.status === 200 && Array.isArray(read.body) ? read.body : [];
}

export const defaultNeedsYouDeps: NeedsYouDeps = { conversations: pendingConversations, agents: readAgentSnapshots, now: Date.now };

export function needsYouHash(feed: Omit<NeedsYouFeed, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify(feed)).digest('hex').slice(0, 16);
}

let cached: { at: number; feed: Promise<NeedsYouFeed> } | null = null;
let lastHash: string | undefined;

async function build(deps: NeedsYouDeps): Promise<NeedsYouFeed> {
  const [conversations, agents] = await Promise.all([deps.conversations(), deps.agents()]);
  const pending = agents
    .filter((agent) => (agent.pendingInputKinds?.length ?? 0) > 0)
    .map((agent) => ({ id: agent.id, issueId: agent.issueId ?? null, pendingInputKinds: [...(agent.pendingInputKinds ?? [])] }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const body = { conversations, agents: pending };
  const hash = needsYouHash(body);
  lastHash = hash;
  return { hash, ...body };
}

export function buildNeedsYou(deps: NeedsYouDeps = defaultNeedsYouDeps): Promise<NeedsYouFeed> {
  const now = deps.now();
  if (cached && now - cached.at < NEEDS_YOU_CACHE_MS) return cached.feed;
  const feed = build(deps);
  cached = { at: now, feed };
  feed.catch(() => { if (cached?.feed === feed) cached = null; });
  return feed;
}

/** The heartbeat's `needsYouHash`: the last computed hash at once, refreshed in the background. */
export function needsYouHashForHeartbeat(deps: NeedsYouDeps = defaultNeedsYouDeps): string | undefined {
  void buildNeedsYou(deps).catch(() => undefined);
  return lastHash;
}

export function _resetNeedsYouForTests(): void {
  cached = null;
  lastHash = undefined;
}
