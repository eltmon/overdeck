import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logoutCommand } from '../../../../src/cli/commands/account/logout.js';
import { readAccount, writeAccount, type AccountRecord } from '../../../../src/lib/account/store.js';
import { captureIo, runCli } from '../vault/helpers.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;
let testHome: string;
let vaultKeyPath: string;
let environmentIdPath: string;

function sampleRecord(): AccountRecord {
  return {
    v: 1,
    baseUrl: 'https://account.test',
    accessToken: `odd_${'a'.repeat(64)}`,
    deviceId: 'device-1',
    label: 'Linux device',
    githubLogin: 'octocat',
    githubId: 1,
    signedInAt: '2026-11-01T00:00:00.000Z',
  };
}

describe('logoutCommand (PAN-4330 W-6)', () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'overdeck-account-logout-'));
    process.env.OVERDECK_HOME = testHome;

    const vaultDir = join(testHome, 'vault');
    mkdirSync(vaultDir, { recursive: true });
    vaultKeyPath = join(vaultDir, 'key');
    writeFileSync(vaultKeyPath, 'not-a-real-key');

    environmentIdPath = join(testHome, 'environment-id.json');
    writeFileSync(environmentIdPath, JSON.stringify({ v: 1, environmentId: 'e'.repeat(8), label: 'host', createdAt: '2026-11-01T00:00:00.000Z' }));
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
  });

  it('deletes account.json, prints "Signed out." and exits 0 on 204, 401 or 404 (ac1)', async () => {
    for (const status of [204, 401, 404] as const) {
      await writeAccount(sampleRecord());
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
      const io = captureIo();
      const exitCode = await runCli(() => logoutCommand({}, io, { fetch: fetchMock }));
      expect(exitCode).toBe(0);
      expect(io.stdout).toContain("Signed out. This machine's device token was revoked.");
      await expect(readAccount()).resolves.toBeNull();
    }
  });

  it('deletes account.json, warns on stderr and exits 1 when fetch throws (ac2)', async () => {
    await writeAccount(sampleRecord());
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    const io = captureIo();
    const exitCode = await runCli(() => logoutCommand({}, io, { fetch: fetchMock }));
    expect(exitCode).toBe(1);
    expect(io.stderr.some((line) => line.includes('Signed out locally, but could not revoke') && line.includes('offline'))).toBe(true);
    await expect(readAccount()).resolves.toBeNull();
  });

  it('leaves vault/key and environment-id.json byte-identical after logout (ac3)', async () => {
    await writeAccount(sampleRecord());
    const beforeKey = readFileSync(vaultKeyPath);
    const beforeEnv = readFileSync(environmentIdPath);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await runCli(() => logoutCommand({}, captureIo(), { fetch: fetchMock }));

    expect(readFileSync(vaultKeyPath)).toEqual(beforeKey);
    expect(readFileSync(environmentIdPath)).toEqual(beforeEnv);
  });

  it('prints "Not signed in." and makes zero fetch calls when no account.json exists (ac3)', async () => {
    const fetchMock = vi.fn();
    const io = captureIo();
    const exitCode = await runCli(() => logoutCommand({}, io, { fetch: fetchMock }));
    expect(exitCode).toBe(0);
    expect(io.stdout).toContain('Not signed in.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
