/**
 * Darwin-only gateway probe for macOS Local Network privacy (PAN-4897 WI-3, D-2, D-3).
 * A fast `EHOSTUNREACH` on a LAN route is not proof of the denial on its own (a cached
 * ARP-reject route gives the same errno for a powered-off peer), so the dashboard
 * confirms its own process's access by dialing the default gateway on port 9. Async
 * child-process and socket calls only (NFR-1) — never a blocking spawn variant.
 */
import { execFile as execFileCb } from 'node:child_process';
import { connect as netConnect, isIPv4 } from 'node:net';
import { promisify } from 'node:util';

import { isLanAddress } from './local-network.js';

export type LocalNetworkAccess = 'denied' | 'allowed' | 'unknown';

export interface LocalNetworkProbeDeps {
  platform: NodeJS.Platform;
  execFile: (file: string, args: readonly string[], opts: { timeout: number }) => Promise<{ stdout: string }>;
  /** One TCP connect; resolves `'connected'`, `'timeout'`, or the errno string. Never rejects. */
  tcpConnect: (host: string, port: number, timeoutMs: number) => Promise<string>;
}

const execFileAsync = promisify(execFileCb);

async function defaultExecFile(file: string, args: readonly string[], opts: { timeout: number }): Promise<{ stdout: string }> {
  return execFileAsync(file, args as string[], { timeout: opts.timeout, encoding: 'utf-8' });
}

function defaultTcpConnect(host: string, port: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = netConnect({ host, port });
    const finish = (result: string): void => {
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      finish('connected');
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      finish((error as NodeJS.ErrnoException).code ?? 'unknown');
    });
  });
}

const DEFAULT_PROBE_DEPS: LocalNetworkProbeDeps = {
  platform: process.platform,
  execFile: defaultExecFile,
  tcpConnect: defaultTcpConnect,
};

/** The IPv4 address on a `route -n get default` sample's `gateway: <ip>` line, or null. */
export function parseDefaultGateway(routeOutput: string): string | null {
  const match = /^\s*gateway:\s*(\S+)/m.exec(routeOutput);
  return match ? match[1]! : null;
}

/**
 * Tests whether this process can reach the default gateway, as a proxy for whether
 * macOS Local Network privacy is denying it. Not darwin, a failed gateway lookup, or
 * a gateway that is not a LAN IPv4 literal all resolve `'unknown'` without dialing.
 */
export async function checkLocalNetworkAccess(deps: Partial<LocalNetworkProbeDeps> = {}): Promise<LocalNetworkAccess> {
  const { platform, execFile, tcpConnect } = { ...DEFAULT_PROBE_DEPS, ...deps };
  if (platform !== 'darwin') return 'unknown';

  let stdout: string;
  try {
    ({ stdout } = await execFile('/sbin/route', ['-n', 'get', 'default'], { timeout: 2000 }));
  } catch {
    return 'unknown';
  }

  const gateway = parseDefaultGateway(stdout);
  if (!gateway || !isIPv4(gateway) || !isLanAddress(gateway)) return 'unknown';

  const result = await tcpConnect(gateway, 9, 1000);
  if (result === 'EHOSTUNREACH') return 'denied';
  if (result === 'connected' || result === 'timeout' || result === 'ECONNREFUSED') return 'allowed';
  return 'unknown';
}
