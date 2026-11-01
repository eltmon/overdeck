/**
 * Viewer-side sync of linked machines' conversation lists (PAN-4650 WI-3,
 * D-4650-1, D-4650-2, NFR-4).
 *
 * The link supervisor calls `onConnect` when a link comes online (full fetch)
 * and `onHeartbeat` after each heartbeat (fetch only when the owner's
 * conversations hash differs from the cached one). No timer polls the list.
 * The owner's answer is the only writer of its cache rows, and only when it
 * names the link's own environment id. One fetch per environment runs at a
 * time; a trigger during a fetch queues one more. `prune` drops the cache of
 * environments with no active link.
 */
import type { SharedConversationRow, SharedConversationsResponse } from '@overdeck/contracts';

import { linkFetch } from '../../../lib/anywhere/link-client.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import {
  cachedListHash,
  deleteLinkedConversationsFor,
  linkedConversationEnvironmentIds,
  replaceLinkedConversations,
} from '../../../lib/overdeck/linked-conversations.js';
import type { HeartbeatPayload } from './link-heartbeat.js';

export const SHARED_CONVERSATIONS_PATH = '/api/machines/conversations';

export interface LinkedConversationsDoor {
  replace: (environmentId: string, rows: readonly SharedConversationRow[], hash: string) => void;
  cachedHash: (environmentId: string) => string | null;
  environmentIds: () => string[];
  deleteFor: (environmentId: string) => void;
}

export interface LinkedConversationsSyncDeps {
  fetch: (environmentId: string, path: string, init: { actor: 'operator' }) => Promise<{ status: number; json: unknown }>;
  door: LinkedConversationsDoor;
  log: (message: string) => void;
}

export interface LinkedConversationsSync {
  onConnect(link: MachineLink): Promise<void>;
  onHeartbeat(link: MachineLink, payload: HeartbeatPayload): Promise<void>;
  prune(activeEnvironmentIds: readonly string[]): void;
}

const defaultDoor: LinkedConversationsDoor = {
  replace: replaceLinkedConversations,
  cachedHash: cachedListHash,
  environmentIds: linkedConversationEnvironmentIds,
  deleteFor: deleteLinkedConversationsFor,
};

const defaultDeps: LinkedConversationsSyncDeps = {
  fetch: linkFetch,
  door: defaultDoor,
  log: (message) => console.warn(`[anywhere] ${message}`),
};

const OWNER_NAME = /^[^/]+$/;

function isSharedRow(value: unknown): value is SharedConversationRow {
  const row = value as Partial<SharedConversationRow> | null;
  return !!row && typeof row === 'object' && typeof row.name === 'string' && OWNER_NAME.test(row.name) && typeof row.createdAt === 'string';
}

/** The owner's answer, or null when it is not a well-formed shared list. Malformed rows are dropped. */
function decodeAnswer(json: unknown): SharedConversationsResponse | null {
  const body = json as Partial<SharedConversationsResponse> | null;
  if (!body || typeof body !== 'object') return null;
  if (typeof body.environmentId !== 'string' || typeof body.sharing !== 'boolean' || typeof body.hash !== 'string' || !Array.isArray(body.rows)) {
    return null;
  }
  return { environmentId: body.environmentId, sharing: body.sharing, hash: body.hash, rows: body.rows.filter(isSharedRow) };
}

/**
 * After a fetch: `'any'` runs one more fetch; a hash runs one more only when
 * the cache still differs from it.
 */
type Again = 'any' | string;

export function createLinkedConversationsSync(overrides: Partial<LinkedConversationsSyncDeps> = {}): LinkedConversationsSync {
  const deps = { ...defaultDeps, ...overrides };
  const running = new Map<string, { again: Again | null }>();

  async function fetchOnce(link: MachineLink): Promise<void> {
    const { environmentId, label } = link;
    let response: { status: number; json: unknown };
    try {
      response = await deps.fetch(environmentId, SHARED_CONVERSATIONS_PATH, { actor: 'operator' });
    } catch (error) {
      deps.log(`could not fetch ${label}'s conversations: ${(error as Error).message}`);
      return;
    }
    if (response.status !== 200) {
      deps.log(`${label} answered ${response.status} for its conversations`);
      return;
    }
    const answer = decodeAnswer(response.json);
    if (!answer) {
      deps.log(`${label} sent a malformed conversation list`);
      return;
    }
    if (answer.environmentId !== environmentId) {
      deps.log(`${label} answered for environment ${answer.environmentId}; ignored`);
      return;
    }
    try {
      deps.door.replace(environmentId, answer.sharing ? answer.rows : [], answer.hash);
    } catch (error) {
      deps.log(`could not cache ${label}'s conversations: ${(error as Error).message}`);
    }
  }

  async function sync(link: MachineLink, again: Again): Promise<void> {
    const current = running.get(link.environmentId);
    if (current) {
      current.again = current.again === 'any' || again === 'any' ? 'any' : again;
      return;
    }
    const state: { again: Again | null } = { again: null };
    running.set(link.environmentId, state);
    try {
      for (;;) {
        await fetchOnce(link);
        const next = state.again;
        state.again = null;
        if (next === null) break;
        if (next !== 'any' && deps.door.cachedHash(link.environmentId) === next) break;
      }
    } finally {
      running.delete(link.environmentId);
    }
  }

  return {
    onConnect: (link) => sync(link, 'any'),
    async onHeartbeat(link, payload) {
      const hash = payload.conversationsHash;
      // Older owners send no hash: they are fetched once per connect only.
      if (hash === undefined || deps.door.cachedHash(link.environmentId) === hash) return;
      await sync(link, hash);
    },
    prune(activeEnvironmentIds) {
      const active = new Set(activeEnvironmentIds);
      try {
        for (const environmentId of deps.door.environmentIds()) {
          if (!active.has(environmentId)) deps.door.deleteFor(environmentId);
        }
      } catch (error) {
        deps.log(`could not prune linked conversations: ${(error as Error).message}`);
      }
    },
  };
}

let current: LinkedConversationsSync | null = null;

/** PAN-4651: the primary dashboard's sync (set in `startAnywhere`), so a fleet spawn can list its new row at once. */
export function currentLinkedConversationsSync(): LinkedConversationsSync | null {
  return current;
}

export function setLinkedConversationsSync(sync: LinkedConversationsSync | null): void {
  current = sync;
}
