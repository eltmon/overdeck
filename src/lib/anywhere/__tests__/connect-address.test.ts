import type { NetworkInterfaceInfo } from 'node:os';

import { describe, expect, it } from 'vitest';

import { pickPairingBase } from '../connect-address.js';

function v4(address: string, internal = false): NetworkInterfaceInfo {
  return { address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: `${address}/24` };
}

const LOOPBACK_ONLY = { lo: [v4('127.0.0.1', true)] };
const PORT = 3011;

describe('pickPairingBase (D-6)', () => {
  it('1. uses --url exactly as given, trailing slash stripped', () => {
    expect(pickPairingBase({ url: 'https://box.example.com/', port: PORT, interfaces: { tailscale0: [v4('100.101.102.103')] } }))
      .toEqual({ base: 'https://box.example.com', host: 'box.example.com', kind: 'public', source: 'flag' });
  });

  it('1. rejects a --url that is not http or https', () => {
    expect(() => pickPairingBase({ url: 'ftp://box', port: PORT, interfaces: {} })).toThrow('--url must be an http:// or https:// address');
    expect(() => pickPairingBase({ url: 'not a url', port: PORT, interfaces: {} })).toThrow('--url must be an http:// or https:// address');
  });

  it('2. a tailnet address beats the SSH address', () => {
    expect(pickPairingBase({
      port: PORT,
      sshConnection: '198.51.100.4 51234 203.0.113.7 22',
      interfaces: { eth0: [v4('203.0.113.7')], tailscale0: [v4('100.101.102.103')] },
    })).toEqual({ base: 'http://100.101.102.103:3011', host: '100.101.102.103', kind: 'tailnet', source: 'tailnet' });
  });

  it('3. uses the SSH server address the operator connected to', () => {
    expect(pickPairingBase({
      port: PORT,
      sshConnection: '198.51.100.4 51234 203.0.113.7 22',
      interfaces: { eth0: [v4('10.0.0.5')] },
    })).toEqual({ base: 'http://203.0.113.7:3011', host: '203.0.113.7', kind: 'public', source: 'ssh' });
  });

  it('3. skips a loopback SSH address (an SSH tunnel)', () => {
    expect(pickPairingBase({ port: PORT, sshConnection: '::1 51234 ::1 22', interfaces: { eth0: [v4('203.0.113.9')] } }))
      .toMatchObject({ base: 'http://203.0.113.9:3011', source: 'interface' });
  });

  it('3. brackets an IPv6 SSH address', () => {
    expect(pickPairingBase({ port: PORT, sshConnection: '2001:db8::2 51234 2001:db8::1 22', interfaces: LOOPBACK_ONLY }))
      .toEqual({ base: 'http://[2001:db8::1]:3011', host: '[2001:db8::1]', kind: 'public', source: 'ssh' });
  });

  it('4. prefers a public interface address over an RFC 1918 one', () => {
    expect(pickPairingBase({ port: PORT, interfaces: { eth1: [v4('192.168.1.20')], eth0: [v4('203.0.113.9')] } }))
      .toEqual({ base: 'http://203.0.113.9:3011', host: '203.0.113.9', kind: 'public', source: 'interface' });
    expect(pickPairingBase({ port: PORT, interfaces: { eth1: [v4('192.168.1.20')] } }))
      .toEqual({ base: 'http://192.168.1.20:3011', host: '192.168.1.20', kind: 'lan', source: 'interface' });
  });

  it('4. ignores container bridge interfaces', () => {
    expect(pickPairingBase({ port: PORT, interfaces: { docker0: [v4('172.17.0.1')], 'br-1a2b': [v4('172.18.0.1')], ...LOOPBACK_ONLY } }))
      .toMatchObject({ source: 'loopback' });
  });

  it('5. falls back to localhost when nothing else is reachable', () => {
    expect(pickPairingBase({ port: PORT, interfaces: LOOPBACK_ONLY }))
      .toEqual({ base: 'http://localhost:3011', host: 'localhost', kind: 'loopback', source: 'loopback' });
  });
});
