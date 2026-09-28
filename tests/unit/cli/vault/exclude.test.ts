import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { allowSecretCommand } from '../../../../src/cli/commands/vault/allow-secret.js';
import { excludeCommand, includeCommand } from '../../../../src/cli/commands/vault/exclude.js';
import { listCommand } from '../../../../src/cli/commands/vault/list.js';
import { saveCommand } from '../../../../src/cli/commands/vault/save.js';
import { setupCommand } from '../../../../src/cli/commands/vault/setup.js';
import { syncCommand } from '../../../../src/cli/commands/vault/sync.js';
import type { DiscoveredTranscript } from '../../../../src/lib/vault/discover.js';
import { readVaultConfig } from '../../../../src/lib/vault/config.js';
import { isTombstone, readSessionRecord, refName } from '../../../../src/lib/vault/format.js';
import { deriveSubkeys, loadVaultKey } from '../../../../src/lib/vault/identity.js';
import { listOwned, readListCache } from '../../../../src/lib/vault/local-index.js';
import { GitVaultStore } from '../../../../src/lib/vault/store/git.js';
import { Fixture, captureIo, runCli } from './helpers.js';

const API_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';

function user(session: string, text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: session, cwd, message: { role: 'user', content: text } });
}

describe('pan vault exclude / include / allow-secret', () => {
  let fx: Fixture;
  let overdeckHome: string;
  let secretProj: string;
  let openProj: string;
  let discovered: DiscoveredTranscript[];
  const secretSession = 'ex100000-0000-4000-8000-000000000000';
  const openSession = 'ex200000-0000-4000-8000-000000000000';

  beforeEach(async () => {
    fx = new Fixture();
    ({ overdeckHome } = fx.useMachine('a'));
    await runCli(() => setupCommand(fx.bareRepo(), {}, captureIo()));
    secretProj = join(fx.root, 'work', 'secret-proj');
    openProj = join(fx.root, 'work', 'open-proj');
    mkdirSync(secretProj, { recursive: true });
    mkdirSync(openProj, { recursive: true });
    const dir = join(fx.root, 'transcripts');
    mkdirSync(dir);
    discovered = [];
    for (const [session, cwd] of [[secretSession, secretProj], [openSession, openProj]] as const) {
      const path = join(dir, `${session}.jsonl`);
      writeFileSync(path, `${user(session, `hello from ${basename(cwd)}`, cwd)}\n`);
      discovered.push({ nativePath: path, harness: 'claude-code', sessionId: session });
    }
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('ac1: after excluding a path, save --all creates no record for sessions under it', async () => {
    const io = captureIo();
    expect(await runCli(() => excludeCommand(secretProj, {}, io))).toBe(0);
    expect((await readVaultConfig()).exclude.paths).toEqual([secretProj]);
    const save = captureIo();
    await runCli(() => saveCommand(undefined, { all: true }, save, { discover: async () => discovered }));
    expect(save.stdout.find((line) => line.startsWith(secretSession))).toMatch(/: excluded$/);
    expect(save.stdout.find((line) => line.startsWith(openSession))).toMatch(/: appended 1 line/);
    expect(Object.values(await listOwned()).map((entry) => entry.harness)).toEqual(['claude-code']);
    expect(Object.keys(await listOwned())[0]).toContain(openSession);

    await runCli(() => includeCommand(secretProj, {}, captureIo()));
    expect((await readVaultConfig()).exclude.paths).toEqual([]);
    const after = captureIo();
    await runCli(() => saveCommand(undefined, { all: true }, after, { discover: async () => discovered }));
    expect(after.stdout.find((line) => line.startsWith(secretSession))).toMatch(/: appended 1 line/);
    const bad = captureIo();
    expect(await runCli(() => excludeCommand(undefined, {}, bad))).toBe(1);
  });

  it('ac2: excluding a saved session tombstones its record and list hides it', async () => {
    await runCli(() => saveCommand(undefined, { all: true }, captureIo(), { discover: async () => discovered }));
    await runCli(() => syncCommand({}, captureIo()));
    const rows = await readListCache();
    expect(rows).toHaveLength(2);
    const target = rows.find((row) => row.title.includes('open-proj'))!;

    const io = captureIo();
    expect(await runCli(() => excludeCommand(undefined, { session: target.vaultId.slice(0, 8) }, io))).toBe(0);
    expect(io.stdout[0]).toContain('tombstone');
    expect((await readVaultConfig()).exclude.sessions).toEqual([target.vaultId]);

    const keys = deriveSubkeys((await loadVaultKey())!);
    const store = await GitVaultStore.open(join(overdeckHome, 'vault', 'git'));
    const name = refName('record', target.vaultId, keys.K_ref);
    const value = await readSessionRecord(name, (await store.readRef(name))!.value, keys);
    expect(value && isTombstone(value)).toBe(true);
    expect(Object.values(await listOwned()).some((entry) => entry.vaultId === target.vaultId)).toBe(false);

    const list = captureIo();
    await runCli(() => listCommand({}, list));
    expect(list.stdout.join('\n')).not.toContain('open-proj');
    expect(list.stdout.join('\n')).toContain('secret-proj');
    await runCli(() => syncCommand({}, captureIo()));
    const listAfterSync = captureIo();
    await runCli(() => listCommand({}, listAfterSync));
    expect(listAfterSync.stdout.join('\n')).not.toContain('open-proj');

    // --origin exclusions are recorded too.
    await runCli(() => excludeCommand(undefined, { origin: 'git@github.com:x/y.git' }, captureIo()));
    expect((await readVaultConfig()).exclude.origins).toEqual(['git@github.com:x/y.git']);
    await runCli(() => includeCommand(undefined, { origin: 'git@github.com:x/y.git' }, captureIo()));
    expect((await readVaultConfig()).exclude.origins).toEqual([]);
  });

  it('ac3: after allow-secret, the next save appends the blocked line', async () => {
    const session = 'ex300000-0000-4000-8000-000000000000';
    const path = join(fx.root, `${session}.jsonl`);
    writeFileSync(path, `${user(session, 'fine', openProj)}\n${user(session, `key ${API_KEY}`, openProj)}\n`);
    const blocked = captureIo();
    expect(await runCli(() => saveCommand(path, {}, blocked))).toBe(1);
    expect(blocked.stdout[0]).toBe(`${session}.jsonl: blocked at line 2: api-key`);

    // The transcript was never saved, so it is named by path.
    const allow = captureIo();
    expect(await runCli(() => allowSecretCommand(path, '2', {}, allow))).toBe(0);
    expect(allow.stdout[0]).toContain('Allowed line 2');
    const saved = captureIo();
    expect(await runCli(() => saveCommand(path, {}, saved))).toBe(0);
    expect(saved.stdout[0]).toMatch(/appended 2 lines/);

    // A saved record can be named by vaultId.
    const owned = Object.values(await listOwned()).find((entry) => true)!;
    writeFileSync(path, `${user(session, 'fine', openProj)}\n${user(session, `key ${API_KEY}`, openProj)}\n${user(session, `again ${API_KEY}`, openProj)}\n`);
    const blockedAgain = captureIo();
    expect(await runCli(() => saveCommand(path, {}, blockedAgain))).toBe(1);
    expect(blockedAgain.stdout[0]).toBe(`${session}.jsonl: blocked at line 3: api-key`);
    expect(await runCli(() => allowSecretCommand(owned.vaultId, '3', {}, captureIo()))).toBe(0);
    const savedAgain = captureIo();
    expect(await runCli(() => saveCommand(path, {}, savedAgain))).toBe(0);
    expect(savedAgain.stdout[0]).toMatch(/appended 1 line/);

    const badLine = captureIo();
    expect(await runCli(() => allowSecretCommand(path, '99', {}, badLine))).toBe(1);
    expect(badLine.stderr[0]).toMatch(/line 99 does not exist/);
  });
});
