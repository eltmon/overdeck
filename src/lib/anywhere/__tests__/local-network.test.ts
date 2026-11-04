/** PAN-4897 WI-2: the LAN classifier range table, the unreachable-routes filter, and the exact D-6 message text. */
import { describe, expect, it } from 'vitest';

import { isLanAddress, lanHostUnreachableRoutes, localNetworkBlockedDetail } from '../local-network.js';

describe('isLanAddress', () => {
  it.each([
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.1.64', true],
    ['10.0.0.1', true],
    ['169.254.1.1', true],
    ['fe80::1', true],
    ['fd00::1', true],
    ['172.15.0.1', false],
    ['172.32.0.1', false],
    ['100.100.1.1', false],
    ['127.0.0.1', false],
    ['8.8.8.8', false],
    ['desk.local', false],
  ])('%s -> %s', (host, expected) => {
    expect(isLanAddress(host)).toBe(expected);
  });

  it('strips brackets from an IPv6 literal', () => {
    expect(isLanAddress('[fe80::1]')).toBe(true);
  });
});

describe('lanHostUnreachableRoutes', () => {
  it('returns both URLs for two LAN tcp routes failing with EHOSTUNREACH', () => {
    const routes = lanHostUnreachableRoutes([
      { url: 'tcp://192.168.1.64:3011', cause: 'EHOSTUNREACH' },
      { url: 'tcp://192.168.1.86:3011', cause: 'EHOSTUNREACH' },
    ]);
    expect(routes).toEqual(['tcp://192.168.1.64:3011', 'tcp://192.168.1.86:3011']);
  });

  it('returns [] when one LAN route failed with ECONNREFUSED', () => {
    const routes = lanHostUnreachableRoutes([
      { url: 'tcp://192.168.1.64:3011', cause: 'EHOSTUNREACH' },
      { url: 'tcp://192.168.1.86:3011', cause: 'ECONNREFUSED' },
    ]);
    expect(routes).toEqual([]);
  });

  it('returns [] when the only route is not a LAN address', () => {
    const routes = lanHostUnreachableRoutes([{ url: 'tcp://100.101.1.2:3011', cause: 'EHOSTUNREACH' }]);
    expect(routes).toEqual([]);
  });
});

describe('localNetworkBlockedDetail', () => {
  it('builds the exact D-6 message', () => {
    const detail = localNetworkBlockedDetail('/opt/homebrew/bin/node', ['tcp://192.168.1.64:3011']);
    expect(detail).toBe(
      'macOS is blocking local network access for Overdeck. On this Mac, open System Settings → Privacy & Security → Local Network '
      + 'and turn on node (/opt/homebrew/bin/node); if you started Overdeck from a terminal app, turn that app on instead. '
      + 'The link retries on its own. If node is not in the list, link over Tailscale (pan tailscale setup). '
      + 'Blocked routes: tcp://192.168.1.64:3011',
    );
    expect(detail.startsWith('macOS is blocking local network access for Overdeck.')).toBe(true);
    expect(detail).toContain('turn on node (/opt/homebrew/bin/node)');
    expect(detail).toContain('Blocked routes: tcp://192.168.1.64:3011');
  });

  it('joins multiple blocked routes with a comma', () => {
    const detail = localNetworkBlockedDetail('/usr/local/bin/node', ['tcp://192.168.1.64:3011', 'tcp://192.168.1.86:3011']);
    expect(detail).toContain('Blocked routes: tcp://192.168.1.64:3011, tcp://192.168.1.86:3011');
  });
});
