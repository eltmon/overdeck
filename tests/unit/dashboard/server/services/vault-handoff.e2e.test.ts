/**
 * PAN-4455 WI-4 (FR-15): two machines in one process, switched by HOME and
 * OVERDECK_HOME, sharing one `dir:` backend. Machine A hands a conversation off
 * through the real `settleOnQueue` (the vault service is never started, D-14);
 * machine B joins, syncs, lists the record and reads the new line count (D-19).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handOffConversation, type HandOffBody } from '../../../../../src/dashboard/server/services/vault-handoff.js';
import type { LegacyConversation } from '../../../../../src/lib/overdeck/conversations.js';
import { readVaultConfig } from '../../../../../src/lib/vault/config.js';
import { readSessionRecord, refName } from '../../../../../src/lib/vault/format.js';
import { joinVault } from '../../../../../src/lib/vault/join-core.js';
import { readListCache } from '../../../../../src/lib/vault/local-index.js';
import { DIR_BACKEND_PREFIX, openVaultContext } from '../../../../../src/lib/vault/open.js';
import { setupVault } from '../../../../../src/lib/vault/setup-core.js';
import { syncOnce } from '../../../../../src/lib/vault/sync.js';

const SESSION = '44554455-0000-4000-8000-000000000000';

function user(text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: SESSION, cwd, message: { role: 'user', content: text } });
}

describe('Hand off now across two machines (PAN-4455 WI-4)', () => {
  let root: string;
  let originalEnv: { home?: string; overdeck?: string };

  function useMachine(name: string): void {
    const home = join(root, name);
    process.env.HOME = home;
    process.env.OVERDECK_HOME = join(home, '.overdeck');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-4455-handoff-e2e-'));
    originalEnv = { home: process.env.HOME, overdeck: process.env.OVERDECK_HOME };
  });

  afterEach(() => {
    if (originalEnv.home === undefined) delete process.env.HOME; else process.env.HOME = originalEnv.home;
    if (originalEnv.overdeck === undefined) delete process.env.OVERDECK_HOME; else process.env.OVERDECK_HOME = originalEnv.overdeck;
    rmSync(root, { recursive: true, force: true });
  });

  it('A hands off three times; B joins, syncs, lists the record and reads the new line count', async () => {
    const backend = `${DIR_BACKEND_PREFIX}${join(root, 'backend')}`;

    // --- Machine A: set up the vault and hand the conversation off ---
    useMachine('machine-a');
    const setup = await setupVault({ url: backend, passphrase: { mode: 'none' } });
    expect(setup.status).toBe('created');
    if (setup.status !== 'created') return;
    const recoveryPhrase = setup.recoveryPhrase!;
    expect(recoveryPhrase).toBeTruthy();

    // Not a git checkout, so WIP capture reports no-git and adds nothing.
    const cwd = join(root, 'project');
    mkdirSync(cwd, { recursive: true });
    const transcriptPath = join(root, 'machine-a', 'transcripts', `${SESSION}.jsonl`);
    mkdirSync(join(root, 'machine-a', 'transcripts'), { recursive: true });
    writeFileSync(transcriptPath, `${user('first question', cwd)}\n${user('second question', cwd)}\n`);

    const deps = {
      getConversation: () => ({ name: 'conv-a', harness: 'claude-code' }) as LegacyConversation,
      resolvePath: async () => transcriptPath,
    };

    const first = await handOffConversation('conv-a', deps);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ result: 'saved', version: 1, logLines: 2, alreadySaved: false, forkedFrom: null, wipProblem: null });

    appendFileSync(transcriptPath, `${user('third question', cwd)}\n${user('fourth question', cwd)}\n`);
    const second = await handOffConversation('conv-a', deps);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ result: 'saved', version: 2, logLines: 4, alreadySaved: false });

    const third = await handOffConversation('conv-a', deps);
    expect(third.status).toBe(200);
    expect(third.body).toMatchObject({ result: 'saved', version: 2, alreadySaved: true });

    const saved = second.body as Extract<HandOffBody, { result: 'saved' }>;

    // --- Machine B: join, sync, list and read the record ---
    useMachine('machine-b');
    const joined = await joinVault({ url: backend, secret: { kind: 'phrase', value: recoveryPhrase } });
    expect(joined.status).toBe('joined');
    const opened = await openVaultContext();
    expect(opened.status).toBe('open');
    if (opened.status !== 'open') return;
    await syncOnce({ store: opened.vault.store, keys: opened.vault.keys, config: await readVaultConfig() });

    const row = (await readListCache()).find((entry) => entry.vaultId === saved.vaultId);
    expect(row).toMatchObject({ vaultId: saved.vaultId, ownerIsHere: false, ownerLabel: saved.machineLabel });

    const name = refName('record', saved.vaultId, opened.vault.keys.K_ref);
    const ref = await opened.vault.store.readRef(name);
    expect(ref).not.toBeNull();
    const record = await readSessionRecord(name, ref!.value, opened.vault.keys);
    expect(record && 'settlements' in record ? record.settlements.at(-1)?.lines : null).toBe(4);
  });
});
