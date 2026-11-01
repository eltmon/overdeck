import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_DIRECTORY_URL, directorySocketUrl, parseDirectoryUrl, readDirectoryUrl } from '../directory-config.js';

const originalHome = process.env.OVERDECK_HOME;
let home = '';

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-2356-directory-url-'));
  process.env.OVERDECK_HOME = home;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('anywhere.directory_url (PAN-2356 FR-2356-1)', () => {
  it('defaults to connect.overdeck.ai without a config file or the key', async () => {
    expect(await readDirectoryUrl()).toEqual({ url: DEFAULT_DIRECTORY_URL });
    await writeFile(join(home, 'config.yaml'), 'dashboard:\n  require_token_mint: true\n');
    expect(await readDirectoryUrl()).toEqual({ url: 'https://connect.overdeck.ai' });
  });

  it('refuses http://example.com and accepts http://127.0.0.1:8787', async () => {
    await writeFile(join(home, 'config.yaml'), 'anywhere:\n  directory_url: http://example.com\n');
    expect(await readDirectoryUrl()).toEqual({ error: 'anywhere.directory_url must use https:, or http: to a loopback host' });
    await writeFile(join(home, 'config.yaml'), 'anywhere:\n  directory_url: http://127.0.0.1:8787/\n');
    expect(await readDirectoryUrl()).toEqual({ url: 'http://127.0.0.1:8787' });
  });

  it('accepts a self-hosted https directory and rejects junk', () => {
    expect(parseDirectoryUrl('https://dir.example.org/base/')).toEqual({ url: 'https://dir.example.org/base' });
    expect(parseDirectoryUrl('wss://dir.example.org')).toHaveProperty('error');
    expect(parseDirectoryUrl('not a url')).toHaveProperty('error');
    expect(parseDirectoryUrl('https://u:p@dir.example.org')).toHaveProperty('error');
    expect(parseDirectoryUrl(42)).toHaveProperty('error');
  });

  it('builds the socket URL', () => {
    expect(directorySocketUrl('https://connect.overdeck.ai')).toBe('wss://connect.overdeck.ai/v1/directory');
    expect(directorySocketUrl('http://127.0.0.1:8787')).toBe('ws://127.0.0.1:8787/v1/directory');
  });
});
