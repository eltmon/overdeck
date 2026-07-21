/**
 * oh-my-pi (omp) RPC named-pipe lifecycle (PAN-1989).
 *
 * omp runs in `--mode rpc` and reads JSONL commands from stdin. We feed omp by
 * redirecting its stdin from a per-agent fifo at:
 *
 *   $OVERDECK_HOME/agents/<agentId>/rpc.in
 *
 * The launcher script creates the fifo, then `exec omp --mode rpc ... < <fifo>`.
 * The runtime adapter (OhmypiRuntime.sendMessage) writes JSONL lines to the fifo.
 *
 * Why a fifo and not stdin pipe + tmux paste-buffer:
 *   - tmux paste-buffer is unreliable for JSONL (Enter timing, terminal
 *     echo, line buffering). The fifo path bypasses the TTY entirely.
 *   - omp remains visible inside its tmux pane for crash isolation and
 *     visual debugging — only its stdin is redirected.
 *
 * Ordering invariant:
 *   - The launcher creates the fifo BEFORE spawning omp.
 *   - omp's first stdout event is `session_start` which the extension turns
 *     into ready.json under $OVERDECK_HOME/agents/<agentId>/.
 *   - Adapter MUST wait for ready.json before opening the writer side of
 *     the fifo.
 *
 * IMPORTANT: this module performs blocking I/O (mkfifo + file open) inside
 * async helpers. NEVER call it from a dashboard server route handler — only
 * from spawnAgent and killAgent paths that run on dedicated workers.
 */

import { existsSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync, constants as fsConstants } from 'node:fs'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { Data, Effect } from 'effect'
import { getOverdeckHome } from '../paths.js'

const execAsync = promisify(exec)

export interface OhmypiFifoPaths {
  agentDir: string
  readyPath: string
  fifoPath: string
}

export class OhmypiNotReady extends Error {
  readonly code = 'OHMYPI_NOT_READY' as const
  constructor(message: string) {
    super(message)
    this.name = 'OhmypiNotReady'
  }
}

export function ohmypiFifoPaths(agentId: string, home?: string): OhmypiFifoPaths {
  const overdeckHome = home === undefined ? getOverdeckHome() : join(home, '.overdeck')
  const agentDir = join(overdeckHome, 'agents', agentId)
  return {
    agentDir,
    readyPath: join(agentDir, 'ready.json'),
    fifoPath: join(agentDir, 'rpc.in'),
  }
}

async function createOhmypiFifoPromise(agentId: string, home?: string): Promise<string> {
  const paths = ohmypiFifoPaths(agentId, home)
  mkdirSync(paths.agentDir, { recursive: true, mode: 0o700 })
  if (existsSync(paths.fifoPath)) {
    unlinkSync(paths.fifoPath)
  }
  await execAsync(`mkfifo -m 600 ${shellQuote(paths.fifoPath)}`)
  return paths.fifoPath
}

/**
 * Unlink the fifo. Safe to call when the fifo does not exist.
 */
export function destroyOhmypiFifoSync(agentId: string, home?: string): void {
  const paths = ohmypiFifoPaths(agentId, home)
  try {
    unlinkSync(paths.fifoPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

/**
 * Write a single JSONL command to the agent's fifo.
 *
 * Throws OhmypiNotReady (without blocking) when ready.json is not yet present.
 * Throws OhmypiNotReady when the fifo exists but omp has no read fd open (ENXIO).
 */
export function writeOhmypiCommandSync(agentId: string, command: unknown, home?: string): void {
  const paths = ohmypiFifoPaths(agentId, home)
  if (!existsSync(paths.readyPath)) {
    throw new OhmypiNotReady(
      `omp agent ${agentId}: ready.json not present yet (waiting for session_start)`,
    )
  }
  if (!existsSync(paths.fifoPath)) {
    throw new OhmypiNotReady(`omp agent ${agentId}: rpc.in fifo missing`)
  }

  let fd: number
  try {
    fd = openSync(paths.fifoPath, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK)
  } catch (err) {
    const errno = (err as NodeJS.ErrnoException).code
    if (errno === 'ENXIO') {
      throw new OhmypiNotReady(`omp agent ${agentId}: no reader on rpc.in fifo (omp exited?)`)
    }
    throw err
  }
  try {
    const line = `${JSON.stringify(command)}\n`
    writeSync(fd, line)
  } finally {
    closeSync(fd)
  }
}

// Tiny shell-arg quoter. Acceptable inputs are absolute paths under HOME.
function shellQuote(s: string): string {
  if (/^[A-Za-z0-9._/-]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Tagged error for ohmypi-fifo Effect variants. */
export class OhmypiFifoError extends Data.TaggedError('OhmypiFifoError')<{
  readonly agentId: string
  readonly stage: 'create' | 'write' | 'destroy'
  readonly message: string
  readonly cause?: unknown
}> {}

/** Effect variant of `createOhmypiFifo`. */
export const createOhmypiFifo = (
  agentId: string,
  home?: string,
): Effect.Effect<string, OhmypiFifoError> =>
  Effect.tryPromise({
    try: () => createOhmypiFifoPromise(agentId, home),
    catch: (cause) =>
      new OhmypiFifoError({
        agentId,
        stage: 'create',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  })

/** Effect variant of `writeOhmypiCommand`. */
export const writeOhmypiCommand = (
  agentId: string,
  command: unknown,
  home?: string,
): Effect.Effect<void, OhmypiFifoError> =>
  Effect.try({
    try: () => writeOhmypiCommandSync(agentId, command, home),
    catch: (cause) =>
      new OhmypiFifoError({
        agentId,
        stage: 'write',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  })

/** Effect variant of `destroyOhmypiFifo`. */
export const destroyOhmypiFifo = (
  agentId: string,
  home?: string,
): Effect.Effect<void, OhmypiFifoError> =>
  Effect.try({
    try: () => destroyOhmypiFifoSync(agentId, home),
    catch: (cause) =>
      new OhmypiFifoError({
        agentId,
        stage: 'destroy',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  })
