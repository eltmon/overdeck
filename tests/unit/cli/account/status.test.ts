import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { statusCommand } from '../../../../src/cli/commands/account/status.js';
import { readAccount, writeAccount, type AccountRecord } from '../../../../src/lib/account/store.js';
import { captureIo, runCli } from '../vault/helpers.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;
let testHome: string;

function sampleRecord(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    v: 1,
    baseUrl: 'https://account.test',
    accessToken: `odd_${'a'.repeat(64)}`,
    deviceId: 'device-1',
    label: 'Linux device',
    githubLogin: 'octocat',
    githubId: 1,
    signedInAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('statusCommand (PAN-4330 W-5)', () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'overdeck-account-status-'));
    process.env.OVERDECK_HOME = testHome;
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
  });

  it('prints "Not signed in." and exits 0 when no account.json exists (ac1)', async () => {
    const io = captureIo();
    const exitCode = await runCli(() => statusCommand({}, io));
    expect(exitCode).toBe(0);
    expect(io.stdout).toContain('Not signed in. Run: pan account login');

    const io2 = captureIo();
    await runCli(() => statusCommand({ json: true }, io2));
    expect(JSON.parse(io2.stdout[0]!)).toEqual({ signedIn: false });
  });

  it('prints "Signed in as octocat" and exits 0 on a 200 /v1/me, and --json omits the token (ac2)', async () => {
    await writeAccount(sampleRecord());
    const me = { userId: 'u1', githubId: 1, githubLogin: 'octocat', deviceId: 'device-1', access: { status: 'active', expiresAt: null } };
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(me), { status: 200 }));

    const io = captureIo();
    const exitCode = await runCli(() => statusCommand({}, io, { fetch: fetchMock }));
    expect(exitCode).toBe(0);
    expect(io.stdout.some((line) => line.includes('Signed in as octocat'))).toBe(true);

    const io2 = captureIo();
    await runCli(() => statusCommand({ json: true }, io2, { fetch: fetchMock }));
    const parsed = JSON.parse(io2.stdout[0]!);
    expect(parsed).toMatchObject({ signedIn: true, githubLogin: 'octocat', reachable: true });
    expect(io2.stdout[0]).not.toContain('odd_');
    expect(parsed.accessToken).toBeUndefined();
  });

  it('exits 1 with the "no longer valid" message on a 401 device_revoked, and keeps the file (ac3)', async () => {
    await writeAccount(sampleRecord());
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'device_revoked' }), { status: 401 }));

    const io = captureIo();
    const exitCode = await runCli(() => statusCommand({}, io, { fetch: fetchMock }));
    expect(exitCode).toBe(1);
    expect(io.stderr).toContain("This machine's sign-in is no longer valid (device_revoked). Run: pan account login");
    await expect(readAccount()).resolves.not.toBeNull();
  });

  it('prints the cached login with "account service unreachable" and exits 1 when fetch throws (ac4)', async () => {
    await writeAccount(sampleRecord());
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));

    const io = captureIo();
    const exitCode = await runCli(() => statusCommand({}, io, { fetch: fetchMock }));
    expect(exitCode).toBe(1);
    expect(io.stderr.some((line) => line.includes('octocat') && line.includes('account service unreachable'))).toBe(true);
  });
});
