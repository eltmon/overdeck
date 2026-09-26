/**
 * Prime Agent storage (PAN-3668 WI-7, D2, D7): the only place that knows where an
 * Overdeck-launched Prime Agent keeps its session JSONL and its private daemon socket.
 *
 * - Sessions: `<agentsRoot>/<agentId>/prime-sessions/` (passed to `--session-dir`).
 * - Session pointer: `<agentsRoot>/<agentId>/prime-agent-session-file` holds the absolute
 *   `sessionFile` from `get_state`. It is a different value from the `sessionId` (D7).
 * - Daemon socket: `$OVERDECK_HOME/sockets/pd-<first 16 hex of sha256(agentId)>.sock`
 *   (passed to `--daemon-socket`). The hash keeps the path under the unix socket limit.
 * - Prime's own credential store: `~/.prime/agent/auth.json`. Overdeck reads its key
 *   names only (D12) and never writes under `~/.prime/agent`.
 *
 * Leaf module: imports only `node:*` and `../../paths.js`, so any layer can import it
 * without creating a cycle. `npm run lint:harness-storage` keeps these paths from being
 * rebuilt anywhere else.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getOverdeckHome } from '../../paths.js';

export const PRIME_AGENT_SESSION_DIR = 'prime-sessions';
export const PRIME_AGENT_SESSION_FILE_POINTER = 'prime-agent-session-file';
export const PRIME_AGENT_STATS_FILE = 'prime-agent-stats.json';
export const PRIME_AGENT_CONTEXT_FILE = 'prime-agent-context.md';

/** Prime Agent's own credential file (key names are read, values never). */
export function primeAgentAuthFilePath(home = homedir()): string {
  return join(home, '.prime', 'agent', 'auth.json');
}

/** Unix socket paths above this many bytes fail to bind on Linux and macOS (NFR-9). */
export const PRIME_AGENT_SOCKET_PATH_MAX_BYTES = 100;

export class PrimeAgentSocketPathTooLong extends Error {
  readonly path: string;
  readonly bytes: number;

  constructor(path: string, bytes: number) {
    super(
      `Prime Agent daemon socket path is ${bytes} bytes, over the ${PRIME_AGENT_SOCKET_PATH_MAX_BYTES}-byte unix socket limit: ${path}. ` +
        'Set OVERDECK_HOME to a shorter directory, then launch the agent again. No Prime Agent process was started.',
    );
    this.name = 'PrimeAgentSocketPathTooLong';
    this.path = path;
    this.bytes = bytes;
  }
}

function assertAgentIdentity(agentId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) throw new Error('Invalid Prime Agent agent identity');
}

function agentDir(agentId: string, agentsRoot: string): string {
  assertAgentIdentity(agentId);
  return join(agentsRoot, agentId);
}

export function primeAgentSessionDir(agentId: string, agentsRoot = join(getOverdeckHome(), 'agents')): string {
  return join(agentDir(agentId, agentsRoot), PRIME_AGENT_SESSION_DIR);
}

export function primeAgentSessionFilePointerPath(agentId: string, agentsRoot = join(getOverdeckHome(), 'agents')): string {
  return join(agentDir(agentId, agentsRoot), PRIME_AGENT_SESSION_FILE_POINTER);
}

/** Whether `path` is a Prime Agent session transcript (`…/prime-sessions/…jsonl`). */
export function isPrimeAgentSessionPath(path: string): boolean {
  return path.includes(`/${PRIME_AGENT_SESSION_DIR}/`) && path.endsWith('.jsonl');
}

/**
 * The recorded `sessionFile` for an agent, or null when the pointer is missing, empty,
 * or names a file that no longer exists.
 */
export async function readPrimeAgentSessionFile(agentId: string, agentsRoot?: string): Promise<string | null> {
  const pointer = await readFile(primeAgentSessionFilePointerPath(agentId, agentsRoot), 'utf8').catch(() => null);
  const sessionFile = pointer?.trim();
  if (!sessionFile) return null;
  const info = await stat(sessionFile).catch(() => null);
  return info?.isFile() ? sessionFile : null;
}

/**
 * The recorded `sessionFile` for a resume (D7). A resume whose session file is gone
 * fails loudly rather than silently starting a fresh session.
 */
export async function requirePrimeAgentSessionFile(agentId: string, agentsRoot?: string): Promise<string> {
  const sessionFile = await readPrimeAgentSessionFile(agentId, agentsRoot);
  if (!sessionFile) {
    throw new Error(`Prime Agent session for ${agentId} cannot be resumed: its recorded session file is missing. Start a new session instead.`);
  }
  return sessionFile;
}

/** The per-agent Prime daemon socket (D2). Throws PrimeAgentSocketPathTooLong over 100 bytes. */
export function primeAgentDaemonSocketPath(agentId: string, home = getOverdeckHome()): string {
  const digest = createHash('sha256').update(agentId).digest('hex').slice(0, 16);
  const path = join(home, 'sockets', `pd-${digest}.sock`);
  const bytes = Buffer.byteLength(path);
  if (bytes > PRIME_AGENT_SOCKET_PATH_MAX_BYTES) throw new PrimeAgentSocketPathTooLong(path, bytes);
  return path;
}

/** Whether `socketPath` is an Overdeck-owned per-agent Prime daemon socket under `home`. */
export function isPrimeAgentDaemonSocketPath(socketPath: string, home = getOverdeckHome()): boolean {
  return new RegExp(`^${escapeRegExp(join(home, 'sockets'))}/pd-[0-9a-f]{16}\\.sock$`).test(socketPath);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
