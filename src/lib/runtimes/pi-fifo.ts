/**
 * Pi RPC named-pipe lifecycle (PAN-636).
 *
 * Pi runs in `--mode rpc` and reads JSONL commands from stdin. We feed Pi by
 * redirecting its stdin from a per-agent fifo at:
 *
 *   ~/.panopticon/agents/<agentId>/rpc.in
 *
 * The launcher script creates the fifo, then `exec pi --mode rpc ... < <fifo>`.
 * The runtime adapter (PiRuntime.sendMessage) writes JSONL lines to the fifo.
 *
 * Why a fifo and not stdin pipe + tmux paste-buffer:
 *   - tmux paste-buffer is unreliable for JSONL (Enter timing, terminal
 *     echo, line buffering). The fifo path bypasses the TTY entirely.
 *   - Pi remains visible inside its tmux pane for crash isolation and
 *     visual debugging — only its stdin is redirected.
 *
 * Ordering invariant (hazard H1):
 *   - The launcher creates the fifo BEFORE spawning Pi.
 *   - Pi's first stdout event is `session_start` which the extension turns
 *     into ready.json under ~/.panopticon/agents/<agentId>/.
 *   - Adapter MUST wait for ready.json before opening the writer side of
 *     the fifo. Opening for write before a reader exists would block
 *     indefinitely (or, with O_NONBLOCK, fail fast with ENXIO). We use
 *     readiness-by-marker as the explicit synchronization point.
 *
 * IMPORTANT: this module performs blocking I/O (mkfifo + file open) inside
 * async helpers. NEVER call it from a dashboard server route handler — only
 * from spawnAgent and killAgent paths that run on dedicated workers.
 */

import { existsSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync, constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { Data, Effect } from 'effect'

const execAsync = promisify(exec)

export interface PiFifoPaths {
  agentDir: string
  readyPath: string
  fifoPath: string
}

export class PiNotReady extends Error {
  readonly code = 'PI_NOT_READY' as const
  constructor(message: string) {
    super(message)
    this.name = 'PiNotReady'
  }
}

export function piFifoPaths(agentId: string, home: string = homedir()): PiFifoPaths {
  const agentDir = join(home, '.panopticon', 'agents', agentId)
  return {
    agentDir,
    readyPath: join(agentDir, 'ready.json'),
    fifoPath: join(agentDir, 'rpc.in'),
  }
}

/**
 * Create the per-agent fifo. Idempotent: if a fifo (or any other inode)
 * already exists at the path, it is unlinked first so we always get a clean
 * fifo with mode 0600.
 *
 * Returns the absolute fifo path.
 */
export async function createPiFifo(agentId: string, home?: string): Promise<string> {
  const paths = piFifoPaths(agentId, home)
  mkdirSync(paths.agentDir, { recursive: true, mode: 0o700 })
  if (existsSync(paths.fifoPath)) {
    unlinkSync(paths.fifoPath)
  }
  // Node has no native mkfifo. Shell out to /usr/bin/mkfifo. -m 600 sets the
  // mode atomically. We single-quote the path to defang any unexpected shell
  // metacharacters even though agent ids are alphanumeric + dash by contract.
  await execAsync(`mkfifo -m 600 ${shellQuote(paths.fifoPath)}`)
  return paths.fifoPath
}

/**
 * Unlink the fifo. Safe to call when the fifo does not exist.
 */
export function destroyPiFifo(agentId: string, home?: string): void {
  const paths = piFifoPaths(agentId, home)
  try {
    unlinkSync(paths.fifoPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

/**
 * Write a single JSONL command to the agent's fifo.
 *
 * Throws PiNotReady (without blocking) when ready.json is not yet present —
 * the adapter is expected to wait for the Pi extension to write ready.json
 * on session_start before issuing RPC writes (hazard H1).
 *
 * Throws PiNotReady (also without blocking) when the fifo exists but Pi has
 * no read fd open — opening O_WRONLY|O_NONBLOCK on a reader-less fifo fails
 * with ENXIO. This is the typed signal that Pi died and the adapter should
 * recycle the agent rather than retry.
 *
 * The command is JSON-stringified and a single trailing newline is added so
 * Pi's JSONL parser sees one record per line.
 */
export function writePiCommand(agentId: string, command: unknown, home?: string): void {
  const paths = piFifoPaths(agentId, home)
  if (!existsSync(paths.readyPath)) {
    throw new PiNotReady(
      `Pi agent ${agentId}: ready.json not present yet (waiting for session_start)`,
    )
  }
  if (!existsSync(paths.fifoPath)) {
    throw new PiNotReady(`Pi agent ${agentId}: rpc.in fifo missing`)
  }

  let fd: number
  try {
    fd = openSync(paths.fifoPath, fsConstants.O_WRONLY | fsConstants.O_NONBLOCK)
  } catch (err) {
    const errno = (err as NodeJS.ErrnoException).code
    if (errno === 'ENXIO') {
      throw new PiNotReady(`Pi agent ${agentId}: no reader on rpc.in fifo (Pi exited?)`)
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
//
// Additive Effect-channel variants of the fifo helpers above. Sync/promise
// variants are preserved so the existing PiRuntime adapter keeps working.

/** Tagged error for pi-fifo Effect variants. */
export class PiFifoError extends Data.TaggedError('PiFifoError')<{
  readonly agentId: string
  readonly stage: 'create' | 'write' | 'destroy'
  readonly message: string
  readonly cause?: unknown
}> {}

/** Effect variant of `createPiFifo`. */
export const createPiFifoEffect = (
  agentId: string,
  home?: string,
): Effect.Effect<string, PiFifoError> =>
  Effect.tryPromise({
    try: () => createPiFifo(agentId, home),
    catch: (cause) =>
      new PiFifoError({
        agentId,
        stage: 'create',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  })

/**
 * Effect variant of `writePiCommand`. Lifts the sync FD ops via `Effect.try`.
 * The PiNotReady signal is preserved in the cause field so callers can branch.
 */
export const writePiCommandEffect = (
  agentId: string,
  command: unknown,
  home?: string,
): Effect.Effect<void, PiFifoError> =>
  Effect.try({
    try: () => writePiCommand(agentId, command, home),
    catch: (cause) =>
      new PiFifoError({
        agentId,
        stage: 'write',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  })

/** Effect variant of `destroyPiFifo`. */
export const destroyPiFifoEffect = (
  agentId: string,
  home?: string,
): Effect.Effect<void, PiFifoError> =>
  Effect.try({
    try: () => destroyPiFifo(agentId, home),
    catch: (cause) =>
      new PiFifoError({
        agentId,
        stage: 'destroy',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  })
