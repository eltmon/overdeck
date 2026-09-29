import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VAULT_CONFIG_DEFAULTS,
  VAULT_OFF_MESSAGE,
  isVaultEnabled,
  readVaultConfig,
  vaultConfigPath,
  vaultDir,
  writeVaultConfig,
} from '../../../../src/lib/vault/config.js';

const P1_DEFAULTS = {
  exclude: { paths: [], origins: [], sessions: [] },
  syncIntervalSec: 300,
  debounceSec: 30,
  evict: false,
  liveQuietMinutes: 30,
  maxChunkBytes: 67108864,
};

describe('vault config', () => {
  let root: string;
  let home: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-config-'));
    home = join(root, '.overdeck');
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves vaultDir under OVERDECK_HOME and exports the off message', () => {
    expect(vaultDir()).toBe(join(home, 'vault'));
    expect(vaultConfigPath()).toBe(join(home, 'vault', 'config.json'));
    expect(VAULT_OFF_MESSAGE).toBe('Session Vault is off. Run: pan vault setup <git-url>');
    expect(VAULT_CONFIG_DEFAULTS).toEqual(P1_DEFAULTS);
  });

  it('ac1: no config file yields every P-1 default and isVaultEnabled() is false', async () => {
    const config = await readVaultConfig();
    expect(config).toEqual(P1_DEFAULTS);
    expect(config.backend).toBeUndefined();
    expect(await isVaultEnabled()).toBe(false);
  });

  it('ac2: writeVaultConfig persists with mode 0600 and isVaultEnabled() becomes true', async () => {
    const written = await writeVaultConfig({ backend: 'file:///x' });
    expect(written.backend).toBe('file:///x');

    const path = vaultConfigPath();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(vaultDir())).toEqual(['config.json']);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ ...P1_DEFAULTS, backend: 'file:///x' });

    expect(await readVaultConfig()).toEqual({ ...P1_DEFAULTS, backend: 'file:///x' });
    expect(await isVaultEnabled()).toBe(true);
  });

  it('ac3: a config file missing keys falls back to the P-1 default for each', async () => {
    mkdirSync(vaultDir(), { recursive: true });
    writeFileSync(
      vaultConfigPath(),
      JSON.stringify({ backend: 'file:///y', debounceSec: 5, exclude: { paths: ['/a'] } }),
    );
    const config = await readVaultConfig();
    expect(config).toEqual({
      ...P1_DEFAULTS,
      backend: 'file:///y',
      debounceSec: 5,
      exclude: { paths: ['/a'], origins: [], sessions: [] },
    });
  });

  it('writeVaultConfig keeps existing keys that the patch does not name', async () => {
    await writeVaultConfig({ backend: 'file:///x', evict: true });
    const after = await writeVaultConfig({ syncIntervalSec: 60 });
    expect(after).toEqual({ ...P1_DEFAULTS, backend: 'file:///x', evict: true, syncIntervalSec: 60 });
    expect(readdirSync(vaultDir())).toEqual(['config.json']);
  });

  it('invalid JSON throws naming the path and is left unchanged', async () => {
    mkdirSync(vaultDir(), { recursive: true });
    writeFileSync(vaultConfigPath(), '{ not json');
    await expect(readVaultConfig()).rejects.toThrow(vaultConfigPath());
    expect(readFileSync(vaultConfigPath(), 'utf8')).toBe('{ not json');
  });
});
