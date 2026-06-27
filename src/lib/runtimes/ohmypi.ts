/**
 * oh-my-pi (omp) coding agent runtime adapter (PAN-1989).
 *
 * Implements AgentRuntime for the `omp` binary running in --mode rpc. The
 * adapter wires together three pieces:
 *
 *   - ohmypi-fifo.ts      — per-agent rpc.in named pipe lifecycle
 *   - launcher-generator  — emits the `exec omp --mode rpc ... < <fifo>` script
 *   - ohmypi-extension    — the vendored extension that writes ready.json,
 *                           heartbeats, and /pan-done markers from inside omp
 *
 * Spawn flow:
 *   1. mkdir agent dir
 *   2. createOhmypiFifo
 *   3. write launcher.sh via generateLauncherScript({ harness: 'ohmypi', ... })
 *   4. tmux new-session running launcher.sh
 *   5. wait for ~/.overdeck/agents/<id>/ready.json (max 120s)
 *
 * Runtime divergences vs pi (omp contract AC-1b, AC-3):
 *   - omp binary requires Bun >=1.3.14 (shebang #!/usr/bin/env bun).
 *   - Resume flag: `--resume <id>` (NOT `--session <id>` which omp accepts but
 *     silently ignores for resume — see AC-3 in docs/ohmypi-contract.md).
 *   - `--no-context-files` is removed; drop it from the launcher command.
 */

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { exec } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import type {
  AgentRuntime,
  AgentRuntimeSync,
  AgentRuntimeError,
  Heartbeat,
  TokenUsage,
  CostBreakdown,
  Session,
  SpawnConfig,
  Agent,
} from './types.js'
import { sessionExists, killSession, createSession, listSessionsSync } from '../tmux.js'
import { parseOhmypiSessionSync } from '../cost-parsers/ohmypi-parser.js'
import { generateLauncherScriptSync } from '../launcher-generator.js'
import { createOhmypiFifo, destroyOhmypiFifoSync, writeOhmypiCommandSync, ohmypiFifoPaths, OhmypiNotReady } from './ohmypi-fifo.js'
import { ProcessSpawnError, ProcessTimeoutError, TmuxError } from '../errors.js'
import { getOverdeckHome } from '../paths.js'

const execAsync = promisify(exec)

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const ACTIVE_HEARTBEAT_TTL_MS = 60_000
const SPAWN_READY_TIMEOUT_MS = 120_000

function overdeckDir(): string {
  return getOverdeckHome()
}
function heartbeatsDir(): string {
  return join(overdeckDir(), 'heartbeats')
}
function agentsDir(): string {
  return join(overdeckDir(), 'agents')
}

export class OhmypiSpawnTimeout extends Error {
  readonly code = 'OHMYPI_SPAWN_TIMEOUT' as const
  constructor(agentId: string) {
    super(`omp agent ${agentId} did not write ready.json within ${SPAWN_READY_TIMEOUT_MS}ms${describeSpawnFailure(agentId)}`)
    this.name = 'OhmypiSpawnTimeout'
  }
}

export interface OhmypiSpawnConfig extends SpawnConfig {
  /** Absolute path to packages/ohmypi-extension/dist/index.js. */
  piExtensionPath: string
  /** Optional extra args appended to the `omp` command line. */
  extraPiArgs?: string
}

function agentDirFor(agentId: string): string {
  return join(agentsDir(), agentId)
}

function describeSpawnFailure(agentId: string): string {
  const outputPath = join(agentDirFor(agentId), 'output.log')
  if (!existsSync(outputPath)) return ''
  try {
    const tail = readFileSync(outputPath, 'utf8').slice(-1500).trim().split('\n').slice(-8).join('\n')
    return tail ? ` [output.log tail:\n${tail}]` : ''
  } catch {
    return ''
  }
}

function ohmypiSessionDirFor(agentId: string): string {
  return join(agentDirFor(agentId), 'sessions')
}

function readyPathFor(agentId: string): string {
  return ohmypiFifoPaths(agentId).readyPath
}

function sessionIdPathFor(agentId: string): string {
  return join(agentDirFor(agentId), 'session.id')
}

/**
 * Read the persisted omp session id for resume.
 * Returns null when the file is absent or unreadable.
 */
function readStoredSessionId(agentId: string): string | null {
  const path = sessionIdPathFor(agentId)
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf8').trim()
    return raw || null
  } catch {
    return null
  }
}

/**
 * Resolve the real omp session id from the freshest session JSONL (PAN-1988 parity).
 * Returns null when no prior session exists on disk.
 *
 * Exported (PAN-2098) so the generic recovery path in agents.ts
 * (`getLatestSessionIdSync`) can resume a crashed ohmypi agent — omp never
 * writes a `session.id` file, so without this fallback the deacon reports
 * "no saved session id" and can only respawn fresh, losing context.
 */
export function resolveLatestOhmypiSessionId(agentId: string): string | null {
  const root = ohmypiSessionDirFor(agentId)
  if (!existsSync(root)) return null
  const files: { path: string; mtime: number }[] = []
  walkJsonl(root, files)
  if (files.length === 0) return null
  files.sort((a, b) => b.mtime - a.mtime)
  const parsed = parseOhmypiSessionSync(files[0]!.path)
  return parsed?.sessionId ?? null
}

export class OhmypiRuntimeSync implements AgentRuntimeSync {
  readonly name = 'ohmypi' as const

  getSessionPath(agentId: string): string | null {
    const root = ohmypiSessionDirFor(agentId)
    if (!existsSync(root)) return null
    const files: { path: string; mtime: number }[] = []
    walkJsonl(root, files)
    if (files.length === 0) return null
    files.sort((a, b) => b.mtime - a.mtime)
    return files[0]!.path
  }

  getLastActivity(agentId: string): Date | null {
    const session = this.getSessionPath(agentId)
    if (!session) return null
    try {
      return statSync(session).mtime
    } catch {
      return null
    }
  }

  getHeartbeat(agentId: string): Heartbeat | null {
    // 1. Fresh active heartbeat (<60s old).
    const heartbeatPath = join(heartbeatsDir(), `${agentId}.json`)
    if (existsSync(heartbeatPath)) {
      try {
        const data = JSON.parse(readFileSync(heartbeatPath, 'utf-8')) as {
          timestamp?: string
          tool_name?: string
          last_action?: string
          pid?: number
        }
        if (data.timestamp) {
          const ts = new Date(data.timestamp)
          if (Date.now() - ts.getTime() < ACTIVE_HEARTBEAT_TTL_MS) {
            return {
              timestamp: ts,
              agentId,
              source: 'active-heartbeat',
              confidence: 'high',
              toolName: data.tool_name,
              lastAction: data.last_action,
              pid: data.pid,
            }
          }
        }
      } catch {
        // fall through
      }
    }

    // 2. JSONL mtime.
    const lastActivity = this.getLastActivity(agentId)
    if (lastActivity) {
      return {
        timestamp: lastActivity,
        agentId,
        source: 'jsonl',
        confidence: 'medium',
      }
    }

    // 3. tmux session creation time (best-effort).
    try {
      const sess = listSessionsSync().find(s => s.name === agentId)
      if (sess) {
        return {
          timestamp: sess.created,
          agentId,
          source: 'tmux',
          confidence: 'low',
        }
      }
    } catch {
      // ignore
    }
    return null
  }

  getTokenUsage(agentId: string): TokenUsage | null {
    const session = this.getSessionPath(agentId)
    if (!session) return null
    const parsed = parseOhmypiSessionSync(session)
    return parsed?.usage ?? null
  }

  getSessionCost(agentId: string): CostBreakdown | null {
    const session = this.getSessionPath(agentId)
    if (!session) return null
    const parsed = parseOhmypiSessionSync(session)
    if (!parsed) return null
    const totalCost = parsed.cost_v2 ?? parsed.cost ?? 0
    return {
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      totalCost,
      currency: 'USD',
    }
  }

  async sendMessage(agentId: string, message: string): Promise<void> {
    if (!existsSync(readyPathFor(agentId))) {
      throw new OhmypiNotReady(`omp agent ${agentId}: ready.json not present yet`)
    }
    writeOhmypiCommandSync(agentId, { id: randomUUID(), type: 'prompt', message })
  }

  /**
   * Kill an omp agent via the documented escalation ladder.
   *
   *   1. Send {cmd:'abort'} via the RPC fifo (graceful).
   *   2. Wait up to 2s for the tmux session to disappear on its own.
   *   3. SIGTERM the omp process group via tmux send-signal.
   *   4. Wait up to 5s for the tmux session to disappear.
   *   5. tmux kill-session (effectively SIGKILL).
   *   6. Always unlink rpc.in, ready.json, heartbeat, and completed marker.
   *      NEVER touch session JSONL files — per JSONL-is-sacred rule.
   */
  async killAgent(agentId: string): Promise<void> {
    // Step 1: graceful RPC abort.
    try {
      writeOhmypiCommandSync(agentId, { id: randomUUID(), type: 'abort' })
    } catch {
      // No reader / not ready — fall through to signal escalation.
    }

    // Step 2: poll for tmux exit up to 2s.
    if (await pollUntilSessionGone(agentId, 2_000)) {
      cleanupOhmypiTransientFiles(agentId)
      return
    }

    // Step 3: SIGTERM via tmux.
    try {
      await execAsync(`tmux -L overdeck send-keys -t ${agentId} C-c 2>/dev/null || true`)
    } catch {
      // ignore
    }
    try {
      const { stdout } = await execAsync(
        `tmux -L overdeck list-panes -t ${shellQuote(agentId)} -F '#{pane_pid}' 2>/dev/null`
      )
      const pid = stdout.trim()
      if (pid) {
        await execAsync(`kill -TERM -- -${pid} 2>/dev/null || kill -TERM ${pid} 2>/dev/null || true`)
      }
    } catch {
      // ignore
    }

    // Step 4: poll for tmux exit up to another 5s.
    if (await pollUntilSessionGone(agentId, 5_000)) {
      cleanupOhmypiTransientFiles(agentId)
      return
    }

    // Step 5: SIGKILL fallback via tmux kill-session.
    try {
      if (await Effect.runPromise(sessionExists(agentId))) {
        await Effect.runPromise(killSession(agentId))
      }
    } finally {
      cleanupOhmypiTransientFiles(agentId)
    }
  }

  async spawnAgent(config: SpawnConfig & { piExtensionPath?: string }): Promise<Agent> {
    const piExtensionPath = config.piExtensionPath
    if (!piExtensionPath) {
      throw new Error('OhmypiRuntime.spawnAgent requires piExtensionPath in config')
    }

    const agentId = config.agentId
    const dir = agentDirFor(agentId)
    const sessionDir = ohmypiSessionDirFor(agentId)
    const hadPriorSpawn = existsSync(sessionDir) &&
      readdirSync(sessionDir).some((f) => f.endsWith('.jsonl'))
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    mkdirSync(sessionDir, { recursive: true, mode: 0o700 })

    const fifoPath = await Effect.runPromise(createOhmypiFifo(agentId))

    const promptFile = config.prompt ? writeAgentPromptFile(agentId, config.prompt) : undefined

    // Resume from the stored session.id when present, else recover from the
    // freshest session JSONL (PAN-1988 parity). omp uses --resume (not --session).
    const resumeSessionId = readStoredSessionId(agentId) ?? resolveLatestOhmypiSessionId(agentId) ?? undefined
    if (!resumeSessionId && hadPriorSpawn) {
      console.warn(
        `[ohmypi-runtime] ${agentId}: prior session.jsonl exists but no resumable session id found — spawning a fresh omp session`,
      )
    }

    const launcherScript = generateLauncherScriptSync({
      role: 'work',
      workingDir: config.workspace,
      harness: 'ohmypi',
      piExtensionPath,
      piFifoPath: fifoPath,
      piSessionDir: sessionDir,
      model: config.model,
      promptFile,
      resumeSessionId,
      overdeckEnv: { agentId },
      setTerminalEnv: true,
      trapHup: true,
    })

    const launcherPath = join(dir, 'ohmypi-launcher.sh')
    writeFileSync(launcherPath, launcherScript)
    chmodSync(launcherPath, 0o755)

    await Effect.runPromise(createSession(agentId, config.workspace, `bash ${launcherPath}`, {
      env: { OVERDECK_AGENT_ID: agentId },
    }))

    await waitForReady(agentId, SPAWN_READY_TIMEOUT_MS)

    const readyData = readReady(agentId)
    return {
      id: agentId,
      sessionId: readyData?.sessionId ?? 'unknown',
      runtime: 'ohmypi',
      model: config.model ?? 'unknown',
      workspace: config.workspace,
      startedAt: new Date(),
    }
  }

  listSessions(workspace?: string): Session[] {
    const sessions: Session[] = []
    const root = agentsDir()
    if (!existsSync(root)) return sessions
    for (const agentName of safeReaddir(root)) {
      const sessionRoot = ohmypiSessionDirFor(agentName)
      if (!existsSync(sessionRoot)) continue
      const files: { path: string; mtime: number }[] = []
      walkJsonl(sessionRoot, files)
      for (const file of files) {
        const parsed = parseOhmypiSessionSync(file.path)
        if (!parsed) continue
        sessions.push({
          id: parsed.sessionId,
          agentId: agentName,
          workspace: workspace ?? 'unknown',
          model: parsed.model,
          startedAt: new Date(parsed.startTime),
          lastActivity: new Date(file.mtime),
          tokenUsage: parsed.usage,
        })
      }
    }
    return sessions
  }

  async isRunning(agentId: string): Promise<boolean> {
    return await Effect.runPromise(sessionExists(agentId))
  }
}

export function createOhmypiRuntimeSync(): OhmypiRuntimeSync {
  return new OhmypiRuntimeSync()
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

export class OhmypiRuntime implements AgentRuntime {
  readonly name = 'ohmypi' as const
  private readonly inner: OhmypiRuntimeSync

  constructor(inner: OhmypiRuntimeSync = new OhmypiRuntimeSync()) {
    this.inner = inner
  }

  getSessionPath(agentId: string): string | null {
    return this.inner.getSessionPath(agentId)
  }
  getLastActivity(agentId: string): Date | null {
    return this.inner.getLastActivity(agentId)
  }
  getHeartbeat(agentId: string): Heartbeat | null {
    return this.inner.getHeartbeat(agentId)
  }
  getTokenUsage(agentId: string): TokenUsage | null {
    return this.inner.getTokenUsage(agentId)
  }
  getSessionCost(agentId: string): CostBreakdown | null {
    return this.inner.getSessionCost(agentId)
  }
  listSessions(workspace?: string): Session[] {
    return this.inner.listSessions(workspace)
  }

  sendMessage(agentId: string, message: string): Effect.Effect<void, AgentRuntimeError> {
    return Effect.tryPromise({
      try: () => Promise.resolve(this.inner.sendMessage(agentId, message)),
      catch: (cause) =>
        new TmuxError({
          command: 'rpc-write',
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    })
  }

  killAgent(agentId: string): Effect.Effect<void, AgentRuntimeError> {
    return Effect.tryPromise({
      try: () => this.inner.killAgent(agentId),
      catch: (cause) =>
        new TmuxError({
          command: 'kill-session',
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    })
  }

  spawnAgent(config: SpawnConfig): Effect.Effect<Agent, AgentRuntimeError> {
    return Effect.tryPromise({
      try: () => this.inner.spawnAgent(config),
      catch: (cause) => {
        if (cause instanceof OhmypiSpawnTimeout) {
          return new ProcessTimeoutError({
            command: 'omp',
            args: ['--mode', 'rpc'],
            timeoutMs: SPAWN_READY_TIMEOUT_MS,
          })
        }
        return new ProcessSpawnError({
          command: 'omp',
          args: ['--mode', 'rpc'],
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        })
      },
    })
  }

  isRunning(agentId: string): Effect.Effect<boolean> {
    return Effect.promise(() => this.inner.isRunning(agentId))
  }
}

export function createOhmypiRuntime(): OhmypiRuntime {
  return new OhmypiRuntime()
}

// ────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────

async function pollUntilSessionGone(agentId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await Effect.runPromise(sessionExists(agentId)))) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}

/**
 * Remove omp's transient per-agent files: rpc.in fifo, ready.json,
 * heartbeats/<id>.json, completed marker. Never touches session JSONLs
 * under <agentDir>/sessions/ — those are sacred (CLAUDE.md).
 */
function cleanupOhmypiTransientFiles(agentId: string): void {
  try { destroyOhmypiFifoSync(agentId) } catch { /* ignore */ }
  const dir = agentDirFor(agentId)
  for (const transient of ['ready.json', 'completed']) {
    const path = join(dir, transient)
    if (existsSync(path)) {
      try { unlinkSync(path) } catch { /* ignore */ }
    }
  }
  const heartbeatPath = join(heartbeatsDir(), `${agentId}.json`)
  if (existsSync(heartbeatPath)) {
    try { unlinkSync(heartbeatPath) } catch { /* ignore */ }
  }
  // Sacred: NEVER touch <dir>/sessions/*.jsonl — JSONLs are conversation history.
}

function readReady(agentId: string): { sessionId?: string; reason?: string } | null {
  const path = readyPathFor(agentId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

async function waitForReady(agentId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const path = readyPathFor(agentId)
  while (Date.now() < deadline) {
    if (existsSync(path)) return
    await new Promise(r => setTimeout(r, 100))
  }
  throw new OhmypiSpawnTimeout(agentId)
}

function writeAgentPromptFile(agentId: string, prompt: string): string {
  const promptPath = join(agentDirFor(agentId), 'prompt.txt')
  writeFileSync(promptPath, prompt)
  return promptPath
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function walkJsonl(dir: string, out: { path: string; mtime: number }[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      walkJsonl(full, out)
    } else if (stat.isFile() && entry.endsWith('.jsonl')) {
      out.push({ path: full, mtime: stat.mtime.getTime() })
    }
  }
}

// Keep imports referenced even when only the types are used.
void execAsync
void tmpdir
