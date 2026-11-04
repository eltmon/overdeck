/**
 * The pairing base `pan connect` prints (PAN-4656, D-6): the `http://<address>:<port>`
 * another machine can reach. First match wins:
 *
 *  1. `--url <base>` exactly as given (trailing `/` stripped);
 *  2. the first tailnet IPv4 on an interface;
 *  3. the server address in `SSH_CONNECTION` (third field) when not loopback —
 *     the address the operator just used to reach this machine;
 *  4. the first non-internal, non-tailnet IPv4 on a real interface, public
 *     addresses before private ones;
 *  5. `http://localhost:<port>`, which `pan connect` prints with the `pan pair`
 *     loopback warning.
 *
 * Pure: the caller passes the interface table and `SSH_CONNECTION`.
 */

import type { NetworkInterfaceInfo } from 'node:os';

import { IGNORED_INTERFACE_PREFIXES, interfaceEndpoints, isTailnetIPv4 } from './endpoints.js';
import { classifyHost, isLoopbackHost } from './routes.js';

export type PairingBaseKind = 'tailnet' | 'public' | 'lan' | 'loopback';

export interface PairingBase {
  base: string;
  /** The host as it appears in `base` (IPv6 in brackets). */
  host: string;
  kind: PairingBaseKind;
  source: 'flag' | 'tailnet' | 'ssh' | 'interface' | 'loopback';
}

export interface PickPairingBaseInput {
  url?: string;
  port: number;
  sshConnection?: string;
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>;
}

function kindOf(host: string): PairingBaseKind {
  if (isLoopbackHost(host)) return 'loopback';
  const kind = classifyHost(host);
  return kind === 'tailnet' || kind === 'lan' ? kind : 'public';
}

function fromFlag(url: string): PairingBase {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('--url must be an http:// or https:// address');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('--url must be an http:// or https:// address');
  }
  return { base: url.replace(/\/+$/, ''), host: parsed.hostname, kind: kindOf(parsed.hostname), source: 'flag' };
}

/** The server address of `SSH_CONNECTION` ("client_ip client_port server_ip server_port"), as a URL host. */
function sshServerHost(sshConnection: string | undefined): string | null {
  const address = sshConnection?.trim().split(/\s+/)[2];
  if (!address || address.includes('%')) return null; // absent, or a zoned link-local address
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const host = mapped ? mapped[1]! : address;
  if (isLoopbackHost(host)) return null;
  return host.includes(':') ? `[${host}]` : host;
}

function isIgnoredInterface(name: string): boolean {
  return IGNORED_INTERFACE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Non-internal, non-tailnet IPv4 addresses on real interfaces, public before private. */
function interfaceAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
  const found: string[] = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (isIgnoredInterface(name)) continue;
    for (const info of addresses ?? []) {
      if (info.family !== 'IPv4' && (info.family as unknown) !== 4) continue;
      if (info.internal || isTailnetIPv4(info.address)) continue;
      found.push(info.address);
    }
  }
  return [
    ...found.filter((address) => classifyHost(address) === 'public'),
    ...found.filter((address) => classifyHost(address) !== 'public'),
  ];
}

export function pickPairingBase(input: PickPairingBaseInput): PairingBase {
  if (input.url !== undefined) return fromFlag(input.url);

  const at = (host: string, source: PairingBase['source']): PairingBase => ({
    base: `http://${host}:${input.port}`,
    host,
    kind: kindOf(host),
    source,
  });

  const tailnet = interfaceEndpoints(input.port, input.interfaces).find((endpoint) => endpoint.kind === 'tailnet');
  if (tailnet) return at(new URL(tailnet.url).hostname, 'tailnet');

  const sshHost = sshServerHost(input.sshConnection);
  if (sshHost) return at(sshHost, 'ssh');

  const [address] = interfaceAddresses(input.interfaces);
  if (address) return at(address, 'interface');

  return { base: `http://localhost:${input.port}`, host: 'localhost', kind: 'loopback', source: 'loopback' };
}
