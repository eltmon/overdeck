/**
 * Viewer-side cache of linked machines' Needs-You feeds (PAN-4651 WI-20,
 * D-4651-15, NFR-1).
 *
 * Same trigger rule as the project lists: a full fetch of
 * `GET /api/machines/needs-you` when a link comes online, and one more when a
 * heartbeat's `needsYouHash` differs from the cached hash. Nothing polls. The
 * cache is in memory; `GET /api/fleet/needs-you` serves it for online links.
 */
import { linkFetch } from '../../../lib/anywhere/link-client.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import type { HeartbeatPayload } from './link-heartbeat.js';
import type { NeedsYouAgent } from './needs-you-feed.js';

export const MACHINE_NEEDS_YOU_PATH = '/api/machines/needs-you';

export interface LinkedNeedsYou {
  hash: string;
  conversations: Array<Record<string, unknown>>;
  agents: NeedsYouAgent[];
}

export interface LinkedNeedsYouSyncDeps {
  fetch: (environmentId: string, path: string, init: { actor: 'operator' }) => Promise<{ status: number; json: unknown }>;
  log: (message: string) => void;
}

export interface LinkedNeedsYouSync {
  onConnect(link: MachineLink): Promise<void>;
  onHeartbeat(link: MachineLink, payload: HeartbeatPayload): Promise<void>;
  prune(activeEnvironmentIds: readonly string[]): void;
  feedFor(environmentId: string): LinkedNeedsYou | null;
}

const OWNER_NAME = /^[^/]+$/;

function decode(json: unknown): LinkedNeedsYou | null {
  const body = json as Partial<LinkedNeedsYou> | null;
  if (!body || typeof body !== 'object' || typeof body.hash !== 'string' || !Array.isArray(body.conversations) || !Array.isArray(body.agents)) return null;
  return {
    hash: body.hash,
    conversations: body.conversations.filter((row): row is Record<string, unknown> =>
      !!row && typeof row === 'object' && typeof (row as { name?: unknown }).name === 'string' && OWNER_NAME.test((row as { name: string }).name)),
    agents: body.agents.filter((agent): agent is NeedsYouAgent =>
      !!agent && typeof agent.id === 'string' && Array.isArray(agent.pendingInputKinds))
      .map((agent) => ({ id: agent.id, issueId: typeof agent.issueId === 'string' ? agent.issueId : null, pendingInputKinds: agent.pendingInputKinds.filter((kind) => typeof kind === 'string') })),
  };
}

export function createLinkedNeedsYouSync(overrides: Partial<LinkedNeedsYouSyncDeps> = {}): LinkedNeedsYouSync {
  const deps: LinkedNeedsYouSyncDeps = { fetch: linkFetch, log: (message) => console.warn(`[anywhere] ${message}`), ...overrides };
  const cache = new Map<string, LinkedNeedsYou>();
  const running = new Map<string, { again: boolean }>();

  async function fetchOnce(link: MachineLink): Promise<void> {
    let response: { status: number; json: unknown };
    try {
      response = await deps.fetch(link.environmentId, MACHINE_NEEDS_YOU_PATH, { actor: 'operator' });
    } catch (error) {
      deps.log(`could not fetch ${link.label}'s Needs-You: ${(error as Error).message}`);
      return;
    }
    if (response.status !== 200) {
      if (response.status !== 404) deps.log(`${link.label} answered ${response.status} for its Needs-You`);
      return;
    }
    const feed = decode(response.json);
    if (!feed) {
      deps.log(`${link.label} sent a malformed Needs-You feed`);
      return;
    }
    cache.set(link.environmentId, feed);
  }

  async function sync(link: MachineLink): Promise<void> {
    const current = running.get(link.environmentId);
    if (current) {
      current.again = true;
      return;
    }
    const state = { again: false };
    running.set(link.environmentId, state);
    try {
      do {
        state.again = false;
        await fetchOnce(link);
      } while (state.again);
    } finally {
      running.delete(link.environmentId);
    }
  }

  return {
    onConnect: (link) => sync(link),
    async onHeartbeat(link, payload) {
      const hash = payload.needsYouHash;
      if (hash === undefined || cache.get(link.environmentId)?.hash === hash) return;
      await sync(link);
    },
    prune(activeEnvironmentIds) {
      const active = new Set(activeEnvironmentIds);
      for (const environmentId of cache.keys()) if (!active.has(environmentId)) cache.delete(environmentId);
    },
    feedFor: (environmentId) => cache.get(environmentId) ?? null,
  };
}

let current: LinkedNeedsYouSync | null = null;

export function currentLinkedNeedsYou(): LinkedNeedsYouSync | null {
  return current;
}

export function setLinkedNeedsYouSync(sync: LinkedNeedsYouSync | null): void {
  current = sync;
}
