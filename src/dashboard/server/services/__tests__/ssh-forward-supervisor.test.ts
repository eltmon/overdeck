/**
 * PAN-4404 WI-5: the SSH forward supervisor — attention without retry, back-off
 * with a 60 s cap and a counter reset, port collisions, stopForward and the
 * orphan reap at start (D-4404-10). Fake timers and fake children only.
 */
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import type { LinkRoute } from '../../../../lib/anywhere/routes.js';
import type { SshMachineRecord } from '../../../../lib/anywhere/ssh/machine-store.js';
import { type ForwardChild, SshForwardSupervisor, type SshForwardSupervisorDeps } from '../ssh-forward-supervisor.js';

class FakeChild extends EventEmitter implements ForwardChild {
  static nextPid = 7000;
  readonly pid = FakeChild.nextPid++;
  readonly stderr = new EventEmitter();
  readonly kill = vi.fn((_signal?: NodeJS.Signals) => {
    queueMicrotask(() => this.exit(null));
    return true;
  });
  /** The forward fails: write stderr, then exit. */
  fail(stderr: string, code = 255): void {
    this.stderr.emit('data', Buffer.from(stderr));
    this.exit(code);
  }
  exit(code: number | null): void {
    this.emit('exit', code, null);
  }
}

const AT = '2026-11-01T00:00:00.000Z';

function record(overrides: Partial<SshMachineRecord> = {}): SshMachineRecord {
  return {
    id: 'rec-1',
    destination: 'me@desk',
    linkId: 'link-1',
    environmentId: 'env-desk',
    localPort: 41234,
    remotePort: 3011,
    launch: 'managed',
    panPath: null,
    forwardPid: null,
    addedAt: AT,
    ...overrides,
  };
}

interface Harness {
  supervisor: SshForwardSupervisor;
  deps: SshForwardSupervisorDeps;
  records: SshMachineRecord[];
  children: FakeChild[];
  link: MachineLink;
  portOpen: { value: boolean };
  setLinkRoutes: ReturnType<typeof vi.fn>;
  updateLinkRoutes: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  removeRecord: ReturnType<typeof vi.fn>;
  commandLines: Map<number, string>;
  spawned: () => number;
}

function harness(records: SshMachineRecord[] = [record()]): Harness {
  const children: FakeChild[] = [];
  const portOpen = { value: true };
  const link = {
    id: 'link-1',
    routes: [
      { url: 'tcp://127.0.0.1:41234', kind: 'ssh', source: 'pairing', addedAt: AT },
      { url: 'tcp://192.168.1.20:3011', kind: 'lan', source: 'advertised', addedAt: AT },
    ] satisfies LinkRoute[],
  } as unknown as MachineLink;
  const commandLines = new Map<number, string>();
  const setLinkRoutes = vi.fn(async (_id: string, _routes: LinkRoute[]) => link);
  const updateLinkRoutes = vi.fn((_id: string, _routes: LinkRoute[]) => undefined);
  const kill = vi.fn((_pid: number, _signal: NodeJS.Signals) => undefined);
  const removeRecord = vi.fn(async (id: string) => {
    const index = records.findIndex((r) => r.id === id);
    if (index >= 0) records.splice(index, 1);
  });
  let nextPort = 50000;
  const deps: SshForwardSupervisorDeps = {
    spawnForward: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    pickPort: async () => nextPort++,
    waitForPort: async () => portOpen.value,
    listRecords: async () => records.map((r) => ({ ...r })),
    removeRecord,
    updateRecord: async (id, patch) => {
      const index = records.findIndex((r) => r.id === id);
      if (index < 0) return null;
      records[index] = { ...records[index]!, ...patch };
      return records[index]!;
    },
    getLink: async () => link,
    setLinkRoutes,
    updateLinkRoutes,
    commandLineOf: async (pid) => commandLines.get(pid) ?? null,
    kill,
    now: () => Date.now(),
    random: () => 0.5,
    log: () => undefined,
  };
  return {
    supervisor: new SshForwardSupervisor(deps),
    deps,
    records,
    children,
    link,
    portOpen,
    setLinkRoutes,
    updateLinkRoutes,
    kill,
    removeRecord,
    commandLines,
    spawned: () => children.length,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SshForwardSupervisor (PAN-4404 WI-5, D-4404-10)', () => {
  it('ensure() resolves once the port is up and records the forward pid', async () => {
    const h = harness();
    await h.supervisor.ensure('rec-1');
    expect(h.supervisor.status('rec-1')).toEqual({ forward: 'up', detail: null });
    expect(h.records[0]!.forwardPid).toBe(h.children[0]!.pid);
  });

  it('a Permission denied exit goes to attention and is not respawned after 10 minutes', async () => {
    const h = harness();
    await h.supervisor.ensure('rec-1');
    h.children[0]!.fail('me@desk: Permission denied (publickey).');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.spawned()).toBe(1);
    const status = h.supervisor.status('rec-1');
    expect(status.forward).toBe('attention');
    expect(status.detail).toContain('refused the login');
  });

  it('ensure() rejects with the classified error when the host key fails', async () => {
    const h = harness();
    h.deps.waitForPort = () => new Promise(() => undefined);
    const pending = h.supervisor.ensure('rec-1');
    await vi.advanceTimersByTimeAsync(0);
    h.children[0]!.fail('Host key verification failed.');
    await expect(pending).rejects.toMatchObject({ code: 'host-key' });
  });

  it('a plain exit respawns after 1 s, then 2 s, doubling to a 60 s cap', async () => {
    const h = harness();
    await h.supervisor.ensure('rec-1');
    const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000];
    for (const delay of delays) {
      const before = h.spawned();
      h.children.at(-1)!.fail('Connection reset by peer');
      expect(h.supervisor.status('rec-1').forward).toBe('down');
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(h.spawned()).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.spawned()).toBe(before + 1);
    }
  });

  it('a forward up for 60 s resets the attempt counter; one that dies at 59 s keeps it', async () => {
    const h = harness();
    await h.supervisor.ensure('rec-1');
    h.children.at(-1)!.fail('reset');
    await vi.advanceTimersByTimeAsync(1_000); // attempt 1 → respawn
    h.children.at(-1)!.fail('reset');
    await vi.advanceTimersByTimeAsync(2_000); // attempt 2 → respawn, now up
    await vi.advanceTimersByTimeAsync(59_000);
    h.children.at(-1)!.fail('reset');
    const before = h.spawned();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(h.spawned()).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.spawned()).toBe(before + 1); // 4 s: the counter was kept

    await vi.advanceTimersByTimeAsync(60_000); // up for 60 s
    h.children.at(-1)!.fail('reset');
    const again = h.spawned();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.spawned()).toBe(again + 1); // back to 1 s
  });

  it('Address already in use picks a new port, replaces the ssh route and respawns at once', async () => {
    const h = harness();
    await h.supervisor.ensure('rec-1');
    h.children[0]!.fail('bind [127.0.0.1]:41234: Address already in use\nchannel_setup_fwd_listener_tcpip: cannot listen to port: 41234', 255);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.spawned()).toBe(2);
    expect(h.records[0]!.localPort).toBe(50000);
    const expectedRoutes = [
      { url: 'tcp://127.0.0.1:50000', kind: 'ssh', source: 'pairing', addedAt: AT },
      { url: 'tcp://192.168.1.20:3011', kind: 'lan', source: 'advertised', addedAt: AT },
    ];
    expect(h.setLinkRoutes).toHaveBeenCalledWith('link-1', expectedRoutes);
    expect(h.updateLinkRoutes).toHaveBeenCalledWith('link-1', expectedRoutes);
  });

  it('a collision during ensure() of a provisional record moves the port without touching a link', async () => {
    const h = harness([record({ linkId: null })]);
    let first = true;
    h.deps.waitForPort = async () => {
      if (!first) return true;
      first = false;
      return new Promise(() => undefined);
    };
    const pending = h.supervisor.ensure('rec-1');
    await vi.advanceTimersByTimeAsync(0);
    h.children[0]!.fail('cannot listen to port: 41234');
    await pending;
    expect(h.records[0]!.localPort).toBe(50000);
    expect(h.setLinkRoutes).not.toHaveBeenCalled();
    expect(h.supervisor.status('rec-1').forward).toBe('up');
  });

  it('ensure() fails forward-failed when the port never opens', async () => {
    const h = harness();
    h.portOpen.value = false;
    await expect(h.supervisor.ensure('rec-1')).rejects.toMatchObject({ code: 'forward-failed' });
  });

  it('stopForward sends SIGTERM and no respawn follows', async () => {
    const h = harness();
    await h.supervisor.ensure('rec-1');
    await h.supervisor.stopForward('rec-1');
    expect(h.children[0]!.kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.spawned()).toBe(1);
    expect(h.records[0]!.forwardPid).toBeNull();
    expect(h.supervisor.status('rec-1').forward).toBe('down');
  });

  it('start() deletes provisional records and reaps only a recorded orphan with our -L argument', async () => {
    const h = harness([
      record({ id: 'rec-1', forwardPid: 111, localPort: 41234 }),
      record({ id: 'rec-2', linkId: 'link-2', forwardPid: 222, localPort: 41235 }),
      record({ id: 'rec-p', linkId: null }),
    ]);
    h.commandLines.set(111, 'ssh -o BatchMode=yes -N -o ExitOnForwardFailure=yes -L 127.0.0.1:41234:127.0.0.1:3011 -- me@desk');
    h.commandLines.set(222, 'vim notes.txt');
    await h.supervisor.start();
    expect(h.kill.mock.calls).toEqual([[111, 'SIGTERM']]);
    expect(h.removeRecord).toHaveBeenCalledWith('rec-p');
    expect(h.records.map((r) => r.id)).toEqual(['rec-1', 'rec-2']);
    expect(h.spawned()).toBe(2);
  });

  it('stop() kills every forward and nothing respawns', async () => {
    const h = harness();
    await h.supervisor.start();
    h.supervisor.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.children[0]!.kill).toHaveBeenCalledWith('SIGTERM');
    expect(h.spawned()).toBe(1);
  });
});
