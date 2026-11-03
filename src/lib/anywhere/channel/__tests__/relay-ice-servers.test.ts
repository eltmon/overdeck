/**
 * The relay route's ICE list (PAN-4862). Pure: no network, no timers. The werift cases run werift's own
 * `parseIceServers` on the output, so a werift bump that changes which TURN URL it uses fails here.
 */
import { describe, expect, it } from 'vitest';
import { parseIceServers } from 'werift';

import { relayIceServers, turnUrlRank } from '../relay-ice-servers.js';

const CLOUDFLARE = [{
  urls: [
    'stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53',
    'turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp',
    'turn:turn.cloudflare.com:3478?transport=tcp', 'turn:turn.cloudflare.com:80?transport=tcp',
    'turns:turn.cloudflare.com:5349?transport=tcp', 'turns:turn.cloudflare.com:443?transport=tcp',
  ],
  username: 'u', credential: 'c',
}];

describe('turnUrlRank', () => {
  it('ranks TLS on 443, other TLS, TCP, then UDP, and ignores STUN', () => {
    expect(turnUrlRank('turns:h:443?transport=tcp')).toBe(0);
    expect(turnUrlRank('TURNS:h:443')).toBe(0);
    expect(turnUrlRank('turns:h:5349?transport=tcp')).toBe(1);
    expect(turnUrlRank('turns:h')).toBe(1);
    expect(turnUrlRank('turn:h:3478?transport=tcp')).toBe(2);
    expect(turnUrlRank('turn:h:3478?transport=udp')).toBe(3);
    expect(turnUrlRank('turn:h:3478')).toBe(3);
    expect(turnUrlRank('stun:h:3478')).toBeNull();
    expect(turnUrlRank('stuns:h:5349')).toBeNull();
  });
});

describe('relayIceServers', () => {
  it('puts turns: on 443 first and drops STUN', () => {
    expect(relayIceServers(CLOUDFLARE)).toEqual([{
      urls: [
        'turns:turn.cloudflare.com:443?transport=tcp', 'turns:turn.cloudflare.com:5349?transport=tcp',
        'turn:turn.cloudflare.com:3478?transport=tcp', 'turn:turn.cloudflare.com:80?transport=tcp',
        'turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp',
      ],
      username: 'u', credential: 'c',
    }]);
  });

  it('werift picks TLS on 443', () => {
    const options = parseIceServers(relayIceServers(CLOUDFLARE));
    expect(options.turnServer).toEqual(['turn.cloudflare.com', 443]);
    expect(options.turnTransport).toBe('tls');
    expect(options.turnUsername).toBe('u');
    expect(options.stunServer).toBeUndefined();
  });

  it('prefers TCP when there is no turns: URL', () => {
    const servers = [{
      urls: ['turn:h:3478?transport=udp', 'turn:h:3478?transport=tcp'],
      username: 'u', credential: 'c',
    }];
    expect(parseIceServers(relayIceServers(servers)).turnTransport).toBe('tcp');
  });

  it('keeps a UDP-only list usable', () => {
    const servers = [{ urls: ['turn:h:3478?transport=udp'], username: 'u', credential: 'c' }];
    const relay = relayIceServers(servers);
    expect(relay).toEqual(servers);
    expect(parseIceServers(relay).turnTransport).toBe('udp');
  });

  it('orders entries by their best URL', () => {
    const udp = { urls: ['turn:a:3478?transport=udp'], username: 'ua', credential: 'ca' };
    const tls = { urls: ['turns:b:443?transport=tcp'], username: 'ub', credential: 'cb' };
    expect(relayIceServers([udp, tls])).toEqual([tls, udp]);
  });

  it('returns a list with no TURN URL unchanged', () => {
    const servers = [{ urls: ['stun:s:3478'] }];
    expect(relayIceServers(servers)).toEqual(servers);
  });

  it('accepts a string urls value', () => {
    const servers = [
      { urls: 'stun:s:3478' },
      { urls: 'turns:h:443?transport=tcp', username: 'u', credential: 'c' },
    ];
    expect(relayIceServers(servers)).toEqual([
      { urls: ['turns:h:443?transport=tcp'], username: 'u', credential: 'c' },
    ]);
  });
});
