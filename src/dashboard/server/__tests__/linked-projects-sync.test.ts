/**
 * PAN-4651 WI-3 (D-4651-11): the owner's project route and the viewer's
 * hash-driven cache. The viewer fetches on connect, never on an unchanged
 * hash, and once on a changed one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MACHINE_TOKEN_SCOPES } from '../../../lib/access-tokens.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { machineProjectsHash } from '../../../lib/anywhere/project-origin.js';
import { handleMachineProjects } from '../routes/machines-peer.js';
import type { HeartbeatPayload } from '../services/link-heartbeat.js';
import { createLinkedProjectsSync } from '../services/linked-projects-sync.js';

const LINK = { id: 'link-1', environmentId: 'env-desk', label: 'desk' } as MachineLink;
const DESK = [{ key: 'overdeck', name: 'Overdeck', gitOrigin: 'github.com/eltmon/overdeck' }];

function beat(projectsHash?: string): HeartbeatPayload {
  return { seq: 1, lastStall: null, endpointsHash: '', serverVersion: '0.73.0', ...(projectsHash ? { projectsHash } : {}) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('owner project route (D-4651-11)', () => {
  it('ac3: answers keys, names and slugs to a machine credential, 403 to anything else', async () => {
    const list = vi.fn(async () => DESK);
    const machine = { kind: 'machine' as const, tokenId: 't', environmentId: 'env-laptop', scopes: MACHINE_TOKEN_SCOPES('operator'), actor: 'operator' as const, access: 'operator' as const };
    const ok = await handleMachineProjects(machine, list);
    expect(ok.status).toBe(200);
    const denied = await handleMachineProjects({ kind: 'root-session' }, list);
    expect(denied.status).toBe(403);
    const device = await handleMachineProjects(null, list);
    expect(device.status).toBe(403);
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe('linked project cache (D-4651-11, NFR-1)', () => {
  it('ac3: fetches on connect, not on an unchanged hash, once on a changed hash', async () => {
    let projects = DESK;
    const fetch = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { status: 200, json: { projects } };
    });
    const sync = createLinkedProjectsSync({ fetch, log: () => undefined });
    const connected = sync.onConnect(LINK);
    await vi.advanceTimersByTimeAsync(50);
    await connected;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sync.projectsFor('env-desk')).toEqual(DESK);

    await sync.onHeartbeat(LINK, beat(machineProjectsHash(DESK)));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetch).toHaveBeenCalledTimes(1);

    projects = [...DESK, { key: 'web', name: 'Web', gitOrigin: null }];
    const changed = sync.onHeartbeat(LINK, beat(machineProjectsHash(projects)));
    await vi.advanceTimersByTimeAsync(50);
    await changed;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sync.projectsFor('env-desk')).toHaveLength(2);
    await sync.onHeartbeat(LINK, beat(machineProjectsHash(projects)));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('an old owner (no hash, 404) leaves no list and never refetches on a beat', async () => {
    const fetch = vi.fn(async () => ({ status: 404, json: null }));
    const log = vi.fn();
    const sync = createLinkedProjectsSync({ fetch, log });
    await sync.onConnect(LINK);
    await sync.onHeartbeat(LINK, beat());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sync.projectsFor('env-desk')).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it('prune drops lists of machines with no active link', async () => {
    const sync = createLinkedProjectsSync({ fetch: async () => ({ status: 200, json: { projects: DESK } }), log: () => undefined });
    await sync.onConnect(LINK);
    sync.prune([]);
    expect(sync.projectsFor('env-desk')).toBeNull();
  });
});
