/**
 * PAN-4404 WI-7: the SSH machine service — the add flow and its rollback
 * (D-4404-3), the pinned version (FR-2), test (FR-9), remove (FR-5),
 * reconnect (FR-8) and the local host lock (FR-6). Fakes only.
 */
import { describe, expect, it, vi } from 'vitest';

import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import type { SshMachineRecord } from '../../../../lib/anywhere/ssh/machine-store.js';
import type { SshRunResult } from '../../../../lib/anywhere/ssh/run.js';
import { formatHelperResult, type HelperResult } from '../../../../lib/anywhere/ssh/target.js';
import {
  addSshMachine,
  reconnectSshMachine,
  removeSshMachineForLink,
  type SshMachineServiceDeps,
  sshInfoForLink,
  testSshHost,
} from '../ssh-machine-service.js';

const OURS = '0f8e4c1a-2b3d-4e5f-8a9b-0c1d2e3f4a5b';
const HOST_ENV = '9c0e7a52-1111-4222-8333-444455556666';
const AT = '2026-11-01T00:00:00.000Z';

function startResult(overrides: Partial<Extract<HelperResult, { op: 'start' }>> = {}): HelperResult {
  return {
    v: 1,
    ok: true,
    op: 'start',
    launch: 'managed',
    apiPort: 3011,
    environmentId: HOST_ENV,
    label: 'desk',
    serverVersion: '0.72.0',
    panVersion: '0.72.0',
    pairing: { credential: 'odp_secret', expiresAt: AT },
    ...overrides,
  };
}

interface Harness {
  deps: Partial<SshMachineServiceDeps>;
  records: SshMachineRecord[];
  sshCalls: Array<{ dest: string; cmd: string; timeoutMs: number }>;
  ops: string[];
  supervisor: { ensure: ReturnType<typeof vi.fn>; stopForward: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> };
  createMachineLink: ReturnType<typeof vi.fn>;
  answers: { version: SshRunResult; start: SshRunResult; stop: SshRunResult };
}

function ok(stdout: string): SshRunResult {
  return { exitCode: 0, stdout, stderr: '' };
}

function harness(records: SshMachineRecord[] = []): Harness {
  const sshCalls: Harness['sshCalls'] = [];
  const ops: string[] = [];
  const answers = {
    version: ok('Welcome\n0.72.0\n'),
    start: ok(`motd\n${formatHelperResult(startResult())}\n`),
    stop: ok(formatHelperResult({ v: 1, ok: true, op: 'stop', stopped: true, reason: 'stopped' })),
  };
  const supervisor = {
    ensure: vi.fn(async (id: string) => {
      ops.push(`ensure ${id}`);
    }),
    stopForward: vi.fn(async (id: string) => {
      ops.push(`stopForward ${id}`);
    }),
    status: vi.fn(() => ({ forward: 'up' as const, detail: null })),
  };
  const createMachineLink = vi.fn(async (input: { transport?: { url: string; kind: string } }) => {
    ops.push('createMachineLink');
    const link = {
      id: 'link-new',
      environmentId: HOST_ENV,
      label: 'desk',
      routes: [{ url: input.transport!.url, kind: input.transport!.kind, source: 'pairing', addedAt: AT }],
    } as unknown as MachineLink;
    return { link, view: { id: 'link-new', label: 'desk', routes: link.routes } as never };
  });
  let nextId = 1;
  const deps: Partial<SshMachineServiceDeps> = {
    runSsh: async (dest, cmd, options) => {
      sshCalls.push({ dest, cmd, timeoutMs: options.timeoutMs });
      if (cmd.includes('--version')) {
        ops.push('ssh version');
        return answers.version;
      }
      if (cmd.includes('ssh-helper stop')) {
        ops.push('ssh stop');
        return answers.stop;
      }
      ops.push(cmd.includes('--no-pair') ? 'ssh start-no-pair' : 'ssh start');
      return answers.start;
    },
    createMachineLink: createMachineLink as unknown as SshMachineServiceDeps['createMachineLink'],
    listRecords: async () => records.map((r) => ({ ...r })),
    getRecordByLinkId: async (linkId) => records.find((r) => r.linkId !== null && r.linkId === linkId) ?? null,
    upsertRecord: async (record) => {
      ops.push(`upsert linkId=${String(record.linkId)}`);
      records.push({ ...record });
    },
    updateRecord: async (id, patch) => {
      const index = records.findIndex((r) => r.id === id);
      if (index < 0) return null;
      records[index] = { ...records[index]!, ...patch };
      ops.push(`update ${Object.keys(patch).join(',')}`);
      return records[index]!;
    },
    removeRecord: async (id) => {
      ops.push(`remove ${id}`);
      const index = records.findIndex((r) => r.id === id);
      if (index >= 0) records.splice(index, 1);
    },
    pickPort: async () => 41234,
    supervisor: () => supervisor,
    localIdentity: async () => ({ environmentId: OURS, label: 'laptop' }),
    localVersion: async () => '0.72.0',
    newId: () => `rec-${nextId++}`,
    now: () => AT,
    log: () => undefined,
  };
  return { deps, records, sshCalls, ops, supervisor, createMachineLink, answers };
}

function storedRecord(overrides: Partial<SshMachineRecord> = {}): SshMachineRecord {
  return {
    id: 'rec-old',
    destination: 'desk',
    linkId: 'link-old',
    environmentId: HOST_ENV,
    localPort: 40000,
    remotePort: 3011,
    launch: 'managed',
    panPath: null,
    forwardPid: null,
    addedAt: AT,
    ...overrides,
  };
}

describe('addSshMachine (D-4404-3)', () => {
  it('writes a provisional record before ensure() and sets linkId after the link exists', async () => {
    const h = harness();
    const { view, record } = await addSshMachine({ host: 'me@desk' }, h.deps);
    expect(h.ops).toEqual([
      'ssh version',
      'ssh start',
      'upsert linkId=null',
      'ensure rec-1',
      'createMachineLink',
      'update linkId,environmentId',
    ]);
    expect(record).toMatchObject({ id: 'rec-1', linkId: 'link-new', launch: 'managed', destination: 'me@desk', localPort: 41234, remotePort: 3011 });
    expect(view.ssh).toEqual({ destination: 'me@desk', launch: 'managed', forward: 'up', forwardDetail: null, localPort: 41234, remotePort: 3011 });
    expect(h.createMachineLink.mock.calls[0]![0]).toEqual({
      transport: { url: 'tcp://127.0.0.1:41234', kind: 'ssh', pairingCode: 'odp_secret' },
      bothWays: true,
      access: 'operator',
    });
    expect(h.sshCalls.map((c) => c.timeoutMs)).toEqual([20_000, 150_000]);
    expect(h.sshCalls[1]!.cmd).toContain(`--linker ${OURS} --json`);
  });

  it('links over the port the forward ended on after a collision during ensure()', async () => {
    const h = harness();
    h.supervisor.ensure.mockImplementation(async (id: string) => {
      const record = h.records.find((r) => r.id === id)!;
      record.localPort = 50001;
    });
    await addSshMachine({ host: 'desk' }, h.deps);
    expect(h.createMachineLink.mock.calls[0]![0]).toMatchObject({ transport: { url: 'tcp://127.0.0.1:50001' } });
  });

  it('a version mismatch names both versions and the install command, and runs no helper', async () => {
    const h = harness();
    h.answers.version = ok('0.71.0\n');
    const error = await addSshMachine({ host: 'desk' }, h.deps).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'version-mismatch' });
    const message = (error as Error).message;
    expect(message).toContain('0.71.0');
    expect(message).toContain('0.72.0');
    expect(message).toContain('npm install -g @overdeck/core@0.72.0');
    expect(h.ops).toEqual(['ssh version']);
  });

  it('exit 127 is pan-missing and names the install command', async () => {
    const h = harness();
    h.answers.version = { exitCode: 127, stdout: '', stderr: 'bash: pan: command not found' };
    const error = await addSshMachine({ host: 'desk' }, h.deps).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'pan-missing' });
    expect((error as Error).message).toContain('npm install -g @overdeck/core@0.72.0');
  });

  it('no version line is helper-failed', async () => {
    const h = harness();
    h.answers.version = ok('pan version unknown');
    await expect(addSshMachine({ host: 'desk' }, h.deps)).rejects.toMatchObject({ code: 'helper-failed' });
  });

  it('maps helper failures: busy and start-failed keep their code, others are helper-failed', async () => {
    for (const [error, code] of [['busy', 'busy'], ['start-failed', 'start-failed'], ['token-rejected', 'helper-failed']] as const) {
      const h = harness();
      h.answers.start = ok(formatHelperResult({ v: 1, ok: false, error, message: 'nope' }));
      await expect(addSshMachine({ host: 'desk' }, h.deps)).rejects.toMatchObject({ code });
      expect(h.records).toEqual([]);
    }
  });

  it('self-link: the host is this machine; a server the helper started is stopped again', async () => {
    const h = harness();
    h.answers.start = ok(formatHelperResult(startResult({ environmentId: OURS, launch: 'managed' })));
    await expect(addSshMachine({ host: 'localhost' }, h.deps)).rejects.toMatchObject({ code: 'self-link' });
    expect(h.ops).toEqual(['ssh version', 'ssh start', 'ssh stop']);
    expect(h.records).toEqual([]);
  });

  it('a failed link after a managed start stops the forward, deletes the record and stops that server', async () => {
    const h = harness();
    h.createMachineLink.mockRejectedValue(Object.assign(new Error('pairing refused'), { code: 'pairing-refused' }));
    await expect(addSshMachine({ host: 'desk' }, h.deps)).rejects.toThrow('pairing refused');
    expect(h.ops.slice(-3)).toEqual(['stopForward rec-1', 'remove rec-1', 'ssh stop']);
    expect(h.records).toEqual([]);
  });

  it('a failed link after an external adopt never runs the stop helper', async () => {
    const h = harness();
    h.answers.start = ok(formatHelperResult(startResult({ launch: 'external' })));
    h.supervisor.ensure.mockRejectedValue(new Error('forward-failed'));
    await expect(addSshMachine({ host: 'desk' }, h.deps)).rejects.toThrow('forward-failed');
    expect(h.ops).not.toContain('ssh stop');
    expect(h.records).toEqual([]);
  });

  it('two concurrent adds for Desk and desk: the second fails busy at once', async () => {
    const h = harness();
    let release: () => void = () => undefined;
    h.supervisor.ensure.mockImplementation(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const first = addSshMachine({ host: 'Desk' }, h.deps);
    await vi.waitFor(() => expect(h.supervisor.ensure).toHaveBeenCalled());
    await expect(addSshMachine({ host: 'desk' }, h.deps)).rejects.toMatchObject({ code: 'busy' });
    release();
    await first;
  });

  it('re-adding the same machine under another destination removes the older record and stops only its forward', async () => {
    const h = harness([storedRecord({ destination: 'old-alias' })]);
    await addSshMachine({ host: 'desk' }, h.deps);
    expect(h.records.map((r) => r.id)).toEqual(['rec-1']);
    expect(h.supervisor.stopForward).toHaveBeenCalledWith('rec-old');
    expect(h.ops.filter((op) => op === 'ssh stop')).toEqual([]);
  });

  it('refuses a bad destination before any SSH call', async () => {
    const h = harness();
    await expect(addSshMachine({ host: '-oProxyCommand=x' }, h.deps)).rejects.toMatchObject({ code: 'bad-destination' });
    expect(h.sshCalls).toEqual([]);
  });

  it('passes a validated pan path into every remote command', async () => {
    const h = harness();
    await addSshMachine({ host: 'desk', panPath: '/opt/pan/bin/pan', bothWays: false, access: 'agent-fenced' }, h.deps);
    expect(h.sshCalls.every((c) => c.cmd.includes('/opt/pan/bin/pan '))).toBe(true);
    expect(h.createMachineLink.mock.calls[0]![0]).toMatchObject({ bothWays: false, access: 'agent-fenced' });
  });
});

describe('testSshHost (FR-9)', () => {
  it('reports a matching version and runs nothing else', async () => {
    const h = harness();
    expect(await testSshHost({ host: 'desk' }, h.deps)).toEqual({
      reachable: true,
      panVersion: '0.72.0',
      localVersion: '0.72.0',
      versionMatches: true,
      error: null,
      message: null,
    });
    expect(h.ops).toEqual(['ssh version']);
  });

  it('reports a mismatch and an unreachable host in the body', async () => {
    const h = harness();
    h.answers.version = ok('0.70.1');
    expect(await testSshHost({ host: 'desk' }, h.deps)).toMatchObject({ reachable: true, panVersion: '0.70.1', versionMatches: false, error: 'version-mismatch' });
    h.answers.version = { exitCode: 255, stdout: '', stderr: 'me@desk: Permission denied (publickey).' };
    expect(await testSshHost({ host: 'desk' }, h.deps)).toMatchObject({ reachable: false, error: 'auth-failed' });
  });
});

describe('removeSshMachineForLink (FR-5)', () => {
  it('stops a managed server, then the forward, then deletes the record', async () => {
    const h = harness([storedRecord()]);
    expect(await removeSshMachineForLink({ id: 'link-old' }, { keepServer: false }, h.deps)).toEqual({ stopped: true, reason: 'stopped' });
    expect(h.ops).toEqual(['ssh stop', 'stopForward rec-old', 'remove rec-old']);
    expect(h.sshCalls[0]!.timeoutMs).toBe(60_000);
  });

  it('never runs the helper for an external record', async () => {
    const h = harness([storedRecord({ launch: 'external' })]);
    expect(await removeSshMachineForLink({ id: 'link-old' }, { keepServer: false }, h.deps)).toEqual({ stopped: false, reason: 'external' });
    expect(h.sshCalls).toEqual([]);
  });

  it('never runs the helper with keepServer', async () => {
    const h = harness([storedRecord()]);
    expect(await removeSshMachineForLink({ id: 'link-old' }, { keepServer: true }, h.deps)).toEqual({ stopped: false, reason: 'kept' });
    expect(h.sshCalls).toEqual([]);
    expect(h.records).toEqual([]);
  });

  it('still removes the record when the host cannot be reached', async () => {
    const h = harness([storedRecord()]);
    h.answers.stop = { exitCode: 255, stdout: '', stderr: 'ssh: connect to host desk port 22: Connection refused' };
    expect(await removeSshMachineForLink({ id: 'link-old' }, { keepServer: false }, h.deps)).toEqual({ stopped: false, reason: 'stop-failed' });
    expect(h.records).toEqual([]);
  });

  it('answers null for a link that is not SSH-backed', async () => {
    expect(await removeSshMachineForLink({ id: 'plain' }, { keepServer: false }, harness().deps)).toBeNull();
  });
});

describe('reconnectSshMachine (FR-8) and sshInfoForLink (FR-11)', () => {
  it('restarts the forward, re-runs start without pairing and records the launch kind', async () => {
    const h = harness([storedRecord({ launch: 'managed' })]);
    h.answers.start = ok(formatHelperResult(startResult({ launch: 'external', pairing: null })));
    const info = await reconnectSshMachine({ id: 'link-old' }, h.deps);
    expect(h.ops).toEqual(['ensure rec-old', 'ssh start-no-pair', 'update launch']);
    expect(info).toMatchObject({ launch: 'external', forward: 'up' });
  });

  it('gives the ssh block only for SSH-backed links', async () => {
    const h = harness([storedRecord()]);
    expect(await sshInfoForLink('link-old', h.deps)).toEqual({
      destination: 'desk',
      launch: 'managed',
      forward: 'up',
      forwardDetail: null,
      localPort: 40000,
      remotePort: 3011,
    });
    expect(await sshInfoForLink('plain', h.deps)).toBeUndefined();
  });
});
