/**
 * PAN-5250 WI-3: is anyone using a workspace container right now?
 *
 * Two facts decide it (D6, D7):
 * - Exec sessions: `docker inspect` reports the running exec ids of a container
 *   (VS Code attach, a container quality gate, an agent's `docker exec`).
 * - Inbound connections: the container's network namespace, read from the host
 *   at `/proc/<pid>/net/tcp` and `tcp6`. A connection counts when it is
 *   ESTABLISHED on a port the container listens on and its peer is not
 *   loopback (D8), so healthchecks and in-container tools never count. A
 *   browser tab with the app open holds one (the Vite HMR WebSocket via Traefik).
 *
 * Any read that fails gives `'unknown'` for that container, and callers treat
 * `'unknown'` as "in use" (NFR-3). Linux only (NFR-8): elsewhere every read
 * fails and nothing is ever stopped. Docker runs through promisified
 * `execFile` with an argument array; `/proc` reads use `fs/promises` (NFR-2).
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { noteHostToolSpawnFailed, resolveHostTool } from '../host-tools.js';
import { CONTAINER_NAME_RE } from './stack-reclaim-docker.js';

const execFileAsync = promisify(execFile);

const INSPECT_TIMEOUT_MS = 10_000;
const INSPECT_FORMAT = '{{.Name}}\t{{.State.Pid}}\t{{len .ExecIDs}}';
const TCP_LISTEN = '0A';
const TCP_ESTABLISHED = '01';
const IPV6_LOOPBACK = '00000000000000000000000001000000';
const IPV4_MAPPED_PREFIX = '0000000000000000FFFF0000';

export interface ContainerUsage { inboundConnections: number; execSessions: number }
export type ContainerUsageResult = ContainerUsage | 'unknown';

export interface UsageProbeDeps {
  /** Raw `docker inspect --format INSPECT_FORMAT <names…>` stdout, or null when the call failed. */
  inspect: (names: readonly string[]) => Promise<string | null>;
  readProcFile: (path: string) => Promise<string>;
}

/**
 * True for a loopback address in `/proc/net/tcp*` hex form (D8): IPv4 is 8 hex
 * digits little-endian, so 127.x.x.x ends in `7F`; IPv6 is `::1` or the
 * v4-mapped `::ffff:127.x.x.x`.
 */
export function isLoopbackHex(address: string): boolean {
  const hex = address.toUpperCase();
  if (hex.length === 8) return hex.endsWith('7F');
  if (hex.length === 32) return hex === IPV6_LOOPBACK || (hex.startsWith(IPV4_MAPPED_PREFIX) && hex.endsWith('7F'));
  return false;
}

interface TcpRow { localPort: number; remoteAddress: string; state: string }

function parseTcpTable(table: string): TcpRow[] {
  const rows: TcpRow[] = [];
  for (const line of table.split('\n').slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 4) continue;
    const [, local, remote, state] = columns;
    const localSplit = local.lastIndexOf(':');
    const remoteSplit = remote.lastIndexOf(':');
    if (localSplit < 0 || remoteSplit < 0) continue;
    const localPort = parseInt(local.slice(localSplit + 1), 16);
    if (!Number.isFinite(localPort)) continue;
    rows.push({ localPort, remoteAddress: remote.slice(0, remoteSplit), state: state.toUpperCase() });
  }
  return rows;
}

/**
 * Pure: established, non-loopback connections whose local port is one the
 * container listens on. The listening ports are the union of `tcp` and `tcp6`,
 * because Node often listens on `::` only and IPv4 peers then appear in `tcp6`.
 */
export function countInboundConnections(tcp: string, tcp6: string): number {
  const rows = [...parseTcpTable(tcp), ...parseTcpTable(tcp6)];
  const listening = new Set(rows.filter((row) => row.state === TCP_LISTEN).map((row) => row.localPort));
  return rows.filter((row) =>
    row.state === TCP_ESTABLISHED && listening.has(row.localPort) && !isLoopbackHex(row.remoteAddress),
  ).length;
}

/** Pure: parses INSPECT_FORMAT output into name (leading '/' stripped) → pid and exec-session count. */
export function parseInspectUsage(stdout: string): Map<string, { pid: number; execSessions: number }> {
  const usage = new Map<string, { pid: number; execSessions: number }>();
  for (const line of stdout.split('\n')) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 3) continue;
    const name = columns[0].replace(/^\//, '');
    const pid = Number(columns[1]);
    const execSessions = Number(columns[2]);
    if (!name || !Number.isInteger(pid) || !Number.isInteger(execSessions)) continue;
    usage.set(name, { pid, execSessions });
  }
  return usage;
}

async function defaultInspect(names: readonly string[]): Promise<string | null> {
  const docker = resolveHostTool('docker');
  if (docker === null) return null;
  try {
    const { stdout } = await execFileAsync(docker, ['inspect', '--format', INSPECT_FORMAT, ...names], {
      timeout: INSPECT_TIMEOUT_MS,
      encoding: 'utf8',
    });
    return stdout;
  } catch (error) {
    noteHostToolSpawnFailed('docker', error);
    return null;
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}

async function probeOne(
  info: { pid: number; execSessions: number } | undefined,
  readProcFile: UsageProbeDeps['readProcFile'],
): Promise<ContainerUsageResult> {
  if (!info || info.pid <= 0) return 'unknown';
  let tcp: string;
  let tcp6: string;
  try {
    tcp = await readProcFile(`/proc/${info.pid}/net/tcp`);
  } catch {
    return 'unknown';
  }
  try {
    tcp6 = await readProcFile(`/proc/${info.pid}/net/tcp6`);
  } catch (error) {
    if (!isEnoent(error)) return 'unknown';
    tcp6 = '';
  }
  return { inboundConnections: countInboundConnections(tcp, tcp6), execSessions: info.execSessions };
}

/**
 * One `docker inspect` for every name, then `/proc` reads per container. A name
 * that fails CONTAINER_NAME_RE or is absent from the inspect output maps to
 * `'unknown'`. Returns null when the inspect call itself fails.
 */
export async function probeContainerUsage(
  names: readonly string[],
  deps: Partial<UsageProbeDeps> = {},
): Promise<Map<string, ContainerUsageResult> | null> {
  const inspect = deps.inspect ?? defaultInspect;
  const readProcFile = deps.readProcFile ?? ((path: string) => readFile(path, 'utf8'));
  const valid = names.filter((name) => CONTAINER_NAME_RE.test(name));
  let inspected = new Map<string, { pid: number; execSessions: number }>();
  if (valid.length > 0) {
    const stdout = await inspect(valid);
    if (stdout === null) return null;
    inspected = parseInspectUsage(stdout);
  }
  const result = new Map<string, ContainerUsageResult>();
  for (const name of names) {
    result.set(name, CONTAINER_NAME_RE.test(name) ? await probeOne(inspected.get(name), readProcFile) : 'unknown');
  }
  return result;
}
