/**
 * PAN-4650 WI-10: the viewer's Pull here job — release, transfer, adopt,
 * finish; undo on any failure after the release; the offline saved-copy path;
 * push back archives this machine's old released row and keeps its transcript.
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedConversationRow } from '@overdeck/contracts';

import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../../../tests/helpers/overdeck-test-db.js';
import { LinkUnavailableError, type LinkForwardInit, type LinkForwardResponse } from '../../../../lib/anywhere/link-client.js';
import type { MachineLink } from '../../../../lib/anywhere/link-store.js';
import { markConversationReleased, readPulledFrom } from '../../../../lib/overdeck/conversation-release.js';
import { upsertVaultBrowseRow } from '../../../../lib/overdeck/conversation-vault-rows.js';
import { createConversation, getConversationByName, setConversationClaudeSessionId } from '../../../../lib/overdeck/conversations.js';
import type { LinkedConversationRecord } from '../../../../lib/overdeck/linked-conversations.js';
import { storeForBackend } from '../../../../lib/vault/open.js';
import { packDirectory } from '../../../../lib/vault/transfer-pack.js';
import {
  _pullSettledForTests,
  _resetPullJobsForTests,
  getPull,
  PULL_JOB_RETENTION_MS,
  RELEASE_TIMEOUT_MS,
  startPull,
  type PullDeps,
} from '../conversation-pull.js';
import { ownerToken, type Outcome, type VaultContinueDeps } from '../vault-continue.js';

const SELF = 'env-laptop';
const OWNER = 'env-desk';
const VAULT_ID = '00000000-0000-4000-8000-0000000000aa';

const link: MachineLink = {
  id: 'link-desk', environmentId: OWNER, label: 'desk', machineKey: 'ab'.repeat(32), token: 'odk_x', access: 'operator',
  reverseTokenId: null, routes: [], createdAt: '2026-11-01T00:00:00.000Z', revokedAt: null,
};

function cached(row: Partial<SharedConversationRow> = {}): LinkedConversationRecord {
  return {
    id: 3, environmentId: OWNER, name: 'conv-x', nativeSessionId: 's-x', cachedAt: '2026-11-01T12:00:00.000Z', listHash: 'h',
    row: {
      name: 'conv-x', title: 'x', nativeSessionId: 's-x', harness: 'claude-code', model: null, status: 'active', sessionAlive: true,
      isWorking: false, lastActivityAt: null, projectKey: null, gitOrigin: null, cwd: '/w', issueId: null, tmuxSession: 'conv-x',
      releasedTo: null, createdAt: '2026-11-01T10:00:00.000Z', pullable: true, vaultId: VAULT_ID, ...row,
    },
  };
}

const ok = (body: unknown): LinkForwardResponse => ({ status: 200, headers: {}, body: Buffer.from(JSON.stringify(body)) });

let odb: OverdeckTestDb;
let pack: Buffer;
let calls: Array<{ method: string; path: string; timeoutMs?: number }>;
let releaseAnswer: Record<string, unknown>;

function forward(overrides: Partial<Record<'release' | 'transfer', () => Promise<LinkForwardResponse>>> = {}) {
  return vi.fn(async (_env: string, init: LinkForwardInit): Promise<LinkForwardResponse> => {
    calls.push({ method: init.method, path: init.path, timeoutMs: init.timeoutMs });
    if (init.path.endsWith('/release')) return overrides.release ? overrides.release() : ok(releaseAnswer);
    if (init.path.includes('/release/transfer/')) {
      return overrides.transfer ? overrides.transfer() : { status: 200, headers: {}, body: pack };
    }
    return ok({ ok: true });
  });
}

function adoptingContinue(result: Outcome = { status: 200, body: { conversation: { name: 'conv-new' } } }) {
  return vi.fn(async (_vaultId: string, _body: unknown, overrides?: Partial<VaultContinueDeps>): Promise<Outcome> => {
    if (overrides?.adoptRecord) await overrides.adoptRecord({} as never);
    return result;
  });
}

function deps(overrides: Partial<PullDeps> = {}): Partial<PullDeps> {
  return {
    getLink: async () => link,
    getLinked: () => cached(),
    forward: forward(),
    selfEnvironmentId: async () => SELF,
    home: () => odb.home,
    continueHere: adoptingContinue(),
    previewContinue: vi.fn(async () => ({ status: 200, body: { ownerToken: 'token-from-preview' } })),
    readVaultConfig: async () => ({}) as never,
    removeOwned: vi.fn(async () => undefined),
    adoptRecord: vi.fn(async () => ({ adopted: true as const, vaultId: VAULT_ID, path: '/claude/projects/w/new.jsonl', newSessionId: 's-new', lines: 3 })),
    ...overrides,
  };
}

async function run(d: Partial<PullDeps>, whenTurnRunning: 'wait' | 'stop' = 'wait') {
  const started = await startPull({ conversation: `@${OWNER}/conv-x`, whenTurnRunning }, d);
  if (started.status !== 202) throw new Error(`not started: ${started.status}`);
  await _pullSettledForTests(started.pullId);
  return getPull(started.pullId)!;
}

beforeEach(async () => {
  odb = setupOverdeckTestDb();
  _resetPullJobsForTests();
  calls = [];
  const store = join(odb.home, 'fixture-store');
  // A real dir: store, as the owner's settle leaves it (format marker included).
  await storeForBackend(`dir:${store}`);
  await writeFile(join(store, 'record.bin'), 'sealed');
  pack = await packDirectory(store);
  releaseAnswer = {
    transferId: '11111111-1111-4111-8111-111111111111', vaultId: VAULT_ID, keyHex: 'ab'.repeat(32), ownerEnvironmentId: OWNER,
    harness: 'claude-code', nativeSessionId: 's-x', bytes: pack.length, pulledFrom: null,
  };
  createConversation({ name: 'conv-new', tmuxSession: 'conv-conv-new', cwd: odb.home, harness: 'claude-code' });
}, 15_000);

afterEach(() => {
  vi.useRealTimers();
  teardownOverdeckTestDb(odb);
});

describe('Pull here job (PAN-4650 WI-10)', () => {
  it('walks release, transfer, adopt, finish and ends done with the new conversation', async () => {
    const d = deps();
    const job = await run(d, 'stop');

    expect(job).toMatchObject({ state: 'done', step: 'finish', mode: 'online', result: { name: 'conv-new', id: getConversationByName('conv-new')!.id } });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/conversations/conv-x/release',
      `GET /api/conversations/conv-x/release/transfer/${releaseAnswer.transferId}`,
      'POST /api/conversations/conv-x/release/complete',
    ]);
    expect(calls[0]!.timeoutMs).toBe(RELEASE_TIMEOUT_MS);
    expect(d.continueHere).toHaveBeenCalledWith(VAULT_ID, { expectedOwnerToken: ownerToken(OWNER), onDrift: 'note' }, expect.any(Object));
    expect(d.removeOwned).toHaveBeenCalledWith('/claude/projects/w/new.jsonl');
    expect(readPulledFrom('conv-new')).toEqual({ environmentId: OWNER, nativeSessionId: 's-x' });
    expect(existsSync(join(odb.home, 'pull-transfers', releaseAnswer.transferId as string))).toBe(false);
  });

  it('opens the unpacked transfer store with the key from the release answer', async () => {
    let vault: unknown;
    const continueHere = vi.fn(async (_id: string, _body: unknown, overrides?: Partial<VaultContinueDeps>): Promise<Outcome> => {
      vault = await overrides!.openVaultContext!();
      return { status: 200, body: { conversation: { name: 'conv-new' } } };
    });
    await run(deps({ continueHere }));
    expect(vault).toMatchObject({ status: 'open', vault: { rotatedAt: null } });
    expect(Object.keys((vault as { vault: { keys: object } }).vault.keys)).toEqual(expect.arrayContaining(['K_enc', 'K_id', 'K_ref']));
  });

  it('an adopt failure posts undo and ends failed', async () => {
    const job = await run(deps({ continueHere: adoptingContinue({ status: 409, body: { code: 'no-target', error: 'No checkout' } }) }));
    expect(job).toMatchObject({ state: 'failed', step: 'adopt', code: 'no-target', error: 'No checkout' });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/api/conversations/conv-x/release/undo' });
    expect(readPulledFrom('conv-new')).toBeNull();
  });

  it('a failed transfer posts undo too, and an oversized one never downloads', async () => {
    const failed = await run(deps({ forward: forward({ transfer: async () => ({ status: 404, headers: {}, body: Buffer.alloc(0) }) }) }));
    expect(failed).toMatchObject({ state: 'failed', step: 'transfer', code: 'transfer-failed' });
    expect(calls.at(-1)!.path).toBe('/api/conversations/conv-x/release/undo');

    calls = [];
    releaseAnswer.bytes = 64 * 1024 * 1024;
    const tooLarge = await run(deps());
    expect(tooLarge).toMatchObject({ state: 'failed', code: 'transfer-too-large' });
    expect(calls.map((call) => call.path)).toEqual(['/api/conversations/conv-x/release', '/api/conversations/conv-x/release/undo']);
  });

  it('a failure after adoption never posts undo, so the owner does not start a second runner', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const job = await run(deps({ removeOwned: vi.fn(async () => { throw new Error('index locked'); }) }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('conv-new runs here'), 'index locked');
    warn.mockRestore();
    expect(job).toMatchObject({ state: 'done', result: { name: 'conv-new' } });
    expect(calls.map((call) => call.path)).not.toContain('/api/conversations/conv-x/release/undo');
    expect(calls.at(-1)!.path).toBe('/api/conversations/conv-x/release/complete');
  });

  it('refuses a transfer id that is not a UUID, undoes the release and touches no directory', async () => {
    for (const transferId of ['..', '../x', 42]) {
      calls = [];
      releaseAnswer.transferId = transferId as string;
      const job = await run(deps());
      expect(job).toMatchObject({ state: 'failed', code: 'release-invalid' });
      expect(calls.map((call) => call.path)).toEqual(['/api/conversations/conv-x/release', '/api/conversations/conv-x/release/undo']);
    }
    expect(existsSync(odb.home)).toBe(true);
  });

  it('a refused release fails without an undo', async () => {
    const job = await run(deps({ forward: forward({ release: async () => ({ status: 409, headers: {}, body: Buffer.from('{"code":"turn-still-running","error":"busy"}') }) }) }));
    expect(job).toMatchObject({ state: 'failed', step: 'release', code: 'turn-still-running' });
    expect(calls).toHaveLength(1);
  });

  it('an offline owner with a saved copy continues it through the vault', async () => {
    upsertVaultBrowseRow({
      vaultId: VAULT_ID, title: 'x', harness: 'claude-code', ownerLabel: 'desk', cwd: odb.home, model: null,
      createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T11:00:00.000Z',
    });
    const offline = forward({ release: async () => { throw new LinkUnavailableError('machine-offline', 'desk is offline'); } });
    const d = deps({ forward: offline, continueHere: adoptingContinue() });
    const job = await run(d);
    expect(job).toMatchObject({ state: 'done', mode: 'offline', result: { name: 'conv-new' } });
    expect(d.previewContinue).toHaveBeenCalledWith(VAULT_ID);
    expect(d.continueHere).toHaveBeenCalledWith(VAULT_ID, { expectedOwnerToken: 'token-from-preview', onDrift: 'note' });
  });

  it('an offline owner without a saved copy fails owner-offline-no-saved-copy; an unreachable one never falls back', async () => {
    const offline = forward({ release: async () => { throw new LinkUnavailableError('machine-offline', 'desk is offline'); } });
    expect(await run(deps({ forward: offline }))).toMatchObject({ state: 'failed', code: 'owner-offline-no-saved-copy' });

    const unreachable = forward({ release: async () => { throw new LinkUnavailableError('machine-unreachable', 'desk did not answer in time'); } });
    const d = deps({ forward: unreachable });
    expect(await run(d)).toMatchObject({ state: 'failed', code: 'machine-unreachable' });
    expect(d.previewContinue).not.toHaveBeenCalled();
  });

  it('push back archives the old released row and keeps its transcript file', async () => {
    const transcript = join(odb.home, 'old-session.jsonl');
    await writeFile(transcript, '{"type":"user"}\n');
    createConversation({ name: 'conv-old', tmuxSession: 'conv-conv-old', cwd: odb.home, harness: 'claude-code' });
    setConversationClaudeSessionId('conv-old', 's-old');
    markConversationReleased('conv-old', OWNER);
    releaseAnswer.pulledFrom = { environmentId: SELF, nativeSessionId: 's-old' };

    expect((await run(deps())).state).toBe('done');
    expect(getConversationByName('conv-old')?.archivedAt).not.toBeNull();
    expect(existsSync(transcript)).toBe(true);
  });

  it('refuses a local name and a conversation the owner says cannot be pulled', async () => {
    expect(await startPull({ conversation: 'conv-x' }, deps())).toMatchObject({ status: 400, code: 'not-linked' });
    expect(await startPull({ conversation: `@${OWNER}/conv-x` }, deps({ getLinked: () => cached({ pullable: false }) }))).toMatchObject({ status: 400, code: 'not-pullable' });
  });

  it('forgets a job an hour after it started', async () => {
    let now = Date.now();
    const job = await run(deps({ now: () => now }));
    expect(getPull(job.pullId, now)).not.toBeNull();
    now += PULL_JOB_RETENTION_MS;
    expect(getPull(job.pullId, now)).toBeNull();
  });
});
