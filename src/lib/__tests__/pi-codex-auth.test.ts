import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPiAuthPath,
  readPiCodexCredential,
  getPiCodexAuthStatus,
} from '../pi-codex-auth.js';

/**
 * The module reads ~/.pi/agent/auth.json via os.homedir(), which on POSIX
 * honors $HOME — so pointing $HOME at a temp dir fully sandboxes these tests.
 * We never exercise the refresh/login network paths here.
 */
describe('pi-codex-auth', () => {
  let home: string;
  let prevHome: string | undefined;

  function writeAuth(content: unknown): void {
    const dir = join(home, '.pi', 'agent');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'auth.json'), JSON.stringify(content), 'utf-8');
  }

  beforeEach(() => {
    prevHome = process.env['HOME'];
    home = mkdtempSync(join(tmpdir(), 'pi-auth-home-'));
    process.env['HOME'] = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('resolves the auth path under the home dir', () => {
    expect(getPiAuthPath()).toBe(join(home, '.pi', 'agent', 'auth.json'));
  });

  it('reports missing when there is no auth.json', async () => {
    expect(readPiCodexCredential()).toBeNull();
    expect(await getPiCodexAuthStatus()).toEqual({ status: 'missing' });
  });

  it('reports missing when openai-codex is absent', async () => {
    writeAuth({ 'some-other-provider': { type: 'oauth', access: 'x', refresh: 'y', expires: Date.now() + 1e9, accountId: 'a' } });
    expect(readPiCodexCredential()).toBeNull();
    expect((await getPiCodexAuthStatus()).status).toBe('missing');
  });

  it('reports ok for an unexpired token', async () => {
    const expires = Date.now() + 6 * 60 * 60 * 1000;
    writeAuth({ 'openai-codex': { type: 'oauth', access: 'a', refresh: 'r', expires, accountId: 'acct' } });
    const cred = readPiCodexCredential();
    expect(cred?.accountId).toBe('acct');
    expect(await getPiCodexAuthStatus()).toEqual({ status: 'ok', expiresAt: expires });
  });

  it('reports expired (refresh not attempted) for a past-expiry token', async () => {
    const expires = Date.now() - 60 * 60 * 1000;
    writeAuth({ 'openai-codex': { type: 'oauth', access: 'a', refresh: 'r', expires, accountId: 'acct' } });
    expect(await getPiCodexAuthStatus()).toEqual({ status: 'expired', expiresAt: expires, refreshFailed: false });
  });

  it('ignores a malformed credential', async () => {
    writeAuth({ 'openai-codex': { type: 'oauth', expires: Date.now() + 1e9 } }); // no access/refresh
    expect(readPiCodexCredential()).toBeNull();
    expect((await getPiCodexAuthStatus()).status).toBe('missing');
  });
});
