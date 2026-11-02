/**
 * PAN-4638 WI-1: unified lane rows merge local conversations and remote
 * stand-ins. Real conversations DB and stand-in store in a temp OVERDECK_HOME.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `lane-rows-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;
mkdirSync(TEST_HOME, { recursive: true });

const { closeOverdeckDatabase } = await import('../../overdeck/infra.js');
const { createConversation, getConversationByName } = await import('../../overdeck/conversations.js');
const { writeCriticLink, writeRemoteLaneFacts } = await import('../remote-lanes.js');
const { listAllLaneRows } = await import('../lane-rows.js');
const { laneIterations } = await import('../iteration.js');
type Facts = import('../remote-lanes.js').RemoteLaneFacts;

const SHARED_CWD = '/home/u/.overdeck/lanes/shared';

function root(name: string): void {
  createConversation({ name, tmuxSession: `conv-${name}`, cwd: TEST_HOME, workspaceId: null });
}

function lane(name: string, parent: string, run: string, key: string, role: 'builder' | 'critic' = 'builder', cwd = join(TEST_HOME, 'lanes', name)): void {
  createConversation({ name, tmuxSession: `conv-${name}`, cwd, workspaceId: null, parentName: parent, lane: { run, key, role } });
}

function remote(name: string, overrides: Partial<Facts>): Facts {
  return {
    v: 1,
    name,
    environmentId: 'env-laptop',
    label: 'laptop',
    run: 'run',
    key: 'hotel',
    role: 'builder',
    iteration: 1,
    parentName: 'orchestrator',
    criticOfName: null,
    projectKey: 'overdeck',
    cwd: SHARED_CWD,
    branch: null,
    at: null,
    model: 'claude-opus-5-5',
    harness: 'claude-code',
    effort: null,
    title: 'remote lane',
    createdAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('listAllLaneRows (PAN-4638 WI-1)', () => {
  it('ac2: merges a local lane and a stand-in of one run in createdAt order', async () => {
    root('ac2-root');
    lane('ac2-local', 'ac2-root', 'ac2', 'hotel');
    await writeRemoteLaneFacts(remote('ac2-remote', { run: 'ac2', parentName: 'ac2-root' }));

    const rows = await listAllLaneRows({ run: 'ac2' });
    expect(rows.map((row) => row.name)).toEqual(['ac2-local', 'ac2-remote']);
    const [local, other] = rows;
    expect(local).toMatchObject({ id: getConversationByName('ac2-local')?.id, cwdKey: join(TEST_HOME, 'lanes', 'ac2-local'), remote: null });
    expect(local.local?.name).toBe('ac2-local');
    expect(other).toMatchObject({
      id: null,
      cwd: SHARED_CWD,
      cwdKey: `env-laptop:${SHARED_CWD}`,
      parentId: getConversationByName('ac2-root')?.id,
      parentName: 'ac2-root',
      local: null,
      archivedAt: null,
    });
    expect(other.remote?.facts.label).toBe('laptop');
  });

  it('applies the parent filter to stand-ins', async () => {
    root('pf-root');
    await writeRemoteLaneFacts(remote('pf-mine', { run: 'pf', parentName: 'pf-root' }));
    await writeRemoteLaneFacts(remote('pf-theirs', { run: 'pf', parentName: 'someone-else' }));
    expect((await listAllLaneRows({ parentName: 'pf-root' })).map((row) => row.name)).toEqual(['pf-mine']);
  });

  it('ac3: counts the same cwd string on two machines as two iterations', async () => {
    root('ac3-root');
    lane('ac3-local', 'ac3-root', 'ac3', 'hotel', 'builder', SHARED_CWD);
    await writeRemoteLaneFacts(remote('ac3-remote', { run: 'ac3', parentName: 'ac3-root' }));
    await writeRemoteLaneFacts(remote('ac3-desktop', {
      run: 'ac3',
      parentName: 'ac3-root',
      environmentId: 'env-desktop',
      label: 'desktop',
      createdAt: new Date(Date.now() + 120_000).toISOString(),
    }));

    const iterations = laneIterations(await listAllLaneRows({ run: 'ac3', key: 'hotel', role: 'builder' }));
    expect(Object.fromEntries(iterations)).toEqual({ 'ac3-local': 1, 'ac3-remote': 2, 'ac3-desktop': 3 });
  });

  it('ac4: fills a local critic\'s criticOfName from its lane-link sidecar', async () => {
    root('ac4-root');
    lane('ac4-critic', 'ac4-root', 'ac4', 'hotel', 'critic');
    await writeCriticLink('ac4-critic', 'ac4-builder');

    const [critic] = await listAllLaneRows({ run: 'ac4' });
    expect(critic.local?.criticOfConversationId).toBeNull();
    expect(critic.criticOfName).toBe('ac4-builder');
  });

  it('keeps the critic FK over a sidecar and ignores sidecars for builders', async () => {
    root('fk-root');
    lane('fk-builder', 'fk-root', 'fk', 'hotel');
    createConversation({
      name: 'fk-critic',
      tmuxSession: 'conv-fk-critic',
      cwd: join(TEST_HOME, 'lanes', 'fk-critic'),
      workspaceId: null,
      parentName: 'fk-root',
      lane: { run: 'fk', key: 'hotel', role: 'critic', criticOfName: 'fk-builder' },
    });
    await writeCriticLink('fk-builder', 'nobody');

    const rows = await listAllLaneRows({ run: 'fk' });
    expect(rows.find((row) => row.name === 'fk-critic')?.criticOfName).toBe('fk-builder');
    expect(rows.find((row) => row.name === 'fk-builder')?.criticOfName).toBeNull();
  });
});
