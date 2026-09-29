import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readVaultConfig } from '../../../../src/lib/vault/config.js';
import { createVaultKey, deriveSubkeys } from '../../../../src/lib/vault/identity.js';
import {
  VaultAuthenticationError,
  WIP_PART_BYTES,
  chunkIdFor,
  decodeWipParts,
  encodeWipParts,
  wipPartIdFor,
} from '../../../../src/lib/vault/format.js';

const keys = deriveSubkeys(createVaultKey());

describe('WIP part encoding', () => {
  it('round-trips a 20 MiB bundle through 3 parts', async () => {
    const bundle = randomBytes(20 * 1024 * 1024);
    const parts = await encodeWipParts(bundle, keys);
    expect(parts).toHaveLength(3);
    expect(WIP_PART_BYTES).toBe(8 * 1024 * 1024);
    const decoded = await decodeWipParts(parts, keys);
    expect(decoded.equals(bundle)).toBe(true);
  });

  it('never stores the plaintext bytes', async () => {
    const bundle = Buffer.from('# v2 git bundle\nsecret-looking content that must not appear\n', 'utf8');
    const [part] = await encodeWipParts(bundle, keys);
    expect(Buffer.from(part!.bytes).includes(Buffer.from('# v2 git bundle'))).toBe(false);
  });

  it('rejects an empty bundle', async () => {
    await expect(encodeWipParts(new Uint8Array(0), keys)).rejects.toThrow('empty WIP bundle');
  });

  it('gives a part a different id than a transcript chunk of the same bytes', () => {
    const bytes = randomBytes(1024);
    expect(wipPartIdFor(bytes, keys.K_id)).not.toBe(chunkIdFor(bytes, keys.K_id));
    expect(wipPartIdFor(bytes, keys.K_id)).toHaveLength(40);
  });

  it('rejects a part with one flipped byte', async () => {
    const parts = await encodeWipParts(randomBytes(4096), keys);
    const tampered = Buffer.from(parts[0]!.bytes);
    tampered[tampered.length >> 1] ^= 0x01;
    await expect(decodeWipParts([{ id: parts[0]!.id, bytes: tampered }], keys)).rejects.toBeInstanceOf(
      VaultAuthenticationError,
    );
  });

  it('rejects two stored parts swapped in order', async () => {
    const parts = await encodeWipParts(randomBytes(WIP_PART_BYTES + 4096), keys);
    expect(parts).toHaveLength(2);
    const swapped = [
      { id: parts[0]!.id, bytes: parts[1]!.bytes },
      { id: parts[1]!.id, bytes: parts[0]!.bytes },
    ];
    await expect(decodeWipParts(swapped, keys)).rejects.toBeInstanceOf(VaultAuthenticationError);
  });

  it('rejects a part decoded with another vault key', async () => {
    const parts = await encodeWipParts(randomBytes(4096), keys);
    const otherKeys = deriveSubkeys(createVaultKey());
    await expect(decodeWipParts(parts, otherKeys)).rejects.toBeInstanceOf(VaultAuthenticationError);
  });
});

describe('wipMaxBytes config', () => {
  let root: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-vault-wip-config-'));
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = join(root, '.overdeck');
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('defaults to 50 MiB when no config file exists', async () => {
    expect((await readVaultConfig()).wipMaxBytes).toBe(52428800);
  });
});
