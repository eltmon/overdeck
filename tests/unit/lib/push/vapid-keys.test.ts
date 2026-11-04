import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureVapidKeys,
  pushDir,
  vapidKeysPath,
  VapidKeysUnreadableError,
} from '../../../../src/lib/push/vapid-keys.js';

describe('VAPID keys (PAN-2354)', () => {
  let home: string;
  const previousHome = process.env.OVERDECK_HOME;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'overdeck-vapid-'));
    process.env.OVERDECK_HOME = home;
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  it('creates the key file with mode 0600 in a 0700 directory on first call', async () => {
    const keys = await ensureVapidKeys();
    expect(vapidKeysPath()).toBe(join(home, 'push', 'vapid.json'));
    expect((await stat(vapidKeysPath())).mode & 0o777).toBe(0o600);
    expect((await stat(pushDir())).mode & 0o777).toBe(0o700);
    expect(Buffer.from(keys.publicKey, 'base64url')).toHaveLength(65);
    expect(Buffer.from(keys.privateKey, 'base64url')).toHaveLength(32);
  });

  it('returns byte-identical keys on a second call', async () => {
    const first = await ensureVapidKeys();
    const before = await readFile(vapidKeysPath());
    const second = await ensureVapidKeys();
    expect(second).toEqual(first);
    expect(await readFile(vapidKeysPath())).toEqual(before);
  });

  it('resolves concurrent creation to the same public key', async () => {
    const [a, b] = await Promise.all([ensureVapidKeys(), ensureVapidKeys()]);
    expect(a.publicKey).toBe(b.publicKey);
    const stored = JSON.parse(await readFile(vapidKeysPath(), 'utf8')) as { publicKey: string };
    expect(stored.publicKey).toBe(a.publicKey);
  });

  it('throws on a malformed file and leaves it unchanged', async () => {
    await mkdir(pushDir(), { recursive: true });
    await writeFile(vapidKeysPath(), '{not json', { mode: 0o600 });
    await expect(ensureVapidKeys()).rejects.toBeInstanceOf(VapidKeysUnreadableError);
    expect(await readFile(vapidKeysPath(), 'utf8')).toBe('{not json');
  });
});
