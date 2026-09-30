import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeAnywhereProblems, readAnywhereVaultState } from '../../../../src/lib/remote-access/anywhere-status.js';
import { writeVaultConfig } from '../../../../src/lib/vault/config.js';
import { HEADER_REF_NAME, encryptRef, newVaultHeader } from '../../../../src/lib/vault/format.js';
import { createVaultKey, deriveSubkeys, saveVaultKey } from '../../../../src/lib/vault/identity.js';
import { DIR_BACKEND_PREFIX } from '../../../../src/lib/vault/open.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';

const reachable = [{ origin: 'http://127.0.0.1:3011', loopback: true }, { origin: 'https://desk.tailnet.ts.net', loopback: false }];
const loopbackOnly = [{ origin: 'http://127.0.0.1:3011', loopback: true }];
const vaultReady = { state: 'ready' as const, backend: 'git@example.com:me/vault.git' };

describe('computeAnywhereProblems (PAN-4445 D-8)', () => {
  it('returns [] when nothing is wrong, including a vault that is off', () => {
    expect(computeAnywhereProblems({ identityError: null, addresses: reachable, vault: vaultReady })).toEqual([]);
    expect(computeAnywhereProblems({ identityError: null, addresses: reachable, vault: { state: 'off', backend: null } })).toEqual([]);
  });

  it('reports an unreadable identity with a docs link and no fix button', () => {
    const [problem] = computeAnywhereProblems({ identityError: 'bad file /x/environment-id.json', addresses: reachable, vault: vaultReady });
    expect(problem?.code).toBe('identity-unreadable');
    expect(problem?.message).toContain('bad file /x/environment-id.json');
    expect(problem?.action).toEqual({ kind: 'none', docsUrl: 'https://overdeck.ai/configuration/remote-access' });
  });

  it('reports no reachable address with the pair-dialog action', () => {
    expect(computeAnywhereProblems({ identityError: null, addresses: loopbackOnly, vault: vaultReady })).toEqual([
      expect.objectContaining({ code: 'no-reachable-address', action: { kind: 'pair-dialog' } }),
    ]);
  });

  it('reports a locked vault with the session-vault settings action', () => {
    const problems = computeAnywhereProblems({ identityError: null, addresses: reachable, vault: { state: 'locked', backend: 'git@example.com:me/vault.git' } });
    expect(problems).toEqual([
      expect.objectContaining({ code: 'vault-locked', action: { kind: 'settings-section', section: 'session-vault' } }),
    ]);
    expect(problems[0]?.message).toContain('git@example.com:me/vault.git');
  });

  it('reports a pending rotation with a docs link and no fix button', () => {
    expect(computeAnywhereProblems({ identityError: null, addresses: reachable, vault: { state: 'rotation-pending', backend: 'b' } })).toEqual([
      expect.objectContaining({
        code: 'vault-rotation-pending',
        action: { kind: 'none', docsUrl: 'https://overdeck.ai/configuration/session-vault' },
      }),
    ]);
  });

  it('keeps a fixed order and never tells the operator to run a pan command', () => {
    const problems = computeAnywhereProblems({ identityError: 'x', addresses: loopbackOnly, vault: { state: 'locked', backend: 'b' } });
    expect(problems.map((problem) => problem.code)).toEqual(['identity-unreadable', 'no-reachable-address', 'vault-locked']);
    for (const problem of [...problems, ...computeAnywhereProblems({ identityError: null, addresses: reachable, vault: { state: 'rotation-pending', backend: 'b' } })]) {
      expect(problem.message).not.toMatch(/\bpan [a-z]/);
    }
  });
});

describe('readAnywhereVaultState (PAN-4445 D-9, openVaultContext)', () => {
  let home: string;
  let backendDir: string;
  let backend: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env['OVERDECK_HOME'];
    home = mkdtempSync(join(tmpdir(), 'anywhere-vault-test-'));
    backendDir = join(home, 'backend');
    backend = `${DIR_BACKEND_PREFIX}${backendDir}`;
    process.env['OVERDECK_HOME'] = join(home, '.overdeck');
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env['OVERDECK_HOME'];
    else process.env['OVERDECK_HOME'] = savedHome;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /** A vault header in a `dir:` backend, readable by `key`. */
  async function writeHeader(key: Buffer): Promise<void> {
    const store = await DirVaultStore.open(backendDir);
    await store.casRef(HEADER_REF_NAME, null, await encryptRef(HEADER_REF_NAME, newVaultHeader(), deriveSubkeys(key)));
  }

  it('is off with no vault config', async () => {
    await expect(readAnywhereVaultState()).resolves.toEqual({ state: 'off', backend: null });
  });

  it('is locked with a backend and no key', async () => {
    await writeHeader(createVaultKey());
    await writeVaultConfig({ backend });
    await expect(readAnywhereVaultState()).resolves.toEqual({ state: 'locked', backend });
  });

  it('is locked when this machine holds a key that does not open the vault', async () => {
    await writeHeader(createVaultKey());
    await saveVaultKey(createVaultKey());
    await writeVaultConfig({ backend });
    await expect(readAnywhereVaultState()).resolves.toEqual({ state: 'locked', backend });
  });

  it('is ready with a key that opens the vault', async () => {
    const key = createVaultKey();
    await writeHeader(key);
    await saveVaultKey(key);
    await writeVaultConfig({ backend });
    await expect(readAnywhereVaultState()).resolves.toEqual({ state: 'ready', backend });
  });

  it('is rotation-pending while key.next exists', async () => {
    const key = createVaultKey();
    await writeHeader(key);
    await saveVaultKey(key);
    await writeVaultConfig({ backend });
    writeFileSync(join(home, '.overdeck', 'vault', 'key.next'), createVaultKey());
    await expect(readAnywhereVaultState()).resolves.toEqual({ state: 'rotation-pending', backend });
  });

  it('strips a user and password from the backend URL', async () => {
    await writeVaultConfig({ backend: 'https://me:secret@example.com/vault.git' });
    const vault = await readAnywhereVaultState();
    expect(vault).toEqual({ state: 'locked', backend: 'https://example.com/vault.git' });
  });

  it('is locked, with a warning, when the vault config is unreadable', async () => {
    mkdirSync(join(home, '.overdeck', 'vault'), { recursive: true });
    writeFileSync(join(home, '.overdeck', 'vault', 'config.json'), '{not json', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(readAnywhereVaultState()).resolves.toEqual({ state: 'locked', backend: null });
    expect(String(warn.mock.calls[0]?.[0])).toContain('[anywhere] vault state unreadable');
  });
});
