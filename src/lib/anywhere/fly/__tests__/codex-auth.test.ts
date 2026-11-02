/**
 * PAN-4296 WI-3: the Codex sign-in core — snapshot parsing, the D-3
 * newest-refresh-wins decision, the VM read/push commands, the atomic home
 * write, and home's Codex readiness.
 */
import { lstat, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FlyApiError } from '../../../remote/fly-api.js';
import {
  type CodexAuthSnapshot,
  decideCodexAuthSync,
  type FlyExec,
  parseCodexAuthSnapshot,
  pushVmCodexAuth,
  readHomeCodexState,
  readVmCodexAuth,
  writeHomeCodexAuth,
} from '../codex-auth.js';

function jwt(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(payload)}.sig`;
}

const FUTURE = Math.floor(Date.now() / 1000) + 10 * 24 * 3600;
const PAST = Math.floor(Date.now() / 1000) - 3600;

function chatgpt(overrides: { access?: string; id?: string; refresh?: string; account?: string; lastRefresh?: string } = {}): string {
  return JSON.stringify({
    OPENAI_API_KEY: null,
    tokens: {
      access_token: overrides.access ?? jwt({ exp: FUTURE }),
      id_token: overrides.id ?? jwt({ email: 'dev@example.com' }),
      refresh_token: overrides.refresh ?? 'rt-1',
      account_id: overrides.account ?? 'acct-1',
    },
    last_refresh: overrides.lastRefresh ?? '2026-11-01T10:00:00.000Z',
  });
}

const snap = (raw: string): CodexAuthSnapshot => parseCodexAuthSnapshot(raw);

describe('parseCodexAuthSnapshot', () => {
  it('reads ChatGPT sign-in, API-key mode and unknown content', () => {
    const home = snap(chatgpt());
    expect(home).toMatchObject({ mode: 'chatgpt', accountId: 'acct-1', complete: true, lastRefreshMs: Date.parse('2026-11-01T10:00:00.000Z') });
    expect(snap(JSON.stringify({ tokens: { access_token: 'a' } }))).toMatchObject({ mode: 'chatgpt', complete: false, lastRefreshMs: null });
    expect(snap(JSON.stringify({ OPENAI_API_KEY: 'sk-1' }))).toMatchObject({ mode: 'api-key', key: 'sk-1', complete: false });
    expect(snap('{not json')).toMatchObject({ mode: 'unknown', key: null });
    expect(snap(JSON.stringify({}))).toMatchObject({ mode: 'unknown', key: null });
  });
});

describe('decideCodexAuthSync (D-3)', () => {
  const home = snap(chatgpt());

  it('rule 1: a missing or unknown home sends nothing', () => {
    expect(decideCodexAuthSync(null, home)).toBe('none');
    expect(decideCodexAuthSync(snap('{bad'), home)).toBe('none');
  });

  it('rule 2: a missing or unknown VM copy is pushed', () => {
    expect(decideCodexAuthSync(home, null)).toBe('push');
    expect(decideCodexAuthSync(home, snap('{bad'))).toBe('push');
  });

  it('rule 3: the same sign-in is left alone, whatever its whitespace', () => {
    expect(decideCodexAuthSync(home, snap(chatgpt()))).toBe('none');
    expect(decideCodexAuthSync(home, snap(JSON.stringify(JSON.parse(chatgpt()), null, 2)))).toBe('none');
    const apiKey = snap(JSON.stringify({ OPENAI_API_KEY: 'sk-1' }));
    expect(decideCodexAuthSync(apiKey, snap(JSON.stringify({ OPENAI_API_KEY: 'sk-1' }, null, 4)))).toBe('none');
  });

  it('rule 4: a complete, same-account VM copy with a strictly newer refresh is pulled', () => {
    expect(decideCodexAuthSync(home, snap(chatgpt({ refresh: 'rt-2', lastRefresh: '2026-11-02T10:00:00.000Z' })))).toBe('pull');
  });

  it('rule 5: everything else is pushed', () => {
    // Same last_refresh, different refresh token.
    expect(decideCodexAuthSync(home, snap(chatgpt({ refresh: 'rt-2' })))).toBe('push');
    // Different account, newer VM.
    expect(decideCodexAuthSync(home, snap(chatgpt({ account: 'acct-2', lastRefresh: '2026-11-02T10:00:00.000Z' })))).toBe('push');
    // Incomplete VM copy, newer refresh.
    expect(decideCodexAuthSync(home, snap(chatgpt({ refresh: '', lastRefresh: '2026-11-02T10:00:00.000Z' })))).toBe('push');
    // Older VM copy.
    expect(decideCodexAuthSync(home, snap(chatgpt({ refresh: 'rt-0', lastRefresh: '2026-10-30T10:00:00.000Z' })))).toBe('push');
    // A null last_refresh never pulls.
    const noRefresh = snap(JSON.stringify({ tokens: { access_token: 'a', id_token: 'i', refresh_token: 'r', account_id: 'acct-1' } }));
    expect(decideCodexAuthSync(noRefresh, snap(chatgpt({ lastRefresh: '2026-11-02T10:00:00.000Z' })))).toBe('push');
  });

  it('never pulls into an API-key home', () => {
    const apiKey = snap(JSON.stringify({ OPENAI_API_KEY: 'sk-1' }));
    expect(decideCodexAuthSync(apiKey, snap(chatgpt({ lastRefresh: '2030-01-01T00:00:00.000Z' })))).toBe('push');
  });
});

describe('readVmCodexAuth (D-8)', () => {
  it('quotes the path and reports present, missing and indeterminate', async () => {
    const exec = vi.fn<FlyExec>(async () => ({ stdout: chatgpt(), stderr: '', exit_code: 0 }));
    await expect(readVmCodexAuth(exec, '/.codex/auth.json')).resolves.toEqual({ state: 'present', raw: chatgpt() });
    expect(exec.mock.calls[0]![0]).toBe("if [ -f '/.codex/auth.json' ]; then cat '/.codex/auth.json'; else printf __MISSING__; fi");

    exec.mockResolvedValueOnce({ stdout: '__MISSING__', stderr: '', exit_code: 0 });
    await expect(readVmCodexAuth(exec, '/.codex/auth.json')).resolves.toEqual({ state: 'missing' });

    exec.mockResolvedValueOnce({ stdout: '', stderr: 'boom', exit_code: 1 });
    await expect(readVmCodexAuth(exec, '/.codex/auth.json')).resolves.toEqual({ state: 'indeterminate' });

    exec.mockRejectedValueOnce(new Error('429 Too Many Requests'));
    await expect(readVmCodexAuth(exec, '/.codex/auth.json')).resolves.toEqual({ state: 'indeterminate' });
  });

  it('returns tokenRejected for a 403 and plain indeterminate for a network error (PAN-4748)', async () => {
    const exec = vi.fn<FlyExec>();
    const authError = new FlyApiError('Fly API error 403', 403, '{"error":"unauthorized"}');
    exec.mockRejectedValueOnce(authError);
    await expect(readVmCodexAuth(exec, '/.codex/auth.json')).resolves.toEqual({ state: 'indeterminate', tokenRejected: authError });

    exec.mockRejectedValueOnce(new Error('429 Too Many Requests'));
    await expect(readVmCodexAuth(exec, '/.codex/auth.json')).resolves.toEqual({ state: 'indeterminate' });
  });
});

describe('pushVmCodexAuth (D-7)', () => {
  it('writes through base64, chmod 600 and a rename', async () => {
    const exec = vi.fn<FlyExec>(async () => ({ stdout: '', stderr: '', exit_code: 0 }));
    const raw = chatgpt();
    await pushVmCodexAuth(exec, '/.codex/auth.json', raw);
    const [command, timeout] = exec.mock.calls[0]!;
    expect(command).toContain(`printf %s '${Buffer.from(raw).toString('base64')}' | base64 -d > '/.codex/auth.json.tmp'`);
    expect(command).toContain("chmod 600 '/.codex/auth.json.tmp'");
    expect(command).toContain("mv -f '/.codex/auth.json.tmp' '/.codex/auth.json'");
    expect(command.startsWith("mkdir -p '/.codex' && ")).toBe(true);
    expect(timeout).toBe(30);
  });

  it('names only the path and exit code when the write fails', async () => {
    const raw = chatgpt();
    const encoded = Buffer.from(raw).toString('base64');
    const exec = vi.fn<FlyExec>(async () => ({ stdout: encoded, stderr: raw, exit_code: 2 }));
    const error = await pushVmCodexAuth(exec, '/.codex/auth.json', raw).catch((caught: unknown) => caught as Error);
    expect(error.message).toBe('Could not write /.codex/auth.json on the Fly machine (exit 2)');
    expect(error.message).not.toContain(encoded.slice(0, 20));

    exec.mockRejectedValueOnce(new Error(`exec failed: ${encoded}`));
    const thrown = await pushVmCodexAuth(exec, '/.codex/auth.json', raw).catch((caught: unknown) => caught as Error);
    expect(thrown.message).toContain('Could not write /.codex/auth.json on the Fly machine');
    expect(thrown.message).not.toContain(encoded.slice(0, 20));
  });

  it('refuses a file too large for one exec without sending it', async () => {
    const exec = vi.fn<FlyExec>();
    await expect(pushVmCodexAuth(exec, '/.codex/auth.json', 'x'.repeat(10_000))).rejects.toThrow('over the 12000-character exec limit');
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('writeHomeCodexAuth', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pan-4296-codex-auth-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a new file with mode 0600', async () => {
    const path = join(dir, 'auth.json');
    await writeHomeCodexAuth('{"a":1}', { authPath: path });
    expect(await readFile(path, 'utf8')).toBe('{"a":1}');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('writes through a symlinked auth.json and keeps the link', async () => {
    const target = join(dir, 'real-auth.json');
    const link = join(dir, 'auth.json');
    await writeFile(target, '{"old":1}', { mode: 0o644 });
    await symlink(target, link);
    await writeHomeCodexAuth('{"new":1}', { authPath: link });
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe(target);
    expect(await readFile(target, 'utf8')).toBe('{"new":1}');
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });
});

describe('readHomeCodexState (D-2)', () => {
  const valid = chatgpt();

  it('returns binary, version and the sign-in when all three are present', async () => {
    await expect(readHomeCodexState({ resolveBinary: async () => '/usr/bin/codex', readVersion: async () => '0.166.0', readAuth: async () => valid }))
      .resolves.toEqual({ binary: '/usr/bin/codex', version: '0.166.0', authRaw: valid });
  });

  it('returns null without a binary, a version, or a valid sign-in', async () => {
    const readVersion = vi.fn(async () => '0.166.0');
    await expect(readHomeCodexState({ resolveBinary: async () => null, readVersion, readAuth: async () => valid })).resolves.toBeNull();
    expect(readVersion).not.toHaveBeenCalled();
    await expect(readHomeCodexState({ resolveBinary: async () => '/usr/bin/codex', readVersion: async () => undefined, readAuth: async () => valid })).resolves.toBeNull();
    await expect(readHomeCodexState({ resolveBinary: async () => '/usr/bin/codex', readVersion, readAuth: async () => null })).resolves.toBeNull();
    const expired = JSON.stringify({ tokens: { access_token: jwt({ exp: PAST }), id_token: jwt({}) }, last_refresh: '2026-10-01T00:00:00.000Z' });
    await expect(readHomeCodexState({ resolveBinary: async () => '/usr/bin/codex', readVersion, readAuth: async () => expired })).resolves.toBeNull();
  });
});
