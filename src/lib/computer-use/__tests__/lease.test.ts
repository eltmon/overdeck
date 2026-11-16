import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withFileLock } from '../../vault/file-lock.js';
import { isComputerUseError } from '../errors.js';
import { claimLease, DESKTOP_LEASE_TTL_MS, holderId, holderKey, releaseLease } from '../lease.js';

describe('holderId / holderKey (PAN-5452 ac4)', () => {
  it('prefers OVERDECK_AGENT_ID, then conv:OVERDECK_CONVERSATION, then operator', () => {
    expect(holderId({ OVERDECK_AGENT_ID: 'x', OVERDECK_CONVERSATION: 'y' })).toBe('x');
    expect(holderId({ OVERDECK_CONVERSATION: 'y' })).toBe('conv:y');
    expect(holderId({})).toBe('operator');
  });

  it('sanitizes characters outside [A-Za-z0-9._-]', () => {
    expect(holderKey('conv:y/z')).toBe('conv_y_z');
    expect(holderKey('a.b-c_1')).toBe('a.b-c_1');
  });
});

describe('claimLease / releaseLease (PAN-5452 ac1-3)', () => {
  let root: string;
  let path: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    root = await mkdtemp(join(tmpdir(), 'pan-computer-lease-'));
    path = join(root, 'lease.json');
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  const deps = () => ({ leasePath: () => path });

  it('writes a fresh lease, and a renewal by the same holder extends expiresAt (ac1)', async () => {
    const start = Date.now();
    await claimLease(start, { holder: 'a', ...deps() });
    const first = JSON.parse(await readFile(path, 'utf-8'));
    expect(first.holder).toBe('a');
    expect(new Date(first.expiresAt).getTime()).toBe(start + DESKTOP_LEASE_TTL_MS);

    vi.setSystemTime(start + 1_000);
    await claimLease(Date.now(), { holder: 'a', ...deps() });
    const second = JSON.parse(await readFile(path, 'utf-8'));
    expect(new Date(second.expiresAt).getTime()).toBe(start + 1_000 + DESKTOP_LEASE_TTL_MS);
  });

  it('refuses a second holder while unexpired, then succeeds once the clock passes expiry (ac2)', async () => {
    const start = Date.now();
    await claimLease(start, { holder: 'a', ...deps() });

    const error = await claimLease(start + 1_000, { holder: 'b', ...deps() }).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('desktop_busy');
    expect(error.message).toContain('a');
    expect(error.message).toMatch(/\(\d+s\)/);

    await expect(claimLease(start + DESKTOP_LEASE_TTL_MS + 1, { holder: 'b', ...deps() })).resolves.toBeUndefined();
  });

  it('refuses a release by a non-owner without force, and force always deletes it (ac3)', async () => {
    const start = Date.now();
    await claimLease(start, { holder: 'a', ...deps() });

    const error = await releaseLease({ holder: 'b', ...deps() }).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('desktop_busy');

    await releaseLease({ holder: 'b', force: true, ...deps() });
    await expect(readFile(path, 'utf-8')).rejects.toThrow();
  });

  it('releasing by the owner deletes the lease', async () => {
    const start = Date.now();
    await claimLease(start, { holder: 'a', ...deps() });
    await releaseLease({ holder: 'a', ...deps() });
    await expect(readFile(path, 'utf-8')).rejects.toThrow();
  });

  it('releasing with no lease file is a no-op', async () => {
    await expect(releaseLease({ holder: 'a', ...deps() })).resolves.toBeUndefined();
  });

  it('treats a corrupt (empty) lease.json as no valid lease, so claimLease still succeeds', async () => {
    await writeFile(path, '');
    await expect(claimLease(Date.now(), { holder: 'a', ...deps() })).resolves.toBeUndefined();
    const written = JSON.parse(await readFile(path, 'utf-8'));
    expect(written.holder).toBe('a');
  });

  it('release --force removes a corrupt lease.json without reading it first', async () => {
    await writeFile(path, '{not json');
    await expect(releaseLease({ holder: 'a', force: true, ...deps() })).resolves.toBeUndefined();
    await expect(readFile(path, 'utf-8')).rejects.toThrow();
  });

  it('a non-forced release against a corrupt lease.json is a no-op, not a throw', async () => {
    await writeFile(path, '{not json');
    await expect(releaseLease({ holder: 'a', ...deps() })).resolves.toBeUndefined();
  });
});

describe('vault file-lock label (PAN-5452 ac5)', () => {
  it('keeps the default vault message when no label is given', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pan-vault-lock-'));
    const lockFilePath = join(root, 'x.lock');
    try {
      await withFileLock(lockFilePath, async () => {
        await expect(withFileLock(lockFilePath, async () => {}, { maxAttempts: 1, retryMs: 1 })).rejects.toThrow(
          'another pan vault process may be stuck',
        );
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the given label (pan computer)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pan-computer-lock-'));
    const lockFilePath = join(root, 'x.lock');
    try {
      await withFileLock(lockFilePath, async () => {
        await expect(
          withFileLock(lockFilePath, async () => {}, { maxAttempts: 1, retryMs: 1, label: 'pan computer' }),
        ).rejects.toThrow('another pan computer process may be stuck');
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
