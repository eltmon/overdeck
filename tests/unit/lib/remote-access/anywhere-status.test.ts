import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeAnywhereProblems, readAnywhereVaultState } from '../../../../src/lib/remote-access/anywhere-status.js';
import { createVaultKey, saveVaultKey } from '../../../../src/lib/vault/identity.js';

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

describe('readAnywhereVaultState (PAN-4445 D-9 fallback)', () => {
  let home: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env['OVERDECK_HOME'];
    home = mkdtempSync(join(tmpdir(), 'anywhere-vault-test-'));
    process.env['OVERDECK_HOME'] = home;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env['OVERDECK_HOME'];
    else process.env['OVERDECK_HOME'] = savedHome;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeVaultConfig(config: unknown): void {
    mkdirSync(join(home, 'vault'), { recursive: true });
    writeFileSync(join(home, 'vault', 'config.json'), typeof config === 'string' ? config : JSON.stringify(config), 'utf8');
  }

  it('is off with no vault config', async () => {
    await expect(readAnywhereVaultState()).resolves.toEqual({ state: 'off', backend: null });
  });

  it('is locked with a backend and no key', async () => {
    writeVaultConfig({ backend: 'git@example.com:me/vault.git' });
    await expect(readAnywhereVaultState()).resolves.toEqual({ state: 'locked', backend: 'git@example.com:me/vault.git' });
  });

  it('is ready with a backend and a key', async () => {
    writeVaultConfig({ backend: 'git@example.com:me/vault.git' });
    await saveVaultKey(createVaultKey());
    await expect(readAnywhereVaultState()).resolves.toEqual({ state: 'ready', backend: 'git@example.com:me/vault.git' });
  });

  it('is rotation-pending while key.next exists', async () => {
    writeVaultConfig({ backend: 'git@example.com:me/vault.git' });
    await saveVaultKey(createVaultKey());
    writeFileSync(join(home, 'vault', 'key.next'), createVaultKey());
    await expect(readAnywhereVaultState()).resolves.toEqual({ state: 'rotation-pending', backend: 'git@example.com:me/vault.git' });
  });

  it('strips a user and password from the backend URL', async () => {
    writeVaultConfig({ backend: 'https://me:secret@example.com/vault.git' });
    const vault = await readAnywhereVaultState();
    expect(vault.backend).toBe('https://example.com/vault.git');
  });

  it('is locked, with a warning, when the vault config is unreadable', async () => {
    writeVaultConfig('{not json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(readAnywhereVaultState()).resolves.toEqual({ state: 'locked', backend: null });
    expect(String(warn.mock.calls[0]?.[0])).toContain('[anywhere] vault state unreadable');
  });
});
