import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isLoopbackBase } from '../../../../src/cli/commands/pair.js';
import { isLoopbackOrigin } from '../../../../src/lib/remote-access/loopback.js';
import {
  addSavedTrustedOrigin,
  normalizeTrustedOrigin,
  readSavedTrustedOriginsSync,
  trustedOriginsPath,
} from '../../../../src/lib/remote-access/trusted-origins.js';

describe('saved trusted origins (PAN-4445)', () => {
  let home: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    savedHome = process.env['OVERDECK_HOME'];
    home = mkdtempSync(join(tmpdir(), 'trusted-origins-test-'));
    process.env['OVERDECK_HOME'] = home;
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env['OVERDECK_HOME'];
    else process.env['OVERDECK_HOME'] = savedHome;
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function savedFile(): { version: number; origins: string[] } {
    return JSON.parse(readFileSync(join(home, 'trusted-origins.json'), 'utf8')) as { version: number; origins: string[] };
  }

  it('stores the file under OVERDECK_HOME', () => {
    expect(trustedOriginsPath()).toBe(join(home, 'trusted-origins.json'));
  });

  it('returns [] for a missing file without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readSavedTrustedOriginsSync()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns [] and warns once, naming the file, for invalid JSON', () => {
    writeFileSync(join(home, 'trusted-origins.json'), '{not json', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readSavedTrustedOriginsSync()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(join(home, 'trusted-origins.json'));
  });

  it('returns [] and warns for JSON with the wrong shape', () => {
    writeFileSync(join(home, 'trusted-origins.json'), JSON.stringify({ version: 2, origins: [] }), 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readSavedTrustedOriginsSync()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('normalizes and deduplicates saved origins on read', () => {
    writeFileSync(
      join(home, 'trusted-origins.json'),
      JSON.stringify({ version: 1, origins: ['https://a.example/x', 'https://a.example', 'ftp://b.example'] }),
      'utf8',
    );
    expect(readSavedTrustedOriginsSync()).toEqual(['https://a.example']);
  });

  it('normalizes an origin to scheme://host[:port] and rejects non-http(s)', () => {
    expect(normalizeTrustedOrigin(' https://desk.tailnet.ts.net:8443/some/path?q=1 ')).toBe('https://desk.tailnet.ts.net:8443');
    expect(normalizeTrustedOrigin('ftp://x')).toBeNull();
    expect(normalizeTrustedOrigin('not a url')).toBeNull();
  });

  it('adds a reachable origin once and reports added: false on the second call', async () => {
    await expect(addSavedTrustedOrigin('https://desk.tailnet.ts.net/some/path', [])).resolves.toEqual({
      ok: true,
      origin: 'https://desk.tailnet.ts.net',
      added: true,
    });
    expect(savedFile()).toEqual({ version: 1, origins: ['https://desk.tailnet.ts.net'] });
    const before = readFileSync(join(home, 'trusted-origins.json'), 'utf8');

    await expect(addSavedTrustedOrigin('https://desk.tailnet.ts.net', [])).resolves.toEqual({
      ok: true,
      origin: 'https://desk.tailnet.ts.net',
      added: false,
    });
    expect(readFileSync(join(home, 'trusted-origins.json'), 'utf8')).toBe(before);
    expect(readSavedTrustedOriginsSync()).toEqual(['https://desk.tailnet.ts.net']);
  });

  it('reports added: false and writes nothing when the origin is already trusted', async () => {
    await expect(addSavedTrustedOrigin('https://env.example', ['https://env.example'])).resolves.toEqual({
      ok: true,
      origin: 'https://env.example',
      added: false,
    });
    expect(existsSync(join(home, 'trusted-origins.json'))).toBe(false);
  });

  it('appends to the origins already saved', async () => {
    await addSavedTrustedOrigin('https://one.example', []);
    await addSavedTrustedOrigin('https://two.example', []);
    expect(savedFile().origins).toEqual(['https://one.example', 'https://two.example']);
  });

  it('refuses loopback and invalid origins and writes no file', async () => {
    await expect(addSavedTrustedOrigin('http://localhost:3011', [])).resolves.toEqual({ ok: false, reason: 'loopback' });
    await expect(addSavedTrustedOrigin('ftp://x', [])).resolves.toEqual({ ok: false, reason: 'invalid' });
    await expect(addSavedTrustedOrigin('not a url', [])).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(existsSync(join(home, 'trusted-origins.json'))).toBe(false);
  });

  it('refuses to overwrite an invalid file', async () => {
    writeFileSync(join(home, 'trusted-origins.json'), '{not json', 'utf8');
    await expect(addSavedTrustedOrigin('https://desk.example', [])).rejects.toThrow(join(home, 'trusted-origins.json'));
    expect(readFileSync(join(home, 'trusted-origins.json'), 'utf8')).toBe('{not json');
  });
});

describe('isLoopbackOrigin (PAN-4445 D-7)', () => {
  it('matches every loopback host form', () => {
    for (const base of ['http://localhost:3011', 'https://overdeck.localhost', 'http://127.0.0.1:9', 'http://[::1]:3011']) {
      expect(isLoopbackOrigin(base)).toBe(true);
    }
    expect(isLoopbackOrigin('https://desk.tailnet.ts.net')).toBe(false);
    expect(isLoopbackOrigin('not a url')).toBe(false);
  });

  it('is what pan pair exports as isLoopbackBase', () => {
    expect(isLoopbackBase).toBe(isLoopbackOrigin);
  });
});
