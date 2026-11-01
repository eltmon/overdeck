/**
 * PAN-4645 WI-11: the route model — URL parsing, host classification, the
 * pairing-link route, ranking, and reconciling advertised endpoints.
 */
import { describe, expect, it } from 'vitest';

import {
  classifyHost,
  isLoopbackHost,
  type LinkRoute,
  mergeAdvertised,
  parseRouteUrl,
  rankRoutes,
  routeFromPairingUrl,
} from '../routes.js';

const AT = '2026-11-01T00:00:00.000Z';
const route = (url: string, kind: LinkRoute['kind'], source: LinkRoute['source']): LinkRoute => ({ url, kind, source, addedAt: AT });

describe('route model (PAN-4645 WI-11)', () => {
  it('parses and canonicalises transport URLs', () => {
    expect(parseRouteUrl('tcp://192.168.1.20:3011')).toEqual({ transport: 'tcp', host: '192.168.1.20', port: 3011, url: 'tcp://192.168.1.20:3011' });
    expect(parseRouteUrl('wss://desk.tail1234.ts.net/ws/link')).toEqual({ transport: 'wss', host: 'desk.tail1234.ts.net', port: 443, url: 'wss://desk.tail1234.ts.net/ws/link' });
    expect(parseRouteUrl('wss://desk.example:8443')).toMatchObject({ port: 8443, url: 'wss://desk.example:8443/ws/link' });
    // PAN-4652 D-3: the fly-instance pin survives; any other query does not.
    expect(parseRouteUrl('wss://overdeck-ws.fly.dev/ws/link?fly-instance=148e21ea7e1689&x=1').url)
      .toBe('wss://overdeck-ws.fly.dev/ws/link?fly-instance=148e21ea7e1689');
    expect(parseRouteUrl('wss://desk.example/ws/link?x=1').url).toBe('wss://desk.example/ws/link');
    expect(parseRouteUrl('tcp://[fd7a:115c:a1e0::1]:3011')).toMatchObject({ host: 'fd7a:115c:a1e0::1', url: 'tcp://[fd7a:115c:a1e0::1]:3011' });
    expect(() => parseRouteUrl('tcp://host')).toThrow(/needs a port/);
    expect(() => parseRouteUrl('http://host:3011')).toThrow(/Unsupported route scheme/);
    expect(() => parseRouteUrl('nonsense')).toThrow(/Not a route URL/);
  });

  it('classifies hosts: tailnet, lan, public', () => {
    expect(classifyHost('100.101.1.2')).toBe('tailnet');
    expect(classifyHost('100.127.255.1')).toBe('tailnet');
    expect(classifyHost('desk.tail1234.ts.net')).toBe('tailnet');
    expect(classifyHost('fd7a:115c:a1e0:ab12::1')).toBe('tailnet');
    expect(classifyHost('192.168.1.20')).toBe('lan');
    expect(classifyHost('10.0.0.5')).toBe('lan');
    expect(classifyHost('172.31.9.9')).toBe('lan');
    expect(classifyHost('desk.local')).toBe('lan');
    expect(classifyHost('127.0.0.1')).toBe('lan');
    expect(classifyHost('100.63.0.1')).toBe('public');
    expect(classifyHost('172.32.0.1')).toBe('public');
    expect(classifyHost('203.0.113.7')).toBe('public');
    expect(classifyHost('overdeck.example.com')).toBe('public');
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('overdeck.localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('192.168.1.1')).toBe(false);
  });

  it('ac5: turns a pairing link into a route and refuses loopback unless allowed, which yields lan', () => {
    expect(routeFromPairingUrl('http://192.168.1.20:3011/#pair=odp_abc123')).toEqual({
      url: 'tcp://192.168.1.20:3011', kind: 'lan', source: 'pairing', pairingCode: 'odp_abc123',
    });
    expect(routeFromPairingUrl('https://desk.tail1234.ts.net/conv/7#pair=odp_xyz')).toEqual({
      url: 'wss://desk.tail1234.ts.net/ws/link', kind: 'tailnet', source: 'pairing', pairingCode: 'odp_xyz',
    });
    expect(routeFromPairingUrl('http://100.101.1.2:3011/#pair=odp_t')).toMatchObject({ kind: 'tailnet', url: 'tcp://100.101.1.2:3011' });
    expect(routeFromPairingUrl('http://203.0.113.7/#pair=odp_p')).toMatchObject({ kind: 'public', url: 'tcp://203.0.113.7:80' });

    expect(() => routeFromPairingUrl('http://localhost:3011/#pair=odp_abc')).toThrow(/only works on that machine/);
    expect(() => routeFromPairingUrl('http://127.0.0.1:3042/#pair=odp_abc')).toThrow(/--allow-loopback/);
    expect(routeFromPairingUrl('http://127.0.0.1:3042/#pair=odp_abc', { allowLoopback: true })).toEqual({
      url: 'tcp://127.0.0.1:3042', kind: 'lan', source: 'pairing', pairingCode: 'odp_abc',
    });
    expect(() => routeFromPairingUrl('http://192.168.1.20:3011/')).toThrow(/#pair=odp_/);
    expect(() => routeFromPairingUrl('http://192.168.1.20:3011/#pair=nope')).toThrow(/#pair=odp_/);
    expect(() => routeFromPairingUrl('ftp://192.168.1.20/#pair=odp_a')).toThrow(/http:\/\/ or https:\/\//);
  });

  it('ac4: ranks lan before tailnet before public, tcp before wss, manual before pairing before advertised', () => {
    const ranked = rankRoutes([
      route('tcp://203.0.113.7:3011', 'public', 'manual'),
      route('wss://desk.ts.net/ws/link', 'tailnet', 'advertised'),
      route('tcp://100.101.1.2:3011', 'tailnet', 'pairing'),
      route('tcp://192.168.1.20:3011', 'lan', 'advertised'),
      route('tcp://192.168.1.21:3011', 'lan', 'manual'),
      route('tcp://192.168.1.19:3011', 'lan', 'advertised'),
    ]);
    expect(ranked.map((entry) => entry.url)).toEqual([
      'tcp://192.168.1.21:3011',
      'tcp://192.168.1.19:3011',
      'tcp://192.168.1.20:3011',
      'tcp://100.101.1.2:3011',
      'wss://desk.ts.net/ws/link',
      'tcp://203.0.113.7:3011',
    ]);
  });

  it('ac5: mergeAdvertised drops stale advertised routes, adds new ones, and never touches pairing or manual', () => {
    const routes: LinkRoute[] = [
      route('tcp://100.101.1.2:3011', 'tailnet', 'pairing'),
      route('tcp://192.168.1.20:3011', 'lan', 'advertised'),
      route('tcp://10.9.9.9:3011', 'lan', 'manual'),
    ];
    const merged = mergeAdvertised(routes, [
      { kind: 'lan', url: 'tcp://192.168.5.5:3011' },
      { kind: 'tailnet', url: 'tcp://100.101.1.2:3011' },
    ], () => '2026-11-02T00:00:00.000Z');
    expect(merged).toEqual([
      route('tcp://100.101.1.2:3011', 'tailnet', 'pairing'),
      route('tcp://10.9.9.9:3011', 'lan', 'manual'),
      { url: 'tcp://192.168.5.5:3011', kind: 'lan', source: 'advertised', addedAt: '2026-11-02T00:00:00.000Z' },
    ]);
    expect(mergeAdvertised(merged, [])).toEqual(merged.filter((entry) => entry.source !== 'advertised'));
  });
});

describe('WebRTC routes (PAN-2356 WI-11)', () => {
  const ENV = '0b5c9e7a-4c1d-4f2e-9a3b-6d7e8f901234';

  it('parses rtc:// as direct and rtc+turn:// as relay', () => {
    expect(parseRouteUrl(`rtc://${ENV}`)).toEqual({ transport: 'rtc', host: ENV, port: 0, url: `rtc://${ENV}`, kind: 'direct' });
    expect(parseRouteUrl(`rtc+turn://${ENV}`)).toEqual({ transport: 'rtc', host: ENV, port: 0, url: `rtc+turn://${ENV}`, kind: 'relay' });
  });

  it('rejects an rtc URL without an environment id', () => {
    expect(() => parseRouteUrl('rtc://not-a-uuid')).toThrow(/environment id/);
    expect(() => parseRouteUrl(`rtc://${ENV.toUpperCase()}`)).toThrow();
    expect(() => parseRouteUrl(`rtc://${ENV}/path`)).toThrow();
  });

  it('never stores an advertised rtc route', () => {
    const merged = mergeAdvertised([], [
      { kind: 'lan', url: 'tcp://192.168.5.5:3011' },
      { kind: 'direct', url: `rtc://${ENV}` },
    ]);
    expect(merged.map((route) => route.url)).toEqual(['tcp://192.168.5.5:3011']);
  });

  it('ranks direct and relay after the stored kinds', () => {
    const ranked = rankRoutes([
      { url: `rtc+turn://${ENV}`, kind: 'relay', source: 'manual' },
      { url: `rtc://${ENV}`, kind: 'direct', source: 'manual' },
      { url: 'tcp://203.0.113.4:3011', kind: 'public', source: 'manual' },
    ] as const);
    expect(ranked.map((route) => route.kind)).toEqual(['public', 'direct', 'relay']);
  });
});
