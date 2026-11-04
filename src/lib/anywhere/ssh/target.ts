/**
 * SSH target helpers for SSH machines (PAN-4404 WI-2).
 *
 * Every string that reaches `ssh` is built here, so injection safety can be
 * reviewed in one file:
 *
 * - the destination the operator typed is validated against a fixed grammar
 *   (D-4404-6) and always placed after `--`;
 * - the remote command string is built only from fixed tokens, an environment-id
 *   UUID and a validated absolute pan path (D-4404-4);
 * - the argv for commands and the port forward are fixed lists (D-4404-5).
 *
 * The module also classifies `ssh` failures into typed errors (D-4404-9), parses
 * the remote helper's result line and `pan --version` output, and lists the
 * concrete `Host` aliases of `~/.ssh/config` for the dialog's suggestions (FR-10).
 * It spawns nothing; `run.ts` does.
 */
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { overdeckInstallCommand, SSH_HELPER_PROTOCOL, type SshLaunch, type SshMachineErrorCode } from '@overdeck/contracts';

import { UUID_V4_LOWERCASE } from '../../environment-identity.js';

export class SshMachineError extends Error {
  constructor(
    readonly code: SshMachineErrorCode,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'SshMachineError';
  }
}

// ── Destinations ──────────────────────────────────────────────────────────

const DESTINATION_RE =
  /^(?:ssh:\/\/)?(?:[A-Za-z0-9._-]+@)?(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?$/;
const SSH_URL_PREFIX = 'ssh://';
const MAX_DESTINATION_LENGTH = 255;

function destinationProblem(dest: string): string | null {
  if (dest.length === 0) return 'is empty';
  if (dest.length > MAX_DESTINATION_LENGTH) return `is longer than ${MAX_DESTINATION_LENGTH} characters`;
  if (dest.startsWith('-')) return 'starts with "-"';
  if (!DESTINATION_RE.test(dest)) return 'is not an SSH config alias, host, user@host or ssh://user@host:port';
  const hasPrefix = dest.startsWith(SSH_URL_PREFIX);
  const rest = hasPrefix ? dest.slice(SSH_URL_PREFIX.length) : dest;
  const at = rest.indexOf('@');
  const user = at >= 0 ? rest.slice(0, at) : null;
  const hostPort = at >= 0 ? rest.slice(at + 1) : rest;
  // A user or host that starts with "-" could reach a ProxyCommand as an option.
  if (user?.startsWith('-') || hostPort.startsWith('-')) return 'has a user or host that starts with "-"';
  const portMatch = /:([0-9]{1,5})$/.exec(hostPort.startsWith('[') ? hostPort.slice(hostPort.indexOf(']') + 1) : hostPort);
  if (portMatch) {
    if (!hasPrefix) return 'has a :port without the ssh:// prefix (use ssh://host:port or an SSH config alias)';
    const port = Number(portMatch[1]);
    if (port < 1 || port > 65535) return 'has a port outside 1-65535';
  }
  return null;
}

/** Validate what the operator typed (D-4404-6). Returns it trimmed; throws `bad-destination`. */
export function validateSshDestination(input: string): string {
  const dest = typeof input === 'string' ? input.trim() : '';
  const problem = destinationProblem(dest);
  if (problem) {
    throw new SshMachineError('bad-destination', `The SSH host ${JSON.stringify(dest)} ${problem}.`, { destination: dest });
  }
  return dest;
}

/** True when `input` would pass `validateSshDestination`. */
export function isValidSshDestination(input: string): boolean {
  return destinationProblem(input.trim()) === null;
}

export interface ParsedSshDestination {
  /** Login user, when the destination names one. */
  user?: string;
  /** Host name, alias or IP; an IPv6 literal without its brackets. */
  host: string;
  /** Port, only for `ssh://…:port`. */
  port?: number;
}

/** Split a destination (validated first, D-4404-6) into user, host and port. Throws `bad-destination`. */
export function parseSshDestination(input: string): ParsedSshDestination {
  const dest = validateSshDestination(input);
  const rest = dest.startsWith(SSH_URL_PREFIX) ? dest.slice(SSH_URL_PREFIX.length) : dest;
  const at = rest.indexOf('@');
  const user = at >= 0 ? rest.slice(0, at) : undefined;
  let hostPort = at >= 0 ? rest.slice(at + 1) : rest;
  let port: number | undefined;
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    const tail = hostPort.slice(close + 1);
    if (tail.startsWith(':')) port = Number(tail.slice(1));
    hostPort = hostPort.slice(1, close);
  } else {
    const colon = hostPort.lastIndexOf(':');
    if (colon >= 0) {
      port = Number(hostPort.slice(colon + 1));
      hostPort = hostPort.slice(0, colon);
    }
  }
  return { ...(user !== undefined ? { user } : {}), host: hostPort, ...(port !== undefined ? { port } : {}) };
}

/** Key of the local host lock: the destination lowercased without `ssh://`. */
export function sshLockKey(dest: string): string {
  const lower = dest.trim().toLowerCase();
  return lower.startsWith(SSH_URL_PREFIX) ? lower.slice(SSH_URL_PREFIX.length) : lower;
}

// ── Remote command ────────────────────────────────────────────────────────

const PAN_PATH_RE = /^\/[A-Za-z0-9._/-]{1,255}$/;

/** Validate an absolute path to `pan` on the host. Throws `bad-destination`. */
export function validatePanPath(path: string): string {
  if (typeof path !== 'string' || !PAN_PATH_RE.test(path)) {
    throw new SshMachineError(
      'bad-destination',
      `The pan path ${JSON.stringify(path)} must be an absolute path of letters, digits, ".", "_", "-" and "/".`,
      { panPath: path },
    );
  }
  return path;
}

export type RemoteOp = 'version' | 'start' | 'start-no-pair' | 'stop';

export interface RemoteCommandArgs {
  /** Absolute path to `pan` on the host, or null for `pan` from the login PATH. */
  pan: string | null;
  op: RemoteOp;
  /** This machine's environment id; required for every op except `version`. */
  linker?: string;
}

function requireLinker(linker: string | undefined): string {
  if (typeof linker !== 'string' || !UUID_V4_LOWERCASE.test(linker)) {
    throw new Error(`remoteCommand: linker must be an environment-id UUID, got ${JSON.stringify(linker)}`);
  }
  return linker;
}

/**
 * The command string sshd hands to the host's login shell (D-4404-4). The outer
 * `sh -c` makes it work under any login shell (fish included); the inner
 * `"$SHELL" -lc` gives `pan` a login environment (nvm, ~/.local/bin).
 */
export function remoteCommand(args: RemoteCommandArgs): string {
  const pan = args.pan === null ? 'pan' : validatePanPath(args.pan);
  let rest: string;
  switch (args.op) {
    case 'version':
      rest = '--version';
      break;
    case 'start':
      rest = `machines ssh-helper start --linker ${requireLinker(args.linker)} --json`;
      break;
    case 'start-no-pair':
      rest = `machines ssh-helper start --linker ${requireLinker(args.linker)} --no-pair --json`;
      break;
    case 'stop':
      rest = `machines ssh-helper stop --linker ${requireLinker(args.linker)} --json`;
      break;
    default:
      throw new Error(`remoteCommand: unknown op ${JSON.stringify((args as { op: unknown }).op)}`);
  }
  return `sh -c 'exec "\${SHELL:-/bin/sh}" -lc "${pan} ${rest}"'`;
}

// ── argv ──────────────────────────────────────────────────────────────────

const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];

function requirePort(port: number, name: string): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a TCP port, got ${String(port)}`);
  }
  return port;
}

/** argv for one command over SSH (D-4404-5). */
export function sshCommandArgv(dest: string, command: string): string[] {
  return ['-T', ...SSH_OPTIONS, '--', validateSshDestination(dest), command];
}

/** argv for the long-running loopback port forward (D-4404-5). */
export function sshForwardArgv(dest: string, localPort: number, remotePort: number): string[] {
  const lp = requirePort(localPort, 'localPort');
  const rp = requirePort(remotePort, 'remotePort');
  return [
    ...SSH_OPTIONS,
    '-N',
    '-o',
    'ExitOnForwardFailure=yes',
    '-L',
    `127.0.0.1:${lp}:127.0.0.1:${rp}`,
    '--',
    validateSshDestination(dest),
  ];
}

// ── Failure classification ────────────────────────────────────────────────

function lastLines(text: string, count: number): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-count)
    .join('\n');
}

export interface ClassifyContext {
  destination?: string;
  /** This machine's pan version, named in the `pan-missing` remedy. */
  localVersion?: string;
}

/** Map a failed `ssh` run to a typed error (D-4404-9). */
export function classifySshFailure(exitCode: number | null, stderr: string, ctx: ClassifyContext = {}): SshMachineError {
  const dest = ctx.destination ?? 'the host';
  const tail = lastLines(stderr, 5);
  const detail = { exitCode, stderr: tail };
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/.test(stderr)) {
    return new SshMachineError(
      'host-key',
      `The host key of ${dest} is unknown or has changed. Run "ssh ${dest}" once in a terminal on this machine to check it, then try again.`,
      detail,
    );
  }
  // ssh writes "Permission denied (publickey,…)." A remote shell's
  // "…/pan: Permission denied" ends the line instead, and is not a login failure.
  if (/Permission denied[ (,]/.test(stderr)) {
    return new SshMachineError(
      'auth-failed',
      `SSH refused the login to ${dest}. The dashboard needs a key or SSH agent it can use without a prompt.`,
      detail,
    );
  }
  if (/Could not resolve hostname/.test(stderr)) {
    return new SshMachineError('unresolvable', `Could not resolve the host name of ${dest}.`, detail);
  }
  if (/Connection refused|Connection timed out|No route to host|Network is unreachable|Operation timed out/.test(stderr)) {
    return new SshMachineError('unreachable', `Could not connect to ${dest}: ${lastLines(stderr, 1)}`, detail);
  }
  if (exitCode === 127 || /command not found|pan: not found/.test(stderr)) {
    const remedy = ctx.localVersion ? ` Install it there with: ${overdeckInstallCommand(ctx.localVersion)}` : '';
    return new SshMachineError('pan-missing', `pan was not found on ${dest}.${remedy}`, detail);
  }
  return new SshMachineError(
    'helper-failed',
    `SSH to ${dest} failed${exitCode === null ? '' : ` (exit ${exitCode})`}${tail ? `: ${tail}` : '.'}`,
    detail,
  );
}

// ── Helper result line ────────────────────────────────────────────────────

/** Prefix of the one stdout line `pan machines ssh-helper` prints. */
export const HELPER_RESULT_SENTINEL = 'OVERDECK_SSH_HELPER ';

export type HelperStopReason = 'stopped' | 'not-running' | 'external' | 'restarted' | 'in-use';

export interface HelperStartResult {
  v: typeof SSH_HELPER_PROTOCOL;
  ok: true;
  op: 'start';
  launch: SshLaunch;
  apiPort: number;
  environmentId: string;
  label: string;
  serverVersion: string;
  panVersion: string;
  /** One-time pairing credential; null with `--no-pair`. */
  pairing: { credential: string; expiresAt: string } | null;
}

export interface HelperStopResult {
  v: typeof SSH_HELPER_PROTOCOL;
  ok: true;
  op: 'stop';
  stopped: boolean;
  reason: HelperStopReason;
}

export interface HelperFailure {
  v: typeof SSH_HELPER_PROTOCOL;
  ok: false;
  error: string;
  message: string;
}

export type HelperResult = HelperStartResult | HelperStopResult | HelperFailure;

const STOP_REASONS: ReadonlySet<string> = new Set<HelperStopReason>(['stopped', 'not-running', 'external', 'restarted', 'in-use']);

function isHelperResult(value: unknown): value is HelperResult {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  if (r.v !== SSH_HELPER_PROTOCOL) return false;
  if (r.ok === false) return typeof r.error === 'string' && typeof r.message === 'string';
  if (r.ok !== true) return false;
  if (r.op === 'stop') return typeof r.stopped === 'boolean' && typeof r.reason === 'string' && STOP_REASONS.has(r.reason);
  if (r.op !== 'start') return false;
  const pairing = r.pairing as Record<string, unknown> | null | undefined;
  return (
    (r.launch === 'managed' || r.launch === 'external') &&
    typeof r.apiPort === 'number' &&
    typeof r.environmentId === 'string' &&
    typeof r.label === 'string' &&
    typeof r.serverVersion === 'string' &&
    typeof r.panVersion === 'string' &&
    (pairing === null ||
      (typeof pairing === 'object' && pairing !== undefined && typeof pairing.credential === 'string' && typeof pairing.expiresAt === 'string'))
  );
}

/** The result line the helper prints. */
export function formatHelperResult(result: HelperResult): string {
  return `${HELPER_RESULT_SENTINEL}${JSON.stringify(result)}`;
}

/**
 * The last helper result line in `stdout`, ignoring login banners and profile
 * output. Null when there is none, or the last one is not a valid result.
 */
export function parseHelperResult(stdout: string): HelperResult | null {
  const line = stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith(HELPER_RESULT_SENTINEL))
    .at(-1);
  if (line === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(line.slice(HELPER_RESULT_SENTINEL.length));
    return isHelperResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const VERSION_LINE_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The last stdout line that is a bare semver (D-4404-2), or null. */
export function parseVersionOutput(stdout: string): string | null {
  return (
    stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => VERSION_LINE_RE.test(l))
      .at(-1) ?? null
  );
}

// ── ~/.ssh/config aliases ─────────────────────────────────────────────────

export interface SshConfigIo {
  readFile(path: string): Promise<string>;
  readdir(dir: string): Promise<string[]>;
}

export const nodeSshConfigIo: SshConfigIo = {
  readFile: (path) => readFile(path, 'utf8'),
  readdir: (dir) => readdir(dir),
};

const MAX_INCLUDE_DEPTH = 3;

/** Split a config value into words, honoring double quotes. */
function configWords(value: string): string[] {
  const words: string[] = [];
  for (const match of value.matchAll(/"([^"]*)"|(\S+)/g)) words.push(match[1] ?? match[2] ?? '');
  return words.filter((w) => w.length > 0);
}

function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${body}$`);
}

async function expandInclude(io: SshConfigIo, sshDir: string, homeDir: string, pattern: string): Promise<string[]> {
  let path = pattern.startsWith('~/') ? join(homeDir, pattern.slice(2)) : pattern;
  if (!isAbsolute(path)) path = join(sshDir, path);
  const name = basename(path);
  if (!/[*?]/.test(name)) return [path];
  const dir = dirname(path);
  try {
    const re = globToRegExp(name);
    return (await io.readdir(dir))
      .filter((entry) => re.test(entry))
      .sort()
      .map((entry) => join(dir, entry));
  } catch {
    return [];
  }
}

async function collectAliases(
  io: SshConfigIo,
  sshDir: string,
  homeDir: string,
  path: string,
  depth: number,
  out: Set<string>,
): Promise<void> {
  let text: string;
  try {
    text = await io.readFile(path);
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const match = /^(\S+?)(?:\s*=\s*|\s+)(.+)$/.exec(line);
    if (!match) continue;
    const keyword = match[1]!.toLowerCase();
    const words = configWords(match[2]!);
    if (keyword === 'host') {
      for (const alias of words) {
        if (/[*?!]/.test(alias)) continue;
        if (isValidSshDestination(alias)) out.add(alias);
      }
    } else if (keyword === 'include' && depth < MAX_INCLUDE_DEPTH) {
      for (const pattern of words) {
        for (const included of await expandInclude(io, sshDir, homeDir, pattern)) {
          await collectAliases(io, sshDir, homeDir, included, depth + 1, out);
        }
      }
    }
  }
}

/**
 * Concrete `Host` aliases of `~/.ssh/config` and the files it `Include`s (FR-10):
 * no patterns (`*`, `?`, `!`), sorted and unique. A missing file gives `[]`.
 */
export async function listSshConfigAliases(io: SshConfigIo, homeDir: string): Promise<string[]> {
  const sshDir = join(homeDir, '.ssh');
  const out = new Set<string>();
  await collectAliases(io, sshDir, homeDir, join(sshDir, 'config'), 0, out);
  return [...out].sort();
}
