import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readGrokSignIn } from '../../../src/lib/grok-sign-in.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const homes: string[] = [];

function homeWith(authJson?: string): string {
  const home = mkdtempSync(join(tmpdir(), 'overdeck-grok-sign-in-'));
  homes.push(home);
  if (authJson !== undefined) {
    mkdirSync(join(home, '.grok'), { recursive: true });
    writeFileSync(join(home, '.grok', 'auth.json'), authJson, 'utf8');
  }
  return home;
}

afterEach(() => {
  homes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true }));
});

describe('readGrokSignIn (PAN-5078)', () => {
  it('reports missing when auth.json does not exist', async () => {
    await expect(readGrokSignIn(homeWith(), NOW)).resolves.toEqual({ signedIn: false, reason: 'missing' });
  });

  it('reports unreadable for malformed JSON', async () => {
    await expect(readGrokSignIn(homeWith('{not json'), NOW)).resolves.toEqual({ signedIn: false, reason: 'unreadable' });
  });

  it('reports no-credential when no entry carries a key', async () => {
    const auth = JSON.stringify({ 'grok.com': { key: '', expires_at: '2026-11-15T00:00:00Z' }, other: 'x' });
    await expect(readGrokSignIn(homeWith(auth), NOW)).resolves.toEqual({ signedIn: false, reason: 'no-credential' });
  });

  it('reports signed in for a key with a future expiry', async () => {
    const auth = JSON.stringify({ 'grok.com': { key: 'synthetic-key', expires_at: '2026-11-15T00:00:00Z' } });
    await expect(readGrokSignIn(homeWith(auth), NOW)).resolves.toEqual({ signedIn: true, reason: 'ok' });
  });

  it('reports signed in for an expired key that can refresh', async () => {
    const auth = JSON.stringify({ 'grok.com': { key: 'synthetic-key', expires_at: '2026-11-01T00:00:00Z', refresh_token: 'synthetic-refresh' } });
    await expect(readGrokSignIn(homeWith(auth), NOW)).resolves.toEqual({ signedIn: true, reason: 'ok' });
  });

  it('reports expired for a past expiry with no refresh token', async () => {
    const auth = JSON.stringify({ 'grok.com': { key: 'synthetic-key', expires_at: '2026-11-01T00:00:00Z' } });
    await expect(readGrokSignIn(homeWith(auth), NOW)).resolves.toEqual({ signedIn: false, reason: 'expired' });
  });

  it('never returns a token value', async () => {
    const auth = JSON.stringify({ 'grok.com': { key: 'synthetic-key', expires_at: '2026-11-15T00:00:00Z' } });
    expect(JSON.stringify(await readGrokSignIn(homeWith(auth), NOW))).not.toContain('synthetic-key');
  });
});
