/**
 * PAN-4927 W-SEC1 WI-1: the in-memory agent request store, its lazy expiry
 * and bounded waits, and the 0600 secret file writer. PAN-4942 W-LINK1 WI-1:
 * the machine-link kind.
 */
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SelfCaller } from '../self-caller.js';
import {
  AGENT_REQUEST_PENDING_LIMIT,
  agentRequestOwnerDir,
  createAgentRequests,
  ENDED_REQUEST_TTL_MS,
  MACHINE_LINK_REQUEST_TIMEOUT_MS,
  SECRET_REQUEST_DEFAULT_TIMEOUT_MS,
  writeAgentSecretFile,
} from '../services/agent-requests.js';

const agent: SelfCaller = { agentId: 'agent-pan-1', agentKind: 'agent', role: 'work', cwd: '/w/feature-pan-1', issueId: 'PAN-1', tmuxSession: null };
const other: SelfCaller = { agentId: 'agent-pan-2', agentKind: 'agent', role: 'work', cwd: '/w/feature-pan-2', issueId: 'PAN-2', tmuxSession: null };
const conversation: SelfCaller = { agentId: 'abc', agentKind: 'conversation', role: 'conversation', cwd: '/p', issueId: null, tmuxSession: 'conv-abc' };

const START_MS = Date.parse('2026-11-04T00:00:00.000Z');

function hexIds() {
  let next = 0;
  return () => (++next).toString(16).padStart(32, '0');
}

function ask(name: string, timeoutMs = SECRET_REQUEST_DEFAULT_TIMEOUT_MS) {
  return { name, prompt: `Need ${name}`, timeoutMs, label: 'agent-pan-1 · PAN-1' };
}

describe('agent requests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a pending secret request with a 32-hex id and its expiry', () => {
    const store = createAgentRequests();
    const result = store.createSecret(agent, ask('OPENAI_API_KEY'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.request.id).toMatch(/^[0-9a-f]{32}$/);
    expect(result.request).toMatchObject({
      kind: 'secret',
      agentId: 'agent-pan-1',
      agentKind: 'agent',
      label: 'agent-pan-1 · PAN-1',
      name: 'OPENAI_API_KEY',
      prompt: 'Need OPENAI_API_KEY',
      status: 'pending',
      endedAt: null,
      createdAt: new Date(START_MS).toISOString(),
      expiresAt: new Date(START_MS + SECRET_REQUEST_DEFAULT_TIMEOUT_MS).toISOString(),
    });
    expect(result.request).not.toHaveProperty('ownerDir');
  });

  it('answers the pending request again for a repeated ask of the same name (D-6)', () => {
    const store = createAgentRequests({ newId: hexIds() });
    const first = store.createSecret(agent, ask('OPENAI_API_KEY'));
    const second = store.createSecret(agent, ask('OPENAI_API_KEY'));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.created).toBe(false);
    expect(second.request.id).toBe(first.request.id);
    expect(second.request.id).toMatch(/^[0-9a-f]{32}$/);
    expect(store.listPending()).toHaveLength(1);
  });

  it('refuses the 21st distinct pending request of one agent and still lets another agent ask', () => {
    const store = createAgentRequests({ newId: hexIds() });
    for (let i = 0; i < AGENT_REQUEST_PENDING_LIMIT; i += 1) {
      expect(store.createSecret(agent, ask(`KEY_${i}`)).ok).toBe(true);
    }
    expect(store.createSecret(agent, ask('KEY_EXTRA'))).toEqual({ ok: false, code: 'too-many-requests' });
    // A repeated ask at the limit still answers the existing request.
    expect(store.createSecret(agent, ask('KEY_0'))).toMatchObject({ ok: true, created: false });
    expect(store.createSecret(other, ask('KEY_EXTRA'))).toMatchObject({ ok: true, created: true });
  });

  it('treats another agent request id as unknown in getForCaller and wait', async () => {
    const store = createAgentRequests({ newId: hexIds() });
    const result = store.createSecret(agent, ask('OPENAI_API_KEY'));
    if (!result.ok) throw new Error('create failed');
    expect(store.getForCaller(result.request.id, other)).toBeNull();
    expect(await store.wait(result.request.id, other, 1_000)).toBeNull();
    expect(store.getForCaller(result.request.id, agent)?.id).toBe(result.request.id);
    expect(store.getForCaller('f'.repeat(32), agent)).toBeNull();
    expect(await store.wait('f'.repeat(32), agent, 1_000)).toBeNull();
  });

  it('resolves a wait at once when settle runs during it', async () => {
    const store = createAgentRequests();
    const result = store.createSecret(agent, ask('OPENAI_API_KEY'));
    if (!result.ok) throw new Error('create failed');
    let resolved: string | null = null;
    const waiting = store.wait(result.request.id, agent, 50_000).then((view) => {
      resolved = view?.status ?? null;
      return view;
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(resolved).toBeNull();
    expect(store.settle(result.request.id, 'delivered', { file: '/x/secrets/OPENAI_API_KEY' })).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    const view = await waiting;
    expect(view).toMatchObject({ status: 'delivered', result: { file: '/x/secrets/OPENAI_API_KEY' } });
    expect(view?.endedAt).toBe(new Date(START_MS + 1_000).toISOString());
    expect(store.settle(result.request.id, 'declined')).toBe(false);
  });

  it('resolves a wait as pending after its timeout', async () => {
    const store = createAgentRequests();
    const result = store.createSecret(agent, ask('OPENAI_API_KEY'));
    if (!result.ok) throw new Error('create failed');
    let resolved = false;
    const waiting = store.wait(result.request.id, agent, 5_000).then((view) => {
      resolved = true;
      return view;
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await waiting)?.status).toBe('pending');
  });

  it('clamps a wait to the 50 s chunk', async () => {
    const store = createAgentRequests();
    const result = store.createSecret(agent, ask('OPENAI_API_KEY'));
    if (!result.ok) throw new Error('create failed');
    let resolved = false;
    const waiting = store.wait(result.request.id, agent, 120_000).then((view) => {
      resolved = true;
      return view;
    });
    await vi.advanceTimersByTimeAsync(49_999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await waiting)?.status).toBe('pending');
  });

  it('resolves a wait as expired when expiresAt passes first', async () => {
    const store = createAgentRequests();
    const result = store.createSecret(agent, ask('OPENAI_API_KEY', 60_000));
    if (!result.ok) throw new Error('create failed');
    await vi.advanceTimersByTimeAsync(30_000);
    let resolved = false;
    const waiting = store.wait(result.request.id, agent, 50_000).then((view) => {
      resolved = true;
      return view;
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const view = await waiting;
    expect(view?.status).toBe('expired');
    expect(view?.endedAt).toBe(new Date(START_MS + 60_000).toISOString());
    expect(store.listPending()).toEqual([]);
  });

  it('resolves a wait at once on an aborted signal', async () => {
    const store = createAgentRequests();
    const result = store.createSecret(agent, ask('OPENAI_API_KEY'));
    if (!result.ok) throw new Error('create failed');
    const already = new AbortController();
    already.abort();
    expect((await store.wait(result.request.id, agent, 50_000, already.signal))?.status).toBe('pending');

    const later = new AbortController();
    const waiting = store.wait(result.request.id, agent, 50_000, later.signal);
    await vi.advanceTimersByTimeAsync(1_000);
    later.abort();
    expect((await waiting)?.status).toBe('pending');
  });

  it('lists only pending requests, oldest first', async () => {
    const store = createAgentRequests({ newId: hexIds() });
    const ids: string[] = [];
    for (const name of ['A_KEY', 'B_KEY', 'C_KEY', 'D_KEY']) {
      const result = store.createSecret(agent, ask(name, 60_000 + ids.length * 60_000));
      if (!result.ok) throw new Error('create failed');
      ids.push(result.request.id);
      await vi.advanceTimersByTimeAsync(10);
    }
    store.settle(ids[1]!, 'delivered', { file: '/x' });
    store.settle(ids[2]!, 'declined');
    expect(store.listPending().map((view) => view.name)).toEqual(['A_KEY', 'D_KEY']);
    // A_KEY expires at 60 s.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.listPending().map((view) => view.name)).toEqual(['D_KEY']);
    expect(store.getForCaller(ids[0]!, agent)?.status).toBe('expired');
  });

  it('drops an ended request one hour after it ended', async () => {
    const store = createAgentRequests();
    const result = store.createSecret(agent, ask('OPENAI_API_KEY'));
    if (!result.ok) throw new Error('create failed');
    store.settle(result.request.id, 'declined');
    await vi.advanceTimersByTimeAsync(ENDED_REQUEST_TTL_MS);
    expect(store.getForCaller(result.request.id, agent)?.status).toBe('declined');
    await vi.advanceTimersByTimeAsync(1);
    expect(store.getForCaller(result.request.id, agent)).toBeNull();
    expect(store.getForAnswer(result.request.id)).toBeNull();
  });

  it('answers the owner directory only through getForAnswer', () => {
    const store = createAgentRequests();
    const result = store.createSecret(agent, ask('OPENAI_API_KEY'));
    if (!result.ok) throw new Error('create failed');
    const held = store.getForAnswer(result.request.id);
    expect(held?.ownerDir).toBe(agentRequestOwnerDir(agent));
    expect(held?.view.id).toBe(result.request.id);
    expect(JSON.stringify(store.listPending())).not.toContain(held!.ownerDir);
  });

  it('returns copies, so a caller cannot change a held request', () => {
    const store = createAgentRequests();
    const result = store.createSecret(agent, ask('OPENAI_API_KEY'));
    if (!result.ok) throw new Error('create failed');
    result.request.status = 'delivered';
    expect(store.getForCaller(result.request.id, agent)?.status).toBe('pending');
  });
});

describe('machine-link requests', () => {
  const label = 'agent-pan-1 · PAN-1';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a pending request with the trimmed hint that expires 24 h later', () => {
    const store = createAgentRequests();
    const result = store.createMachineLink(agent, { hint: '  my desk Mac ', label });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.request.id).toMatch(/^[0-9a-f]{32}$/);
    expect(result.request).toMatchObject({
      kind: 'machine-link',
      agentId: 'agent-pan-1',
      agentKind: 'agent',
      label,
      hint: 'my desk Mac',
      status: 'pending',
      endedAt: null,
      createdAt: new Date(START_MS).toISOString(),
      expiresAt: new Date(START_MS + MACHINE_LINK_REQUEST_TIMEOUT_MS).toISOString(),
    });
    expect(Date.parse(result.request.expiresAt) - Date.parse(result.request.createdAt)).toBe(24 * 60 * 60_000);
    expect(result.request).not.toHaveProperty('name');
    expect(result.request).not.toHaveProperty('prompt');
  });

  it('answers the pending request again for the same hint in another case, and makes a new one for another hint', () => {
    const store = createAgentRequests({ newId: hexIds() });
    const first = store.createMachineLink(agent, { hint: '  my desk Mac ', label });
    const again = store.createMachineLink(agent, { hint: 'MY DESK MAC', label });
    const different = store.createMachineLink(agent, { hint: 'build box', label });
    if (!first.ok || !again.ok || !different.ok) throw new Error('create failed');
    expect(again.created).toBe(false);
    expect(again.request.id).toBe(first.request.id);
    expect(different.created).toBe(true);
    expect(different.request.id).not.toBe(first.request.id);
    // Another owner with the same hint gets its own request.
    const otherOwner = store.createMachineLink(other, { hint: 'my desk Mac', label });
    expect(otherOwner).toMatchObject({ ok: true, created: true });
    expect(store.listPending()).toHaveLength(3);
  });

  it('shares the limit of 20 pending requests with secret requests', () => {
    const store = createAgentRequests({ newId: hexIds() });
    for (let i = 0; i < AGENT_REQUEST_PENDING_LIMIT - 1; i += 1) {
      expect(store.createSecret(agent, ask(`KEY_${i}`)).ok).toBe(true);
    }
    expect(store.createMachineLink(agent, { hint: 'desk', label })).toMatchObject({ ok: true, created: true });
    expect(store.createMachineLink(agent, { hint: 'build box', label })).toEqual({ ok: false, code: 'too-many-requests' });
    expect(store.createSecret(agent, ask('KEY_EXTRA'))).toEqual({ ok: false, code: 'too-many-requests' });
    // A repeated hint at the limit still answers the existing request.
    expect(store.createMachineLink(agent, { hint: 'DESK', label })).toMatchObject({ ok: true, created: false });
  });

  it('resolves a running wait as linked with the machine, and returns a copy of the machine', async () => {
    const store = createAgentRequests();
    const result = store.createMachineLink(agent, { hint: 'desk', label });
    if (!result.ok) throw new Error('create failed');
    const waiting = store.wait(result.request.id, agent, 50_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.settle(result.request.id, 'linked', { machine: { environmentId: 'env-1', label: 'desk' } })).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    const view = await waiting;
    expect(view).toMatchObject({ status: 'linked', result: { machine: { environmentId: 'env-1', label: 'desk' } } });
    view!.result!.machine!.label = 'changed';
    expect(store.getForCaller(result.request.id, agent)?.result?.machine).toEqual({ environmentId: 'env-1', label: 'desk' });
  });

  it('keeps the settled machine apart from the object the caller passed', () => {
    const store = createAgentRequests();
    const result = store.createMachineLink(agent, { hint: 'desk', label });
    if (!result.ok) throw new Error('create failed');
    const machine = { environmentId: 'env-1', label: 'desk' };
    store.settle(result.request.id, 'linked', { machine });
    machine.label = 'changed';
    expect(store.getForCaller(result.request.id, agent)?.result?.machine?.label).toBe('desk');
  });

  it('expires after 24 h', async () => {
    const store = createAgentRequests();
    const result = store.createMachineLink(agent, { hint: 'desk', label });
    if (!result.ok) throw new Error('create failed');
    await vi.advanceTimersByTimeAsync(MACHINE_LINK_REQUEST_TIMEOUT_MS - 1);
    expect(store.getForCaller(result.request.id, agent)?.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(store.getForCaller(result.request.id, agent)?.status).toBe('expired');
    expect(store.listPending()).toEqual([]);
  });
});

describe('agentRequestOwnerDir', () => {
  const previousHome = process.env.OVERDECK_HOME;
  beforeEach(() => {
    process.env.OVERDECK_HOME = '/home/test/.overdeck';
  });
  afterEach(() => {
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
  });

  it('answers the agent directory for an agent', () => {
    expect(agentRequestOwnerDir(agent)).toBe('/home/test/.overdeck/agents/agent-pan-1');
  });

  it('answers the conversation directory for a conversation, with the conv-<name> fallback', () => {
    expect(agentRequestOwnerDir(conversation)).toBe('/home/test/.overdeck/conversations/conv-abc');
    expect(agentRequestOwnerDir({ ...conversation, tmuxSession: null })).toBe('/home/test/.overdeck/conversations/conv-abc');
  });
});

describe('writeAgentSecretFile', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'agent-requests-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes the value to secrets/<name> with mode 0600 in a 0700 directory and leaves no partial file', async () => {
    const ownerDir = join(root, 'agents', 'agent-pan-1');
    const file = await writeAgentSecretFile(ownerDir, 'OPENAI_API_KEY', 'canary-value');
    expect(file).toBe(join(ownerDir, 'secrets', 'OPENAI_API_KEY'));
    expect(await readFile(file, 'utf8')).toBe('canary-value');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(ownerDir, 'secrets'))).mode & 0o777).toBe(0o700);
    expect(await readdir(join(ownerDir, 'secrets'))).toEqual(['OPENAI_API_KEY']);
  });

  it('tightens an existing 0755 secrets directory to 0700', async () => {
    const ownerDir = join(root, 'agents', 'agent-pan-1');
    await mkdir(join(ownerDir, 'secrets'), { recursive: true, mode: 0o755 });
    await chmod(join(ownerDir, 'secrets'), 0o755);
    await writeAgentSecretFile(ownerDir, 'OPENAI_API_KEY', 'canary-value');
    expect((await stat(join(ownerDir, 'secrets'))).mode & 0o777).toBe(0o700);
  });

  it('replaces the file on a second delivery of the same name', async () => {
    const ownerDir = join(root, 'agents', 'agent-pan-1');
    await writeAgentSecretFile(ownerDir, 'OPENAI_API_KEY', 'first');
    const file = await writeAgentSecretFile(ownerDir, 'OPENAI_API_KEY', 'second');
    expect(await readFile(file, 'utf8')).toBe('second');
    expect(await readdir(join(ownerDir, 'secrets'))).toEqual(['OPENAI_API_KEY']);
  });

  it('rejects a name that is not an environment-variable name', async () => {
    const ownerDir = join(root, 'agents', 'agent-pan-1');
    await expect(writeAgentSecretFile(ownerDir, '../X', 'canary-value')).rejects.toThrow(/secret name/);
    await expect(writeAgentSecretFile(ownerDir, 'lower', 'canary-value')).rejects.toThrow(/secret name/);
    await expect(stat(join(ownerDir, 'secrets'))).rejects.toThrow();
  });
});
