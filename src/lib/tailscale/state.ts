/**
 * Tailscale state reader (PAN-1254 W-1, FR-1, D-6, D-8, NFR-6).
 *
 * `readTailscaleState()` answers one question for the dashboard, the CLI and
 * the Anywhere status card: what does Tailscale look like on this machine, and
 * what is the next setup step? It runs `version`, `status --json`,
 * `serve status --json` and (Linux system mode only) `debug prefs` in
 * parallel, each bounded by the read timeout, and never rejects.
 *
 * Nothing is stored. The answer is memoized for 3 s because the Anywhere
 * status card refetches every 30 s and several routes read it; without the
 * memo each request would spawn up to four processes. Callers that change
 * Tailscale state call `invalidateTailscaleStateCache()`.
 */
import { userInfo } from 'node:os';
import { access } from 'node:fs/promises';
import { getDashboardLoopbackApiUrl } from '../config.js';
import { readRemoteAccessConfig } from '../remote-access/config.js';
import {
  resolveTailscaleCli,
  runTailscale,
  userspaceSocketPath,
  type TailscaleCli,
  type TailscaleMode,
  type TailscaleRunResult,
} from './cli.js';

export type TailscaleNextStep =
  | 'install'
  | 'start-daemon'
  | 'operator'
  | 'login'
  | 'enable-https'
  | 'serve'
  | 'protect'
  | 'ready';

/** D-6: only `other` routes to the operator step; `unknown` proceeds and lets the write decide. */
export type TailscaleOperator = 'self' | 'other' | 'unknown';

export interface TailscalePeer {
  hostName: string;
  /** MagicDNS name without the trailing dot. */
  dnsName: string | null;
  ipv4: string[];
  os: string | null;
  online: boolean;
}

export interface TailscaleStatusInfo {
  backendState: string | null;
  authUrl: string | null;
  magicDnsName: string | null;
  hostName: string | null;
  ipv4: string[];
  loginName: string | null;
  magicDnsEnabled: boolean;
  magicDnsSuffix: string | null;
  tailnetName: string | null;
  /** True when the tailnet has HTTPS certificates on (`CertDomains` non-empty). */
  httpsEnabled: boolean;
  peers: TailscalePeer[];
}

export interface TailscaleServeInfo {
  /** `/` on `<MagicDNS>:443` proxies to this dashboard. */
  proxiesDashboard: boolean;
  /** Something other than this dashboard is served on port 443 (NFR-5: never clobber it). */
  otherHandlerOn443: boolean;
  /** Tailscale Funnel publishes `<MagicDNS>:443` on the public internet. */
  funnelOn443: boolean;
}

export interface TailscaleState {
  installed: boolean;
  cli: TailscaleCli | null;
  mode: TailscaleMode | null;
  version: string | null;
  /** `status --json` answered with a parseable backend state. */
  daemonRunning: boolean;
  /** First line of the `status --json` failure when the daemon did not answer. */
  statusError: string | null;
  backendState: string | null;
  authUrl: string | null;
  magicDnsName: string | null;
  /** `https://<MagicDNS name>` — the address another tailnet device opens. */
  serveUrl: string | null;
  hostName: string | null;
  ipv4: string[];
  loginName: string | null;
  magicDnsEnabled: boolean;
  httpsEnabled: boolean;
  tailnetName: string | null;
  operator: TailscaleOperator;
  serve: TailscaleServeInfo;
  /** Online peers only. */
  peers: TailscalePeer[];
  port: number;
  requireTokenMint: boolean;
  nextStep: TailscaleNextStep;
}

export const TAILSCALE_STATE_TTL_MS = 3000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function stripDot(name: string | null): string | null {
  return name ? name.replace(/\.$/, '') : null;
}

function ipv4Only(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((ip): ip is string => typeof ip === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip))
    : [];
}

/** Pure field mapping from `tailscale status --json`. Returns null when `json` is not an object. */
export function parseTailscaleStatus(json: unknown): TailscaleStatusInfo | null {
  const status = record(json);
  if (!status) return null;
  const self = record(status['Self']);
  const tailnet = record(status['CurrentTailnet']);
  const users = record(status['User']);
  const selfUserId = self?.['UserID'];
  const user = users && (typeof selfUserId === 'number' || typeof selfUserId === 'string')
    ? record(users[String(selfUserId)])
    : null;
  const certDomains = status['CertDomains'];
  const peers = Object.values(record(status['Peer']) ?? {}).flatMap((value) => {
    const peer = record(value);
    if (!peer) return [];
    return [{
      hostName: str(peer['HostName']) ?? '',
      dnsName: stripDot(str(peer['DNSName'])),
      ipv4: ipv4Only(peer['TailscaleIPs']),
      os: str(peer['OS']),
      online: peer['Online'] === true,
    }];
  });
  return {
    backendState: str(status['BackendState']),
    authUrl: str(status['AuthURL']),
    magicDnsName: stripDot(str(self?.['DNSName'])),
    hostName: str(self?.['HostName']),
    ipv4: ipv4Only(self?.['TailscaleIPs']),
    loginName: str(user?.['LoginName']),
    magicDnsEnabled: tailnet?.['MagicDNSEnabled'] === true,
    magicDnsSuffix: stripDot(str(tailnet?.['MagicDNSSuffix'])),
    tailnetName: str(tailnet?.['Name']),
    httpsEnabled: Array.isArray(certDomains) && certDomains.length > 0,
    peers,
  };
}

function isDashboardTarget(proxy: unknown, port: number): boolean {
  if (typeof proxy !== 'string') return false;
  const target = proxy.replace(/\/+$/, '');
  return target === `http://127.0.0.1:${port}` || target === `http://localhost:${port}`;
}

/**
 * Pure reading of `tailscale serve status --json` (C-4 shape:
 * `{ TCP: { "443": { HTTPS: true } }, Web: { "<name>:443": { Handlers: { "/": { Proxy } } } } }`).
 * An empty or absent config is free. When the MagicDNS name is unknown, any
 * `*:443` web entry counts. `AllowFunnel["<name>:443"]` means the same port is
 * also published on the public internet.
 */
export function parseServeStatus(json: unknown, magicDnsName: string | null, port: number): TailscaleServeInfo {
  const config = record(json);
  if (!config) return { proxiesDashboard: false, otherHandlerOn443: false, funnelOn443: false };

  let otherHandlerOn443 = false;
  const tcp443 = record(record(config['TCP'])?.['443']);
  if (tcp443 && Object.keys(tcp443).some((key) => key !== 'HTTPS')) otherHandlerOn443 = true;

  const wantedKey = magicDnsName ? `${stripDot(magicDnsName)!.toLowerCase()}:443` : null;
  let proxiesDashboard = false;
  for (const [hostPort, value] of Object.entries(record(config['Web']) ?? {})) {
    const key = hostPort.toLowerCase();
    if (wantedKey ? key !== wantedKey : !key.endsWith(':443')) continue;
    for (const [mount, handlerValue] of Object.entries(record(record(value)?.['Handlers']) ?? {})) {
      const handler = record(handlerValue);
      if (mount === '/' && isDashboardTarget(handler?.['Proxy'], port)) proxiesDashboard = true;
      else otherHandlerOn443 = true;
    }
  }
  const funnelOn443 = Object.entries(record(config['AllowFunnel']) ?? {}).some(([hostPort, allowed]) => {
    const key = hostPort.toLowerCase();
    return allowed === true && (wantedKey ? key === wantedKey : key.endsWith(':443'));
  });
  return { proxiesDashboard, otherHandlerOn443, funnelOn443 };
}

export interface NextStepInput {
  installed: boolean;
  daemonRunning: boolean;
  platform: NodeJS.Platform;
  mode: TailscaleMode | null;
  uid: number | null;
  operator: TailscaleOperator;
  backendState: string | null;
  magicDnsEnabled: boolean;
  httpsEnabled: boolean;
  proxiesDashboard: boolean;
  requireTokenMint: boolean;
}

/** The D-8 table, first match wins. */
export function computeNextStep(input: NextStepInput): TailscaleNextStep {
  if (!input.installed) return 'install';
  if (!input.daemonRunning) return 'start-daemon';
  if (input.platform === 'linux' && input.mode === 'system' && input.uid !== 0 && input.operator === 'other') {
    return 'operator';
  }
  // Row 4 names NeedsLogin, NeedsMachineAuth, NoState and Stopped. `Starting`
  // or an unrecognised state is also not signed-in-and-running, so it waits
  // here rather than falling through to `ready`.
  if (input.backendState !== 'Running') return 'login';
  if (!input.magicDnsEnabled || !input.httpsEnabled) return 'enable-https';
  if (!input.proxiesDashboard) return 'serve';
  if (!input.requireTokenMint) return 'protect';
  return 'ready';
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** D-6 three-state operator from `tailscale debug prefs`. */
function operatorFromPrefs(result: TailscaleRunResult, username: string): TailscaleOperator {
  if (!result.ok) return 'unknown';
  const prefs = record(parseJson(result.stdout));
  if (!prefs) return 'unknown';
  const operatorUser = typeof prefs['OperatorUser'] === 'string' ? prefs['OperatorUser'] : '';
  return operatorUser === username ? 'self' : 'other';
}

function firstLine(text: string): string | null {
  return text.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? null;
}

/** The dashboard's loopback API port — the Serve target and the peer probe port. */
export function dashboardApiPort(): number {
  const port = Number(new URL(getDashboardLoopbackApiUrl()).port);
  return Number.isFinite(port) && port > 0 ? port : 3011;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface ReadTailscaleStateDeps {
  resolveCli?: () => Promise<TailscaleCli | null>;
  run?: (cli: TailscaleCli, args: string[]) => Promise<TailscaleRunResult>;
  socketExists?: (path: string) => Promise<boolean>;
  platform?: NodeJS.Platform;
  uid?: number | null;
  username?: string;
  port?: number;
  requireTokenMint?: boolean;
  now?: () => number;
}

const NOT_RUN: TailscaleRunResult = { ok: false, code: null, stdout: '', stderr: '', timedOut: false };

async function readUncached(deps: ReadTailscaleStateDeps): Promise<TailscaleState> {
  const platform = deps.platform ?? process.platform;
  const uid = deps.uid !== undefined ? deps.uid : (process.getuid?.() ?? null);
  const port = deps.port ?? dashboardApiPort();
  const requireTokenMint = deps.requireTokenMint ?? readRemoteAccessConfig().requireTokenMint;
  const run = deps.run ?? ((cli: TailscaleCli, args: string[]) => runTailscale(cli, args));

  const cli = await (deps.resolveCli ?? resolveTailscaleCli)().catch(() => null);
  const base: TailscaleState = {
    installed: false,
    cli: null,
    mode: null,
    version: null,
    daemonRunning: false,
    statusError: null,
    backendState: null,
    authUrl: null,
    magicDnsName: null,
    serveUrl: null,
    hostName: null,
    ipv4: [],
    loginName: null,
    magicDnsEnabled: false,
    httpsEnabled: false,
    tailnetName: null,
    operator: 'self',
    serve: { proxiesDashboard: false, otherHandlerOn443: false, funnelOn443: false },
    peers: [],
    port,
    requireTokenMint,
    nextStep: 'install',
  };
  if (!cli) return base;

  // Userspace mode with no socket means our own daemon is not up; skip the
  // daemon calls rather than wait on them.
  const socketUp = cli.mode !== 'userspace'
    || await (deps.socketExists ?? pathExists)(userspaceSocketPath());
  const needsPrefs = platform === 'linux' && cli.mode === 'system' && uid !== 0;
  const [versionResult, statusResult, serveResult, prefsResult] = await Promise.all([
    run(cli, ['version']),
    socketUp ? run(cli, ['status', '--json']) : Promise.resolve({ ...NOT_RUN, stderr: 'tailscaled socket not found' }),
    socketUp ? run(cli, ['serve', 'status', '--json']) : Promise.resolve(NOT_RUN),
    socketUp && needsPrefs ? run(cli, ['debug', 'prefs']) : Promise.resolve(NOT_RUN),
  ]);

  // `status --json` can exit non-zero while still printing a usable state, so
  // trust the parsed backend state over the exit code. Anything else —
  // "failed to connect", a timeout, garbage — means the daemon did not answer.
  const status = parseTailscaleStatus(parseJson(statusResult.stdout));
  const daemonRunning = status !== null && status.backendState !== null;
  const statusError = daemonRunning
    ? null
    : statusResult.timedOut ? 'tailscale status timed out' : firstLine(statusResult.stderr);
  const operator: TailscaleOperator = needsPrefs ? operatorFromPrefs(prefsResult, deps.username ?? userInfo().username) : 'self';
  const magicDnsName = status?.magicDnsName ?? null;
  const serve = daemonRunning
    ? parseServeStatus(serveResult.ok ? parseJson(serveResult.stdout) : null, magicDnsName, port)
    : base.serve;

  const state: TailscaleState = {
    ...base,
    installed: true,
    cli,
    mode: cli.mode,
    version: versionResult.ok ? firstLine(versionResult.stdout) : null,
    daemonRunning,
    statusError,
    backendState: status?.backendState ?? null,
    authUrl: status?.authUrl ?? null,
    magicDnsName,
    serveUrl: magicDnsName ? `https://${magicDnsName}` : null,
    hostName: status?.hostName ?? null,
    ipv4: status?.ipv4 ?? [],
    loginName: status?.loginName ?? null,
    magicDnsEnabled: status?.magicDnsEnabled ?? false,
    httpsEnabled: status?.httpsEnabled ?? false,
    tailnetName: status?.tailnetName ?? null,
    operator,
    serve,
    peers: (status?.peers ?? []).filter((peer) => peer.online),
  };
  state.nextStep = computeNextStep({
    installed: true,
    daemonRunning,
    platform,
    mode: cli.mode,
    uid,
    operator,
    backendState: state.backendState,
    magicDnsEnabled: state.magicDnsEnabled,
    httpsEnabled: state.httpsEnabled,
    proxiesDashboard: serve.proxiesDashboard,
    requireTokenMint,
  });
  return state;
}

let memo: { at: number; promise: Promise<TailscaleState> } | null = null;

/**
 * Read Tailscale state. Never rejects: a missing CLI is `installed: false`,
 * an unreachable daemon is `nextStep: 'start-daemon'`. Concurrent callers
 * within the 3 s window share one set of CLI calls.
 */
export function readTailscaleState(deps: ReadTailscaleStateDeps = {}): Promise<TailscaleState> {
  const now = (deps.now ?? Date.now)();
  if (memo && now - memo.at < TAILSCALE_STATE_TTL_MS) return memo.promise;
  const promise = readUncached(deps);
  memo = { at: now, promise };
  return promise;
}

/** Drop the memo after a change (login, userspace start, serve, token mint). */
export function invalidateTailscaleStateCache(): void {
  memo = null;
}
