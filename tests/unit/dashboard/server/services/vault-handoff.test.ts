/** PAN-4455 WI-2: handOffConversation maps every settle outcome onto the HandOffBody contract. */
import { describe, expect, it, vi } from 'vitest';
import type { LegacyConversation } from '../../../../../src/lib/overdeck/conversations.js';
import type { SessionRecord, Settlement } from '../../../../../src/lib/vault/format.js';
import type { SettleResult } from '../../../../../src/lib/vault/settle.js';
import type { WipCaptureResult } from '../../../../../src/lib/vault/wip-capture.js';
import { handOffConversation, wipProblemOf, type VaultHandoffDeps } from '../../../../../src/dashboard/server/services/vault-handoff.js';
import type { QueuedSettleOutcome } from '../../../../../src/dashboard/server/services/vault-service.js';

const VAULT_ID = '12345678-aaaa-4bbb-8ccc-dddddddddddd';
const NATIVE_PATH = '/tmp/t.jsonl';

function conversation(overrides: Partial<LegacyConversation> = {}): LegacyConversation {
  return { name: 'conv-1', harness: 'claude-code', ...overrides } as LegacyConversation;
}

function settlement(overrides: Partial<Settlement> = {}): Settlement {
  return { at: '2026-10-01T10:00:00.000Z', chunk: 'c1', turn: 1, lines: 10, logLines: 12, cwdState: null, ...overrides };
}

function record(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    vaultId: VAULT_ID,
    title: 'Fix the parser',
    updatedAt: '2026-10-01T09:00:00.000Z',
    settlements: [settlement({ at: '2026-10-01T08:00:00.000Z', logLines: 5 }), settlement()],
    ...overrides,
  } as SessionRecord;
}

function deps(outcome: QueuedSettleOutcome, overrides: Partial<VaultHandoffDeps> = {}) {
  const settle = vi.fn(async () => outcome);
  return {
    settle,
    deps: {
      getConversation: () => conversation(),
      resolvePath: async () => NATIVE_PATH,
      settle,
      machineLabel: async () => 'desk',
      ...overrides,
    } satisfies VaultHandoffDeps,
  };
}

function settled(result: SettleResult, rec: SessionRecord | null = record()): QueuedSettleOutcome {
  return { status: 'settled', result, record: rec };
}

describe('handOffConversation (PAN-4455 WI-2)', () => {
  it('saved from append: 200 with the append version, alreadySaved false and the last settlement logLines', async () => {
    const { deps: d, settle } = deps(settled({ verdict: 'append', vaultId: VAULT_ID, chunks: ['c1'], lines: 10, version: 3 }));
    const outcome = await handOffConversation('conv-1', d);
    expect(settle).toHaveBeenCalledWith(NATIVE_PATH, 'claude-code', 'force', { readBack: true });
    expect(outcome).toEqual({
      status: 200,
      body: {
        result: 'saved',
        vaultId: VAULT_ID,
        version: 3,
        savedAt: '2026-10-01T10:00:00.000Z',
        title: 'Fix the parser',
        machineLabel: 'desk',
        logLines: 12,
        alreadySaved: false,
        forkedFrom: null,
        wipProblem: null,
      },
    });
  });

  it('saved from noop with a record: alreadySaved true and the version counted from the record', async () => {
    const { deps: d } = deps(settled({ verdict: 'noop', vaultId: VAULT_ID }, record({ settlementsArchive: ['a1', 'a2'] })));
    const outcome = await handOffConversation('conv-1', d);
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ result: 'saved', version: 4, alreadySaved: true, savedAt: '2026-10-01T10:00:00.000Z' });
  });

  it('saved with forkedFrom reports the record it forked from', async () => {
    const forkedFrom = { vaultId: 'eeeeeeee-aaaa-4bbb-8ccc-dddddddddddd', version: 2 };
    const { deps: d } = deps(settled({ verdict: 'append', vaultId: VAULT_ID, chunks: ['c1'], lines: 10, version: 1, forkedFrom }));
    expect((await handOffConversation('conv-1', d)).body).toMatchObject({ result: 'saved', forkedFrom });
  });

  it('saved with a skipped code snapshot carries wipProblem', async () => {
    const wip: WipCaptureResult = { status: 'skipped', wip: { skipped: 'error', reason: 'git failed' } };
    const { deps: d } = deps(settled({ verdict: 'append', vaultId: VAULT_ID, chunks: ['c1'], lines: 10, version: 3, wip }));
    expect((await handOffConversation('conv-1', d)).body).toMatchObject({ result: 'saved', wipProblem: { message: 'The code snapshot failed: git failed.', fix: null } });
  });

  it('blocked: 422 with each hit and the exact allow-secret fixes', async () => {
    const { deps: d } = deps(settled({ verdict: 'blocked', vaultId: VAULT_ID, hits: [{ line: 7, pattern: 'aws-access-key' }] }, null));
    expect(await handOffConversation('conv-1', d)).toEqual({
      status: 422,
      body: {
        result: 'blocked',
        error: 'Not saved: the secret scan blocked line 7 (aws-access-key).',
        hits: [{ line: 7, pattern: 'aws-access-key' }],
        fixes: ['pan vault allow-secret /tmp/t.jsonl 7'],
      },
    });
  });

  it('offline: 422 with the pan vault save fix', async () => {
    const { deps: d } = deps(settled({ verdict: 'offline', vaultId: VAULT_ID }, null));
    expect(await handOffConversation('conv-1', d)).toEqual({
      status: 422,
      body: {
        result: 'offline',
        error: 'Not saved: the vault backend could not be reached. Check the connection and click Hand off now again.',
        fix: 'pan vault save /tmp/t.jsonl',
      },
    });
  });

  it('diverged: 422 not-saved with the settle reason', async () => {
    const { deps: d } = deps(settled({ verdict: 'diverged', vaultId: VAULT_ID, reason: 'the transcript was rewritten' }, null));
    expect(await handOffConversation('conv-1', d)).toEqual({
      status: 422,
      body: { result: 'not-saved', reason: 'diverged', error: 'Not saved: the transcript was rewritten.' },
    });
  });

  it('excluded: 422 not-saved naming the exclude rule', async () => {
    const { deps: d } = deps(settled({ verdict: 'excluded', vaultId: null }, null));
    expect(await handOffConversation('conv-1', d)).toEqual({
      status: 422,
      body: { result: 'not-saved', reason: 'excluded', error: 'Not saved: this conversation matches a Session Vault exclude rule (pan vault exclude).' },
    });
  });

  it('empty: a noop with no record is 422 not-saved', async () => {
    const { deps: d } = deps(settled({ verdict: 'noop', vaultId: VAULT_ID }, null));
    expect(await handOffConversation('conv-1', d)).toEqual({
      status: 422,
      body: { result: 'not-saved', reason: 'empty', error: 'Nothing to save yet: this conversation has no messages.' },
    });
  });

  it('an append whose record cannot be read back throws', async () => {
    const { deps: d } = deps(settled({ verdict: 'append', vaultId: VAULT_ID, chunks: ['c1'], lines: 10, version: 3 }, null));
    await expect(handOffConversation('conv-1', d)).rejects.toThrow('The settled record could not be read back.');
  });

  it('not-found: an unknown conversation name is 404 and never settles', async () => {
    const { deps: d, settle } = deps(settled({ verdict: 'noop', vaultId: VAULT_ID }), { getConversation: () => null });
    expect(await handOffConversation('missing', d)).toEqual({ status: 404, body: { result: 'not-found', error: 'No conversation named missing.' } });
    expect(settle).not.toHaveBeenCalled();
  });

  it('not-found: a conversation with no transcript file is 404 and never settles', async () => {
    const { deps: d, settle } = deps(settled({ verdict: 'noop', vaultId: VAULT_ID }), { resolvePath: async () => null });
    expect(await handOffConversation('conv-1', d)).toEqual({ status: 404, body: { result: 'not-found', error: 'This conversation has no transcript file yet.' } });
    expect(settle).not.toHaveBeenCalled();
  });

  it('unsupported-harness: an ohmypi conversation is 422 and never settles', async () => {
    const { deps: d, settle } = deps(settled({ verdict: 'noop', vaultId: VAULT_ID }), { getConversation: () => conversation({ harness: 'ohmypi' }) });
    expect(await handOffConversation('conv-1', d)).toEqual({
      status: 422,
      body: { result: 'unsupported-harness', error: 'Hand-off works for Claude Code and Codex conversations. This conversation runs on ohmypi.' },
    });
    expect(settle).not.toHaveBeenCalled();
  });

  it('a codex conversation settles with the codex harness', async () => {
    const { deps: d, settle } = deps(settled({ verdict: 'noop', vaultId: VAULT_ID }), { getConversation: () => conversation({ harness: 'codex' }) });
    expect((await handOffConversation('conv-1', d)).status).toBe(200);
    expect(settle).toHaveBeenCalledWith(NATIVE_PATH, 'codex', 'force', { readBack: true });
  });

  it('vault-unavailable: 409 with the vault state and its message', async () => {
    const { deps: d } = deps({ status: 'unavailable', opened: { status: 'off' } });
    const outcome = await handOffConversation('conv-1', d);
    expect(outcome.status).toBe(409);
    expect(outcome.body).toMatchObject({ result: 'vault-unavailable', state: 'off', error: expect.stringContaining('pan vault') });
  });
});

describe('wipProblemOf (PAN-4455 WI-2)', () => {
  it('secret: names each file and gives one allow-secret fix per distinct file', () => {
    const wip: WipCaptureResult = {
      status: 'skipped',
      wip: { skipped: 'secret' },
      hits: [
        { file: 'a.env', pattern: 'aws-access-key', hash: 'h1' },
        { file: 'a.env', pattern: 'token', hash: 'h2' },
        { file: 'b.ts', pattern: 'aws-access-key', hash: 'h3' },
      ],
    };
    expect(wipProblemOf(wip, VAULT_ID)).toEqual({
      message: 'The code snapshot was blocked by the secret scan: a.env (aws-access-key), a.env (token), b.ts (aws-access-key).',
      fix: 'pan vault allow-secret 12345678 --file a.env; pan vault allow-secret 12345678 --file b.ts',
    });
  });

  it('secret without hits: no fix', () => {
    expect(wipProblemOf({ status: 'skipped', wip: { skipped: 'secret' } }, VAULT_ID)).toEqual({ message: 'The code snapshot was blocked by the secret scan: secret.', fix: null });
  });

  it('too-large: names the size in MB and the wipMaxBytes fix', () => {
    const problem = wipProblemOf({ status: 'skipped', wip: { skipped: 'too-large', bytes: 30 * 1024 * 1024 } }, VAULT_ID);
    expect(problem?.message).toBe('The code snapshot is 30.0 MB, over the Session Vault size limit (wipMaxBytes).');
    expect(problem?.fix).toContain('wipMaxBytes');
  });

  it('error: the reason, no fix', () => {
    expect(wipProblemOf({ status: 'skipped', wip: { skipped: 'error' } }, VAULT_ID)).toEqual({ message: 'The code snapshot failed: unknown error.', fix: null });
  });

  it('clean, no-git, captured and absent: no problem', () => {
    expect(wipProblemOf({ status: 'skipped', wip: { skipped: 'clean' } }, VAULT_ID)).toBeNull();
    expect(wipProblemOf({ status: 'skipped', wip: { skipped: 'no-git' } }, VAULT_ID)).toBeNull();
    expect(wipProblemOf({ status: 'unchanged' }, VAULT_ID)).toBeNull();
    expect(wipProblemOf(undefined, VAULT_ID)).toBeNull();
  });
});
