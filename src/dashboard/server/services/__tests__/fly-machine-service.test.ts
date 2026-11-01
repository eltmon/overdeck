/**
 * PAN-4652 WI-8: addFlyMachine refuses early without creating a VM, links
 * home → VM one way over the public route, writes the record, and rolls back
 * (destroy, unlink, delete) on any failure after provisioning;
 * removeFlyMachineForLink destroys unless keepServer and always deletes.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MachineLinkView } from '@overdeck/contracts';

import { _resetFlyMachineStoreForTests, _settleFlyMachineWritesForTests, listFlyMachines, upsertFlyMachine } from '../../../../lib/anywhere/fly/machine-store.js';
import type { FlyProvisionResult } from '../../../../lib/anywhere/fly/provision.js';
import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import { _resetFlyMachineServiceForTests, addFlyMachine, type FlyMachineServiceDeps, removeFlyMachineForLink, startFlyConversation } from '../fly-machine-service.js';
import { MachineLinkError } from '../machine-link-service.js';

const ENV_ID = '3f2c1b7e-9a4d-4c2b-8e1f-0a1b2c3d4e5f';
const VM: FlyProvisionResult = {
  machineId: '148e21ea7e1689',
  machineName: 'overdeck-machine-1a2b3c4d',
  appName: 'overdeck-ws',
  region: 'iad',
  label: 'fly-148e21ea7e1689',
  environmentId: ENV_ID,
  docker: true,
  pairingCode: `odp_${'ab'.repeat(32)}`,
  routeUrl: 'wss://overdeck-ws.fly.dev/ws/link?fly-instance=148e21ea7e1689',
};
const LINK = { id: 'link-1', environmentId: ENV_ID, label: 'fly-148e21ea7e1689' } as MachineLink;
const VIEW = { id: 'link-1', environmentId: ENV_ID, label: 'fly-148e21ea7e1689' } as MachineLinkView;

const originalHome = process.env.OVERDECK_HOME;
let home: string;

function fakes(overrides: Partial<FlyMachineServiceDeps> = {}) {
  const deps = {
    loadConfig: vi.fn(async () => ({ remote: { enabled: true, max_concurrent_agents: 3 } })),
    hasFlyToken: vi.fn(() => true),
    checkCap: vi.fn(() => ({ allowed: true })),
    provision: vi.fn(async () => VM),
    destroy: vi.fn(async () => undefined),
    createMachineLink: vi.fn(async () => ({ link: LINK, view: VIEW })),
    removeLink: vi.fn(async () => null),
    ensureProject: vi.fn(async () => undefined),
    linkFetch: vi.fn(async () => ({ status: 201, json: { name: 'conv-fly-1' } })),
    notifyLinksChanged: vi.fn(),
    newId: () => 'rec-1',
    now: () => '2026-11-01T00:00:00.000Z',
    log: () => undefined,
    ...overrides,
  };
  return deps;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4652-fly-service-'));
  process.env.OVERDECK_HOME = home;
  _resetFlyMachineStoreForTests();
  _resetFlyMachineServiceForTests();
});

afterEach(async () => {
  await _settleFlyMachineWritesForTests();
  _resetFlyMachineStoreForTests();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('addFlyMachine (PAN-4652 WI-8)', () => {
  it('links one way over the public route and writes the record', async () => {
    const deps = fakes();
    const result = await addFlyMachine({ projectKey: 'overdeck' }, deps);

    expect(deps.createMachineLink).toHaveBeenCalledWith({
      transport: { url: VM.routeUrl, kind: 'public', pairingCode: VM.pairingCode },
      bothWays: false,
      access: 'operator',
    });
    expect(result.link).toBe(VIEW);
    expect(await listFlyMachines()).toEqual([{
      id: 'rec-1', linkId: 'link-1', environmentId: ENV_ID, machineId: VM.machineId, machineName: VM.machineName,
      appName: 'overdeck-ws', region: 'iad', label: 'fly-148e21ea7e1689', projectKey: 'overdeck', docker: true,
      createdAt: '2026-11-01T00:00:00.000Z',
    }]);
    expect(result.record.linkId).toBe('link-1');
    expect(deps.notifyLinksChanged).toHaveBeenCalledTimes(1);
    expect(deps.destroy).not.toHaveBeenCalled();
  });

  it.each([
    ['remote-disabled', { loadConfig: vi.fn(async () => ({ remote: { enabled: false } })) }, {}],
    ['no-fly-token', { hasFlyToken: vi.fn(() => false) }, {}],
    ['harness-unsupported', {}, { harness: 'codex' }],
    ['bad-request', {}, { message: 'hello' }],
    ['cap-reached', { checkCap: vi.fn(() => ({ allowed: false, message: 'Remote agent cap reached: 2/2' })) }, {}],
  ] as const)('refuses with %s before creating any machine', async (code, overrides, input) => {
    const deps = fakes(overrides as Partial<FlyMachineServiceDeps>);
    await expect(addFlyMachine(input, deps)).rejects.toMatchObject({ code });
    expect(deps.provision).not.toHaveBeenCalled();
    expect(await listFlyMachines()).toEqual([]);
  });

  it('destroys the machine and deletes the record when the link fails, naming the public-IP fix', async () => {
    const deps = fakes({
      createMachineLink: vi.fn(async () => { throw new MachineLinkError('unreachable', `${VM.routeUrl}: ECONNREFUSED`); }),
    });
    const error = await addFlyMachine({}, deps).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'unreachable' });
    expect((error as Error).message).toContain('fly ips allocate-v4 --shared -a overdeck-ws');
    expect(deps.destroy).toHaveBeenCalledTimes(1);
    expect(deps.destroy).toHaveBeenCalledWith('overdeck-ws', VM.machineId);
    expect(deps.removeLink).not.toHaveBeenCalled();
    expect(await listFlyMachines()).toEqual([]);
  });

  it('removes the link too when a step after linking fails', async () => {
    const deps = fakes({ updateRecord: vi.fn(async () => { throw new Error('disk full'); }) });
    await expect(addFlyMachine({}, deps)).rejects.toThrow('disk full');

    expect(deps.destroy).toHaveBeenCalledTimes(1);
    expect(deps.removeLink).toHaveBeenCalledWith('link-1');
    expect(await listFlyMachines()).toEqual([]);
  });
});

describe('project and conversation on the Fly machine (PAN-4652 WI-9)', () => {
  it('clones the project after linking, then starts the conversation and returns its path', async () => {
    const deps = fakes();
    const result = await addFlyMachine({ projectKey: 'overdeck', message: 'Fix the flaky test', model: 'claude-sonnet-5-5' }, deps);

    expect(deps.ensureProject).toHaveBeenCalledWith({ appName: 'overdeck-ws', machineId: VM.machineId }, 'overdeck');
    expect(deps.notifyLinksChanged.mock.invocationCallOrder[0]).toBeLessThan(deps.ensureProject.mock.invocationCallOrder[0]!);
    expect(result.conversation).toEqual({ environmentId: ENV_ID, name: 'conv-fly-1', path: `/conv/@${ENV_ID}/conv-fly-1` });
  });

  it('skips the conversation without a message', async () => {
    const deps = fakes();
    const result = await addFlyMachine({ projectKey: 'overdeck' }, deps);
    expect(deps.ensureProject).toHaveBeenCalledTimes(1);
    expect(deps.linkFetch).not.toHaveBeenCalled();
    expect(result.conversation).toBeUndefined();
  });

  it('startFlyConversation posts the Claude Code body as the operator', async () => {
    const linkFetch = vi.fn(async () => ({ status: 201, json: { name: 'conv-fly-1' } }));
    const result = await startFlyConversation({ environmentId: ENV_ID }, { message: 'hi', projectKey: 'overdeck', effort: 'high' }, { linkFetch });

    expect(linkFetch).toHaveBeenCalledWith(ENV_ID, '/api/conversations', {
      method: 'POST',
      actor: 'operator',
      body: { message: 'hi', projectKey: 'overdeck', harness: 'claude-code', model: undefined, effort: 'high' },
    });
    expect(result.path).toBe(`/conv/@${ENV_ID}/conv-fly-1`);
  });

  it('turns a 409 from the VM into conversation-failed carrying the body', async () => {
    const linkFetch = vi.fn(async () => ({ status: 409, json: { error: 'project busy' } }));
    await expect(startFlyConversation({ environmentId: ENV_ID }, { message: 'hi', projectKey: 'overdeck' }, { linkFetch }))
      .rejects.toMatchObject({ code: 'conversation-failed', detail: { status: 409, body: { error: 'project busy' } } });
  });

  it('a conversation failure destroys the machine, removes the link and deletes the record', async () => {
    const deps = fakes({ linkFetch: vi.fn(async () => ({ status: 500, json: { error: 'boom' } })) });
    await expect(addFlyMachine({ projectKey: 'overdeck', message: 'hi' }, deps)).rejects.toMatchObject({ code: 'conversation-failed' });

    expect(deps.destroy).toHaveBeenCalledTimes(1);
    expect(deps.removeLink).toHaveBeenCalledWith('link-1');
    expect(await listFlyMachines()).toEqual([]);
  });
});

describe('removeFlyMachineForLink (PAN-4652 WI-8)', () => {
  beforeEach(async () => {
    await upsertFlyMachine({
      id: 'rec-1', linkId: 'link-1', environmentId: ENV_ID, machineId: VM.machineId, machineName: VM.machineName,
      appName: 'overdeck-ws', region: 'iad', label: VM.label, projectKey: null, docker: false, createdAt: '2026-11-01T00:00:00.000Z',
    });
  });

  it('destroys the machine and deletes the record', async () => {
    const destroy = vi.fn(async () => undefined);
    expect(await removeFlyMachineForLink({ id: 'link-1' }, { keepServer: false }, { destroy })).toEqual({ destroyed: true });
    expect(destroy).toHaveBeenCalledWith('overdeck-ws', VM.machineId);
    expect(await listFlyMachines()).toEqual([]);
  });

  it('keeps the machine with keepServer but still deletes the record', async () => {
    const destroy = vi.fn(async () => undefined);
    expect(await removeFlyMachineForLink({ id: 'link-1' }, { keepServer: true }, { destroy })).toEqual({ destroyed: false });
    expect(destroy).not.toHaveBeenCalled();
    expect(await listFlyMachines()).toEqual([]);
  });

  it('returns null for a link that is not a Fly machine', async () => {
    const destroy = vi.fn(async () => undefined);
    expect(await removeFlyMachineForLink({ id: 'link-other' }, { keepServer: false }, { destroy })).toBeNull();
    expect(destroy).not.toHaveBeenCalled();
    expect(await listFlyMachines()).toHaveLength(1);
  });

  it('keeps the record when the destroy fails, so the unlink can be retried', async () => {
    const destroy = vi.fn(async () => { throw new Error('Fly API error 500'); });
    await expect(removeFlyMachineForLink({ id: 'link-1' }, { keepServer: false }, { destroy })).rejects.toMatchObject({ code: 'unreachable' });
    expect(await listFlyMachines()).toHaveLength(1);
  });
});

describe('spend cap reservation (CodeRabbit on PR #4742)', () => {
  const oneSlot = (_config: unknown, pending: number) => ({ allowed: pending < 1, message: 'Remote agent cap reached: 1/1 active remote agents and Fly machines.' });

  it('refuses a second concurrent add while the first is still provisioning, then frees the slot', async () => {
    let finish!: (vm: FlyProvisionResult) => void;
    const first = fakes({ checkCap: vi.fn(oneSlot), provision: vi.fn(() => new Promise<FlyProvisionResult>((resolve) => { finish = resolve; })) });
    const firstAdd = addFlyMachine({}, first);
    await vi.waitFor(() => expect(first.provision).toHaveBeenCalledTimes(1));

    const second = fakes({ checkCap: vi.fn(oneSlot) });
    await expect(addFlyMachine({}, second)).rejects.toMatchObject({ code: 'cap-reached' });
    expect(second.provision).not.toHaveBeenCalled();

    finish(VM);
    await firstAdd;
    const third = fakes({ checkCap: vi.fn(() => ({ allowed: true })), newId: () => 'rec-3' });
    await addFlyMachine({}, third);
    expect(third.checkCap).toHaveBeenCalledWith(expect.anything(), 0);
  });

  it('frees the slot when provisioning fails', async () => {
    const failing = fakes({ provision: vi.fn(async () => { throw new Error('createMachine 500'); }) });
    await expect(addFlyMachine({}, failing)).rejects.toThrow('createMachine 500');
    const next = fakes({ checkCap: vi.fn(() => ({ allowed: true })) });
    await addFlyMachine({}, next);
    expect(next.checkCap).toHaveBeenCalledWith(expect.anything(), 0);
  });
});
