/**
 * PAN-4645 WI-1: the machine key file is created once with mode 0600, never
 * rewritten, never replaced when corrupt, and fingerprints deterministically.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureMachineKey,
  machineKeyFingerprint,
  publicKeyHex,
  readMachineKey,
} from '../machine-key.js';

const KEY_HEX = /^[0-9a-f]{64}$/;
const FINGERPRINT = /^[0-9a-f]{4}(-[0-9a-f]{4}){4}$/;

describe('machine-key (PAN-4645)', () => {
  let root: string;
  let home: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pan-4645-machine-key-'));
    home = join(root, '.overdeck');
    originalHome = process.env.OVERDECK_HOME;
    process.env.OVERDECK_HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('creates machine-key.json once with mode 0600 and returns the same 32-byte keys on a second call', async () => {
    expect(await readMachineKey()).toBeNull();
    const first = await ensureMachineKey();
    const second = await ensureMachineKey();

    expect(first.publicKey.length).toBe(32);
    expect(first.secretKey.length).toBe(32);
    expect(second.publicKey.equals(first.publicKey)).toBe(true);
    expect(second.secretKey.equals(first.secretKey)).toBe(true);

    const path = join(home, 'machine-key.json');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(home)).toEqual(['machine-key.json']);
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    expect(stored.v).toBe(1);
    expect(stored.publicKey).toMatch(KEY_HEX);
    expect(stored.secretKey).toMatch(KEY_HEX);
    expect(stored.publicKey).toBe(publicKeyHex(first));
    expect(new Date(stored.createdAt).toISOString()).toBe(stored.createdAt);

    const read = await readMachineKey();
    expect(read?.publicKey.equals(first.publicKey)).toBe(true);
  });

  it('ac1: two concurrent ensureMachineKey() calls leave one 0600 file and agree on the public key', async () => {
    const [a, b] = await Promise.all([ensureMachineKey(), ensureMachineKey()]);
    expect(a.publicKey.length).toBe(32);
    expect(b.publicKey.equals(a.publicKey)).toBe(true);
    expect(b.secretKey.equals(a.secretKey)).toBe(true);

    expect(readdirSync(home)).toEqual(['machine-key.json']);
    const path = join(home, 'machine-key.json');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8')).publicKey).toBe(publicKeyHex(a));
  });

  it('ac2: invalid JSON makes ensureMachineKey() throw naming the path and leaves the bytes unchanged', async () => {
    mkdirSync(home, { recursive: true });
    const path = join(home, 'machine-key.json');
    writeFileSync(path, 'not json {');
    const before = readFileSync(path);

    await expect(ensureMachineKey()).rejects.toThrow(path);
    await expect(readMachineKey()).rejects.toThrow(path);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(home)).toEqual(['machine-key.json']);
  });

  it('rejects a well-formed file whose keys are not 64 lowercase hex, without replacing it', async () => {
    mkdirSync(home, { recursive: true });
    const path = join(home, 'machine-key.json');
    const bad = JSON.stringify({
      v: 1,
      publicKey: 'AB'.repeat(32),
      secretKey: 'ab'.repeat(31),
      createdAt: new Date().toISOString(),
    });
    writeFileSync(path, bad);

    await expect(ensureMachineKey()).rejects.toThrow(path);
    expect(readFileSync(path, 'utf8')).toBe(bad);
  });

  it('ac4: machineKeyFingerprint() yields five dash-separated groups of four lowercase hex for a fixed key', () => {
    const fixed = Buffer.alloc(32, 1);
    const fingerprint = machineKeyFingerprint(fixed);
    expect(fingerprint).toBe('72cd-6e84-22c4-07fb-6d09');
    expect(fingerprint).toMatch(FINGERPRINT);
    expect(machineKeyFingerprint(fixed.toString('hex'))).toBe(fingerprint);
    expect(machineKeyFingerprint(Buffer.alloc(32, 2))).not.toBe(fingerprint);
    expect(() => machineKeyFingerprint(Buffer.alloc(31, 1))).toThrow();
    expect(() => machineKeyFingerprint('zz'.repeat(32))).toThrow();
  });
});
