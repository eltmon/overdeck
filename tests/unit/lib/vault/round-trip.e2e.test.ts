import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureEnvironmentIdentity } from '../../../../src/lib/environment-identity.js';
import { adoptRecord } from '../../../../src/lib/vault/adopt.js';
import { VAULT_CONFIG_DEFAULTS, type VaultConfig } from '../../../../src/lib/vault/config.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import { readLocalIndex } from '../../../../src/lib/vault/local-index.js';
import { roundTripStates } from '../../../../src/lib/vault/round-trip.js';
import { settle } from '../../../../src/lib/vault/settle.js';
import { DirVaultStore } from '../../../../src/lib/vault/store/dir.js';
import { syncOnce } from '../../../../src/lib/vault/sync.js';

const keys = deriveSubkeys(createVaultKey());
const SESSION = '55555555-5555-4555-8555-555555555555';

function user(text: string, cwd: string): string {
  return JSON.stringify({ type: 'user', sessionId: SESSION, cwd, message: { role: 'user', content: text } });
}

describe('vault round-trip (two machines, engine level)', () => {
  let root: string;
  let homeA: string;
  let homeB: string;
  let cwd: string;
  let nativePath: string;
  let store: DirVaultStore;
  let config: VaultConfig;
  let originalHome: string | undefined;

  const useHome = (home: string) => { process.env.OVERDECK_HOME = home; };

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-round-trip-'));
    homeA = join(root, 'machine-a', '.overdeck');
    homeB = join(root, 'machine-b', '.overdeck');
    cwd = join(root, 'proj');
    mkdirSync(cwd, { recursive: true });
    originalHome = process.env.OVERDECK_HOME;
    nativePath = join(root, 'a-session.jsonl');
    useHome(homeA);
    writeFileSync(nativePath, `${user('first', cwd)}\n`);
    store = await DirVaultStore.open(join(root, 'backend'));
    config = { ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, backend: 'dir' };
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trip-two-machine.ac1/ac2: continued-elsewhere then forked-locally, origin bytes preserved', async () => {
    const saved = await settle({ nativePath, harness: 'claude-code', store, keys, config });
    if (saved.verdict !== 'append') throw new Error(`expected append, got ${saved.verdict}`);
    const vaultId = saved.vaultId;
    await syncOnce({ store, keys, config });

    useHome(homeB);
    const b = await ensureEnvironmentIdentity();
    await syncOnce({ store, keys, config });
    const adopted = await adoptRecord({ vaultId, store, keys, targetCwd: cwd, projectsRoot: join(root, 'projects-b') });
    expect(adopted.adopted).toBe(true);

    useHome(homeA);
    const beforeBytes = readFileSync(nativePath);
    await syncOnce({ store, keys, config });
    const afterBytes = readFileSync(nativePath);
    expect(Buffer.compare(beforeBytes, afterBytes)).toBe(0);

    const statesAfterAdopt = roundTripStates(await readLocalIndex());
    expect(statesAfterAdopt.get(nativePath)).toEqual({ kind: 'continued-elsewhere', vaultId, ownerLabel: b.label });

    appendFileSync(nativePath, `${user('typed on A later', cwd)}\n`);
    const later = await syncOnce({ store, keys, config });
    expect(later.settled).toHaveLength(1);
    const result = later.settled[0]!.result;
    expect(result).toMatchObject({ verdict: 'append', forkedFrom: { vaultId, version: 1 } });
    if (result.verdict !== 'append') throw new Error(`expected append, got ${result.verdict}`);
    const forkId = result.vaultId;

    const statesAfterFork = roundTripStates(await readLocalIndex());
    expect(statesAfterFork.get(nativePath)).toEqual({
      kind: 'forked-locally',
      forkVaultId: forkId,
      parentVaultId: vaultId,
      parentOwnerLabel: b.label,
    });
  });
});
