/**
 * PAN-3762 W10.1: dashboard.require_token_mint is read from the raw
 * config.yaml, defaults to false, treats anything but `true` as false, and is
 * cached for the process lifetime.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { invalidateRemoteAccessConfig, readRemoteAccessConfig } from '../../../../src/lib/remote-access/config.js';

const originalHome = process.env.OVERDECK_HOME;
let home: string;

async function writeConfig(body: string): Promise<void> {
  await writeFile(join(home, 'config.yaml'), body, 'utf8');
  invalidateRemoteAccessConfig();
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-3762-remote-config-'));
  process.env.OVERDECK_HOME = home;
  invalidateRemoteAccessConfig();
});

afterEach(async () => {
  invalidateRemoteAccessConfig();
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('readRemoteAccessConfig (PAN-3762)', () => {
  it('defaults to false when config.yaml is missing', () => {
    expect(readRemoteAccessConfig()).toEqual({ requireTokenMint: false });
  });

  it('reads dashboard.require_token_mint: true', async () => {
    await writeConfig('dashboard:\n  require_token_mint: true\n');
    expect(readRemoteAccessConfig()).toEqual({ requireTokenMint: true });
  });

  it('treats a non-boolean or invalid YAML as false', async () => {
    await writeConfig('dashboard:\n  require_token_mint: "yes"\n');
    expect(readRemoteAccessConfig().requireTokenMint).toBe(false);
    await writeConfig('dashboard: [unclosed\n');
    expect(readRemoteAccessConfig().requireTokenMint).toBe(false);
  });

  it('caches the value until reset', async () => {
    await writeConfig('dashboard:\n  require_token_mint: true\n');
    expect(readRemoteAccessConfig().requireTokenMint).toBe(true);
    await writeFile(join(home, 'config.yaml'), 'dashboard:\n  require_token_mint: false\n', 'utf8');
    expect(readRemoteAccessConfig().requireTokenMint).toBe(true);
  });
});
