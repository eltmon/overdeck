/** PAN-4897 WI-3: the darwin-only gateway probe, with injected deps only (no real sockets or child processes). */
import { describe, expect, it, vi } from 'vitest';

import { checkLocalNetworkAccess, type LocalNetworkProbeDeps, parseDefaultGateway } from '../local-network-probe.js';

const ROUTE_OUTPUT_WITH_GATEWAY = `
   route to: default
destination: default
       mask: default
    gateway: 192.168.1.1
  interface: en0
`;

function deps(overrides: Partial<LocalNetworkProbeDeps> = {}): Partial<LocalNetworkProbeDeps> {
  return {
    platform: 'darwin',
    execFile: vi.fn(async () => ({ stdout: ROUTE_OUTPUT_WITH_GATEWAY })),
    tcpConnect: vi.fn(async () => 'EHOSTUNREACH'),
    ...overrides,
  };
}

describe('parseDefaultGateway', () => {
  it('reads the gateway line from a real route -n get default sample', () => {
    expect(parseDefaultGateway(ROUTE_OUTPUT_WITH_GATEWAY)).toBe('192.168.1.1');
  });

  it('returns null when there is no gateway line', () => {
    expect(parseDefaultGateway('destination: default\n   interface: en0\n')).toBeNull();
  });
});

describe('checkLocalNetworkAccess', () => {
  it("returns 'unknown' on linux and never calls execFile or tcpConnect", async () => {
    const execFile = vi.fn();
    const tcpConnect = vi.fn();
    const result = await checkLocalNetworkAccess({ platform: 'linux', execFile, tcpConnect });
    expect(result).toBe('unknown');
    expect(execFile).not.toHaveBeenCalled();
    expect(tcpConnect).not.toHaveBeenCalled();
  });

  it("returns 'denied' when tcpConnect resolves EHOSTUNREACH, dialing the parsed gateway on port 9 with a 1s timeout", async () => {
    const tcpConnect = vi.fn(async () => 'EHOSTUNREACH');
    const result = await checkLocalNetworkAccess(deps({ tcpConnect }));
    expect(result).toBe('denied');
    expect(tcpConnect).toHaveBeenCalledWith('192.168.1.1', 9, 1000);
  });

  it.each(['ECONNREFUSED', 'connected', 'timeout'])("returns 'allowed' when tcpConnect resolves %s", async (outcome) => {
    const result = await checkLocalNetworkAccess(deps({ tcpConnect: vi.fn(async () => outcome) }));
    expect(result).toBe('allowed');
  });

  it("returns 'unknown' when execFile rejects", async () => {
    const execFile = vi.fn(async () => { throw new Error('route: timeout'); });
    const tcpConnect = vi.fn();
    const result = await checkLocalNetworkAccess(deps({ execFile, tcpConnect }));
    expect(result).toBe('unknown');
    expect(tcpConnect).not.toHaveBeenCalled();
  });

  it("returns 'unknown' when the route output has no gateway line", async () => {
    const execFile = vi.fn(async () => ({ stdout: 'destination: default\n' }));
    const tcpConnect = vi.fn();
    const result = await checkLocalNetworkAccess(deps({ execFile, tcpConnect }));
    expect(result).toBe('unknown');
    expect(tcpConnect).not.toHaveBeenCalled();
  });

  it("returns 'unknown' when the gateway is not a LAN address (e.g. a tailnet 100.64/10 address)", async () => {
    const execFile = vi.fn(async () => ({ stdout: '   gateway: 100.64.0.1\n' }));
    const tcpConnect = vi.fn();
    const result = await checkLocalNetworkAccess(deps({ execFile, tcpConnect }));
    expect(result).toBe('unknown');
    expect(tcpConnect).not.toHaveBeenCalled();
  });

  it("returns 'unknown' when tcpConnect resolves an unmapped errno", async () => {
    const result = await checkLocalNetworkAccess(deps({ tcpConnect: vi.fn(async () => 'ENETUNREACH') }));
    expect(result).toBe('unknown');
  });
});
