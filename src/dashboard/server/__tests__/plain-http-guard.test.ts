/**
 * PAN-4645 WI-16: the "Use HTTPS" guard. A non-loopback plain-HTTP browser
 * asking for a navigation path gets 403 HTML; loopback, forwarded-HTTPS,
 * channel and asset requests pass through.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect, Option } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { invalidateRemoteAccessConfig } from '../../../lib/remote-access/config.js';
import type { ChannelMarker } from '../channel-peer.js';
import { isNavigationPath, isRemotePlainHttpBrowser, plainHttpNavigationGuard, useHttpsPage } from '../plain-http-guard.js';

const LINK: ChannelMarker = { mode: 'link', remoteKeyHex: 'ab'.repeat(32), pairingId: null };
const originalHome = process.env.OVERDECK_HOME;
let home: string;

function request(path: string, peer: string | null, headers: Record<string, string> = {}) {
  return HttpServerRequest.fromWeb(new Request(`http://dashboard.test${path}`, { headers }))
    .modify({ remoteAddress: peer ? Option.some(peer) : Option.none() });
}

async function bodyOf(response: HttpServerResponse.HttpServerResponse): Promise<string> {
  return HttpServerResponse.toWeb(response).text();
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-4645-use-https-'));
  process.env.OVERDECK_HOME = home;
  invalidateRemoteAccessConfig();
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.OVERDECK_HOME;
  else process.env.OVERDECK_HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe('Use HTTPS guard (PAN-4645 WI-16)', () => {
  it('ac1: a non-loopback plain-HTTP GET / is refused with 403 HTML containing "Use HTTPS"', async () => {
    const response = plainHttpNavigationGuard(request('/', '192.0.2.44'), '/');
    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
    expect(response!.headers['content-type']).toContain('text/html');
    const html = await bodyOf(response!);
    expect(html).toContain('Use HTTPS');
    expect(html).toContain('http://localhost:3011');
    expect(html).toContain('https://overdeck.ai/configuration/remote-access');
    expect(await bodyOf(useHttpsPage())).toBe(html);

    // The SPA fallback paths are navigation paths too; assets are not.
    expect(plainHttpNavigationGuard(request('/conv/42', '192.0.2.44'), '/conv/42')?.status).toBe(403);
    expect(plainHttpNavigationGuard(request('/assets/app-1234.js', '192.0.2.44'), '/assets/app-1234.js')).toBeNull();
    expect(plainHttpNavigationGuard(request('/favicon.ico', '192.0.2.44'), '/favicon.ico')).toBeNull();
    expect(isNavigationPath('/')).toBe(true);
    expect(isNavigationPath('/settings/anywhere')).toBe(true);
    expect(isNavigationPath('/index.html')).toBe(false);
  });

  it('ac2: a loopback peer, with or without X-Forwarded-Proto https, is served normally', () => {
    expect(plainHttpNavigationGuard(request('/', '127.0.0.1'), '/')).toBeNull();
    expect(plainHttpNavigationGuard(request('/', '::1'), '/')).toBeNull();
    expect(plainHttpNavigationGuard(request('/', '127.0.0.1', { 'x-forwarded-proto': 'https' }), '/')).toBeNull();
    expect(plainHttpNavigationGuard(request('/', '127.0.0.1', { 'x-forwarded-for': '203.0.113.9' }), '/')).toBeNull();
  });

  it('a remote browser on HTTPS (TLS or forwarded) and a channel request pass; an unknown peer is remote', () => {
    // The dashboard itself speaks plain HTTP; HTTPS arrives through a local proxy's forwarded proto.
    expect(isRemotePlainHttpBrowser(request('/', '192.0.2.44', { 'x-forwarded-proto': 'https' }))).toBe(false);
    expect(isRemotePlainHttpBrowser(request('/', '192.0.2.44', { 'x-forwarded-proto': 'https, http' }))).toBe(false);
    expect(isRemotePlainHttpBrowser(request('/', '192.0.2.44'), LINK)).toBe(false);
    expect(isRemotePlainHttpBrowser(request('/', '192.0.2.44'))).toBe(true);
    expect(isRemotePlainHttpBrowser(request('/', null))).toBe(true);
    expect(isRemotePlainHttpBrowser(request('/', '192.0.2.44', { 'x-forwarded-proto': 'http' }))).toBe(true);
  });
});
