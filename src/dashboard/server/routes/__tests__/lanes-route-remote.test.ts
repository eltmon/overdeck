/**
 * PAN-4638 WI-8: stop and reap a lane on another machine from home, through
 * its owner. Real stand-in store and conversations DB in a temp
 * OVERDECK_HOME; links and the owner are fakes.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `lanes-route-remote-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;
mkdirSync(TEST_HOME, { recursive: true });

const { closeOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
const { readRemoteLane, remoteLanesRoot, writeRemoteLaneFacts } = await import('../../../../lib/lanes/remote-lanes.js');
const { resolveTargetMachine } = await import('../../services/fleet-target.js');
const { readJsonResponse } = await import('../machines-work.js');
const { handleLaneStop, handleRemoteLaneReap } = await import('../lanes.js');

type LaneRouteDeps = import('../lanes.js').LaneRouteDeps;
type MachineLink = import('../../../../lib/anywhere/link-store.js').MachineLink;
type FleetTargetDeps = import('../../services/fleet-target.js').FleetTargetDeps;
type Facts = import('../../../../lib/lanes/remote-lanes.js').RemoteLaneFacts;

const DESK = { id: 'link-desk', environmentId: 'env-desk', label: 'desk', revokedAt: null } as unknown as MachineLink;
const AGENT = { actor: { agentId: 'agent-pan-7' } } as const;

function deps(fetchPeer: LaneRouteDeps['fetchPeer'], online = true) {
  const targetDeps = {
    self: async () => ({ environmentId: 'env-home', label: 'home' }),
    links: async () => [DESK],
    status: () => ({ state: online ? 'online' : 'offline', tags: [] }),
    selfProfile: () => null,
  } as unknown as FleetTargetDeps;
  const value: LaneRouteDeps = {
    resolveTarget: (machine, gitOrigin, needs) => resolveTargetMachine(machine, gitOrigin, needs, targetDeps),
    projectOrigin: () => ({ gitOrigin: 'github.com/eltmon/lexerra' }),
    thisLabel: async () => 'home',
    fetchPeer,
    launch: vi.fn(),
    flyEnvironmentIds: async () => [],
    follow: vi.fn(),
    stopLocal: vi.fn(async () => undefined),
    now: () => new Date('2026-11-01T13:00:00.000Z'),
  };
  return value;
}

async function standIn(name: string): Promise<void> {
  const facts: Facts = {
    v: 1, name, environmentId: 'env-desk', label: 'desk', run: 'hotel', key: name, role: 'builder', iteration: 1,
    parentName: 'orch', criticOfName: null, projectKey: 'lexerra', cwd: `/home/desk/lanes/${name}`, branch: `hotel/${name}`, at: null,
    model: 'claude-opus-5-5', harness: 'claude-code', effort: null, title: name, createdAt: '2026-11-01T12:00:00.000Z',
  };
  await writeRemoteLaneFacts(facts);
}

const archivedFile = (name: string) => join(remoteLanesRoot(), name, 'archived.json');
const REAPED = { removed: true, archived: true, parkedPatch: null, warnings: [] };

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('stop and reap a remote lane (PAN-4638 WI-8)', () => {
  it('ac1: stop posts the owner conversation stop door as the calling agent', async () => {
    await standIn('stop-1');
    const fetchPeer = vi.fn(async () => ({ status: 200, json: { ok: true } }));
    const response = readJsonResponse(await handleLaneStop('stop-1', AGENT, deps(fetchPeer)));
    expect(response).toEqual({ status: 200, body: { stopped: true } });
    expect(fetchPeer).toHaveBeenCalledWith('env-desk', '/api/conversations/stop-1/stop', expect.objectContaining({ method: 'POST', actor: { agentId: 'agent-pan-7' } }));
  });

  it('stops a local lane through the conversation stop door and answers 404 for a name that is not a lane', async () => {
    createConversation({ name: 'stop-root', tmuxSession: 'conv-stop-root', cwd: TEST_HOME, workspaceId: null });
    createConversation({ name: 'stop-local', tmuxSession: 'conv-stop-local', cwd: TEST_HOME, workspaceId: null, parentName: 'stop-root', lane: { run: 'hotel', key: 'l1', role: 'builder' } });
    const fetchPeer = vi.fn();
    const d = deps(fetchPeer);
    expect(readJsonResponse(await handleLaneStop('stop-local', AGENT, d))).toEqual({ status: 200, body: { stopped: true } });
    expect(d.stopLocal).toHaveBeenCalledWith(expect.objectContaining({ name: 'stop-local' }));
    expect(readJsonResponse(await handleLaneStop('nope-1', AGENT, d)).status).toBe(404);
    expect(fetchPeer).not.toHaveBeenCalled();
  });

  it('ac2: an owner 200 archives the stand-in, and keep leaves it unarchived', async () => {
    await standIn('reap-1');
    await standIn('reap-2');
    const fetchPeer = vi.fn(async () => ({ status: 200, json: REAPED }));

    const reaped = readJsonResponse((await handleRemoteLaneReap('reap-1', { park: true, keep: false }, AGENT, deps(fetchPeer)))!);
    expect(reaped).toEqual({ status: 200, body: REAPED });
    expect(fetchPeer).toHaveBeenCalledWith('env-desk', '/api/machines/work/lanes/reap-1/reap', expect.objectContaining({ body: { park: true, keep: false } }));
    expect((await readRemoteLane('reap-1'))?.archivedAt).toBe('2026-11-01T13:00:00.000Z');

    await handleRemoteLaneReap('reap-2', { park: false, keep: true }, AGENT, deps(fetchPeer));
    expect(existsSync(archivedFile('reap-2'))).toBe(false);
  });

  it('ac3: an offline owner answers 503 and archives nothing', async () => {
    await standIn('reap-3');
    const fetchPeer = vi.fn();
    const response = readJsonResponse((await handleRemoteLaneReap('reap-3', { park: false, keep: false }, AGENT, deps(fetchPeer, false)))!);
    expect(response).toMatchObject({ status: 503, body: { code: 'machine-unreachable' } });
    expect(fetchPeer).not.toHaveBeenCalled();
    expect(existsSync(archivedFile('reap-3'))).toBe(false);
  });

  it('an unreached owner answers 503 and archives nothing', async () => {
    await standIn('reap-5');
    const fetchPeer = vi.fn(async () => { throw new Error('socket hang up'); });
    const response = readJsonResponse((await handleRemoteLaneReap('reap-5', { park: false, keep: false }, AGENT, deps(fetchPeer)))!);
    expect(response).toMatchObject({ status: 503, body: { code: 'machine-unreachable' } });
    expect(existsSync(archivedFile('reap-5'))).toBe(false);
  });

  it('ac4: an owner 404 unknown-lane archives the stand-in with a warning naming the machine', async () => {
    await standIn('reap-4');
    const fetchPeer = vi.fn(async () => ({ status: 404, json: { code: 'unknown-lane', error: 'no such lane' } }));
    const response = readJsonResponse((await handleRemoteLaneReap('reap-4', { park: false, keep: true }, AGENT, deps(fetchPeer)))!);
    expect(response.status).toBe(200);
    expect((response.body as { warnings: string[] }).warnings).toEqual(['the lane is gone from desk; archived it here']);
    expect(existsSync(archivedFile('reap-4'))).toBe(true);
  });

  it('answers null for a name with no stand-in, so the local reap runs', async () => {
    expect(await handleRemoteLaneReap('no-such-lane', { park: false, keep: false }, AGENT, deps(vi.fn()))).toBeNull();
  });
});
