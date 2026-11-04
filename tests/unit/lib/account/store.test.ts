import { readdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accountPath, readAccount, removeAccount, writeAccount, type AccountRecord } from '../../../../src/lib/account/store.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;

let testHome: string;

function sampleRecord(): AccountRecord {
  return {
    v: 1,
    baseUrl: 'https://overdeck.ai',
    accessToken: `odd_${'a'.repeat(64)}`,
    deviceId: 'device-1',
    label: 'Linux device',
    githubLogin: 'octocat',
    githubId: 1,
    signedInAt: '2026-11-01T00:00:00.000Z',
  };
}

describe('account store', () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'overdeck-account-store-'));
    process.env.OVERDECK_HOME = testHome;
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    if (originalOverdeckHome === undefined) {
      delete process.env.OVERDECK_HOME;
    } else {
      process.env.OVERDECK_HOME = originalOverdeckHome;
    }
  });

  it('writeAccount then readAccount returns an identical record, and on POSIX the file mode is 0o600 (ac1)', async () => {
    const record = sampleRecord();
    await writeAccount(record);

    expect(await readAccount()).toEqual(record);
    if (process.platform !== 'win32') {
      expect(statSync(accountPath()).mode & 0o777).toBe(0o600);
    }
  });

  it('readAccount throws naming the file and "Delete it to sign out locally" on invalid JSON (ac2)', async () => {
    writeFileSync(accountPath(), '{not json', 'utf8');
    await expect(readAccount()).rejects.toThrow(/Delete it to sign out locally/);
    await expect(readAccount()).rejects.toThrow(accountPath());
  });

  it('readAccount throws the same way when accessToken does not match odd_ + 64 hex (ac2)', async () => {
    writeFileSync(accountPath(), JSON.stringify({ ...sampleRecord(), accessToken: 'not-a-token' }), 'utf8');
    await expect(readAccount()).rejects.toThrow(/Delete it to sign out locally/);
    await expect(readAccount()).rejects.toThrow(accountPath());
  });

  it('readAccount returns null when no file exists', async () => {
    expect(await readAccount()).toBeNull();
  });

  it('leaves no leftover temp file after writeAccount, and removeAccount returns false with no file (ac3)', async () => {
    await writeAccount(sampleRecord());
    expect(readdirSync(testHome)).toEqual(['account.json']);

    expect(await removeAccount()).toBe(true);
    expect(await readAccount()).toBeNull();
    expect(await removeAccount()).toBe(false);
  });
});
