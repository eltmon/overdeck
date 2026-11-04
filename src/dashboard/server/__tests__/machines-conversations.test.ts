/**
 * PAN-4650 WI-2: GET /api/machines/conversations shares this machine's local,
 * unarchived conversations with a linked machine (FR-1 fields only), answers
 * 403 to every other credential, shares nothing when sharing is off, and the
 * heartbeat carries the same list hash.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedConversationsResponse } from '@overdeck/contracts';

import {
  invalidateSharedConversations,
  sharedConversations,
  SHARING_OFF_HASH,
  type EnrichedConversationInput,
  type SharedConversationsDeps,
} from '../../../lib/anywhere/shared-conversations.js';
import { readAnywhereSettings, writeAnywhereSettings } from '../../../lib/anywhere/anywhere-settings.js';
import { buildVaultContinuityLookup } from '../../../lib/overdeck/conversation-vault-continuity.js';
import type { ProjectConfig } from '../../../lib/projects.js';
import type { DashboardCredential } from '../routes/dashboard-auth.js';
import { handleSharedConversations } from '../routes/machines-peer.js';
import { HEARTBEAT_HASH_WAIT_MS, setHeartbeatConversationsHashSource, startHeartbeatSource } from '../services/link-heartbeat.js';

const MACHINE: DashboardCredential = {
  kind: 'machine', tokenId: 'tok-1', environmentId: 'env-laptop', scopes: ['read:conversations'], actor: 'operator', access: 'operator',
};
const originalHome = process.env.OVERDECK_HOME;
let root: string;

function enriched(name: string, overrides: Partial<EnrichedConversationInput> = {}): EnrichedConversationInput & Record<string, unknown> {
  return {
    name,
    title: `Title ${name}`,
    claudeSessionId: `session-${name}`,
    harness: 'claude-code',
    model: 'claude-opus-5-5',
    status: 'active',
    sessionAlive: true,
    isWorking: false,
    lastActivityAt: '2026-11-01T12:00:00.000Z',
    projectKey: null,
    cwd: join(root, 'overdeck', 'src'),
    issueId: 'PAN-4650',
    tmuxSession: `conv-${name}`,
    releasedTo: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    archivedAt: null,
    origin: 'local',
    // Enrichment noise the shared row must drop.
    totalCost: 12.5,
    pendingInputCount: 0,
    ...overrides,
  };
}

function deps(rows: unknown[], overrides: Partial<SharedConversationsDeps> = {}): Partial<SharedConversationsDeps> {
  return {
    listRows: async () => rows,
    readSharing: async () => true,
    listProjects: async () => [
      { key: 'overdeck', config: { name: 'Overdeck', path: join(root, 'overdeck'), github_repo: 'eltmon/overdeck' } as ProjectConfig },
      { key: 'myn', config: { name: 'MYN', path: join(root, 'myn'), gitlab_repo: 'myn/app' } as ProjectConfig },
    ],
    environmentId: async () => 'env-desk',
    vaultLookup: async () => buildVaultContinuityLookup({
      owned: { '/home/desk/.claude/projects/x/session-conv-a.jsonl': { vaultId: 'vault-id-a', harness: 'claude-code', tail: {} as never } },
      listCache: [],
    }, '/home/desk/.overdeck'),
    pulledFrom: () => new Map([['conv-b', { environmentId: 'env-laptop', nativeSessionId: 's-old' }]]),
    ...overrides,
  };
}

async function read(response: HttpServerResponse.HttpServerResponse): Promise<{ status: number; json: SharedConversationsResponse & { error?: string } }> {
  return { status: response.status, json: JSON.parse(await HttpServerResponse.toWeb(response).text()) as SharedConversationsResponse };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pan-4650-shared-'));
  process.env.OVERDECK_HOME = join(root, 'home');
  invalidateSharedConversations();
});

afterEach(async () => {
  vi.useRealTimers();
  invalidateSharedConversations();
  setHeartbeatConversationsHashSource(null);
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(root, { recursive: true, force: true });
});

describe('GET /api/machines/conversations (PAN-4650 WI-2)', () => {
  it('gives a machine credential the FR-1 fields of every local, unarchived row', async () => {
    const rows = [
      enriched('conv-a'),
      enriched('conv-b', { projectKey: 'myn', cwd: join(root, 'myn'), harness: 'kimi-code', releasedTo: 'env-laptop', isWorking: true }),
      enriched('vault-1', { origin: 'vault' }),
      enriched('conv-old', { archivedAt: '2026-10-01T00:00:00.000Z' }),
    ];
    const { status, json } = await read(await handleSharedConversations(MACHINE, deps(rows)));

    expect(status).toBe(200);
    expect(json.environmentId).toBe('env-desk');
    expect(json.sharing).toBe(true);
    expect(json.rows.map((row) => row.name)).toEqual(['conv-a', 'conv-b']);
    expect(json.rows[0]).toEqual({
      name: 'conv-a',
      title: 'Title conv-a',
      nativeSessionId: 'session-conv-a',
      harness: 'claude-code',
      model: 'claude-opus-5-5',
      status: 'active',
      sessionAlive: true,
      isWorking: false,
      lastActivityAt: '2026-11-01T12:00:00.000Z',
      projectKey: 'overdeck',
      gitOrigin: 'github.com/eltmon/overdeck',
      cwd: join(root, 'overdeck', 'src'),
      issueId: 'PAN-4650',
      tmuxSession: 'conv-conv-a',
      releasedTo: null,
      createdAt: '2026-11-01T10:00:00.000Z',
      pullable: true,
      vaultId: 'vault-id-a',
      pulledFrom: null,
    });
    expect(json.rows[1]).toMatchObject({ projectKey: 'myn', gitOrigin: 'gitlab.com/myn/app', releasedTo: 'env-laptop', isWorking: true, pullable: false, vaultId: null,
      pulledFrom: { environmentId: 'env-laptop', nativeSessionId: 's-old' } });
    expect(json.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('PAN-4903: shares the owner\'s spawn error only on a row whose launch failed', async () => {
    const rows = [enriched('conv-a'), enriched('conv-b', { spawnError: 'MessageDeliveryFailed: Codex app-server delivery failed' })];
    const { json } = await read(await handleSharedConversations(MACHINE, deps(rows)));
    expect(json.rows[0]).not.toHaveProperty('spawnError');
    expect(json.rows[1]).toMatchObject({ spawnError: 'MessageDeliveryFailed: Codex app-server delivery failed' });
  });

  it('answers 403 to every non-machine credential', async () => {
    const listRows = vi.fn(async () => [enriched('conv-a')]);
    for (const credential of [null, { kind: 'root-session' }, { kind: 'token', tokenId: 't', scopes: ['admin'] }] as Array<DashboardCredential | null>) {
      expect((await read(await handleSharedConversations(credential, deps([], { listRows })))).status).toBe(403);
    }
    expect(listRows).not.toHaveBeenCalled();
  });

  it('shares nothing when sharing is off', async () => {
    const listRows = vi.fn(async () => [enriched('conv-a')]);
    const { json } = await read(await handleSharedConversations(MACHINE, deps([], { listRows, readSharing: async () => false })));
    expect(json).toEqual({ environmentId: 'env-desk', sharing: false, rows: [], hash: SHARING_OFF_HASH });
    expect(listRows).not.toHaveBeenCalled();
  });

  it('reads the sharing switch from anywhere.json, on by default', async () => {
    // PAN-4651 D-4651-13 added combineRepositories (default on) to the same file.
    expect(await readAnywhereSettings()).toEqual({ shareConversations: true, combineRepositories: true });
    await writeAnywhereSettings({ shareConversations: false });
    expect(await readAnywhereSettings()).toEqual({ shareConversations: false, combineRepositories: true });
    const { readSharing: _fromFile, ...fileSharing } = deps([enriched('conv-a')]);
    const { json } = await read(await handleSharedConversations(MACHINE, fileSharing));
    expect(json.sharing).toBe(false);
  });

  it('hashes the same list the same way regardless of order', async () => {
    const first = await read(await handleSharedConversations(MACHINE, deps([enriched('conv-a'), enriched('conv-b')])));
    invalidateSharedConversations();
    const second = await read(await handleSharedConversations(MACHINE, deps([enriched('conv-b'), enriched('conv-a')])));
    invalidateSharedConversations();
    const changed = await read(await handleSharedConversations(MACHINE, deps([enriched('conv-a'), enriched('conv-b', { isWorking: true })])));
    expect(second.json.hash).toBe(first.json.hash);
    expect(changed.json.hash).not.toBe(first.json.hash);
  });

  it('puts the endpoint hash in the heartbeat, listing once for both', async () => {
    const listRows = vi.fn(async () => [enriched('conv-a')]);
    const shared = deps([], { listRows });
    const { json } = await read(await handleSharedConversations(MACHINE, shared));

    setHeartbeatConversationsHashSource(async () => (await sharedConversations(shared)).hash);
    const chunk = await new Promise<string>((resolve) => {
      const source = startHeartbeatSource('0.73.0', (data) => {
        source.stop();
        resolve(data);
      }, { setInterval: (() => ({})) as unknown as typeof setInterval, clearInterval: () => undefined, onStall: () => () => undefined });
    });
    const payload = JSON.parse(chunk.split('data: ')[1]!) as { conversationsHash?: string; seq: number };
    expect(payload).toMatchObject({ seq: 1, conversationsHash: json.hash });
    expect(listRows).toHaveBeenCalledTimes(1);
  });

  it('never holds a beat back more than the hash wait; a late build reaches the next beat', async () => {
    vi.useFakeTimers();
    const pending: Array<(hash: string) => void> = [];
    setHeartbeatConversationsHashSource(() => new Promise<string>((resolve) => { pending.push(resolve); }));
    const beats: Array<{ seq: number; conversationsHash?: string }> = [];
    let tick: () => void = () => undefined;
    const source = startHeartbeatSource('0.73.0', (data) => beats.push(JSON.parse(data.split('data: ')[1]!)), {
      setInterval: ((fn: () => void) => { tick = fn; return {}; }) as unknown as typeof setInterval,
      clearInterval: () => undefined,
      onStall: () => () => undefined,
    });

    await vi.advanceTimersByTimeAsync(HEARTBEAT_HASH_WAIT_MS - 1);
    expect(beats).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(beats).toHaveLength(1);
    expect(beats[0]).not.toHaveProperty('conversationsHash');

    pending[0]!('aaaa000011112222');
    tick();
    await vi.advanceTimersByTimeAsync(HEARTBEAT_HASH_WAIT_MS);
    expect(beats[1]).toMatchObject({ seq: 2, conversationsHash: 'aaaa000011112222' });
    source.stop();
  });
});
