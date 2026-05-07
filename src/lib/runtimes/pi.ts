/**
 * Pi Coding Agent runtime adapter (PAN-636).
 *
 * Implements AgentRuntime for the `pi` binary running in --mode rpc. The
 * adapter wires together three pieces:
 *
 *   - pi-fifo.ts         — per-agent rpc.in named pipe lifecycle
 *   - launcher-generator — emits the `exec pi --mode rpc ... < <fifo>` script
 *   - pi-extension       — the vendored extension that writes ready.json,
 *                          heartbeats, and /pan-done markers from inside Pi
 *
 * Spawn flow:
 *   1. mkdir agent dir
 *   2. createPiFifo
 *   3. write launcher.sh via generateLauncherScript({ harness: 'pi', ... })
 *   4. tmux new-session running launcher.sh
 *   5. wait for ~/.panopticon/agents/<id>/ready.json (max 30s)
 *
 * Heartbeat sources (in priority order):
 *   1. fresh (<60s) ~/.panopticon/heartbeats/<id>.json — written by the
 *      extension on tool_execution_end / turn_end
 *   2. mtime of the active session JSONL under <agentDir>/sessions/
 *   3. tmux pane activity timestamp
 */

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { exec } from 'node:child_process'
import type {
  AgentRuntime,
  Heartbeat,
  TokenUsage,
  CostBreakdown,
  Session,
  SpawnConfig,
  Agent,
} from './types.js'
import { sessionExistsAsync, killSessionAsync, createSessionAsync, listSessions } from '../tmux.js'
import { parsePiSession } from '../cost-parsers/pi-parser.js'
import { generateLauncherScript } from '../launcher-generator.js'
import { createPiFifo, destroyPiFifo, writePiCommand, piFifoPaths, PiNotReady } from './pi-fifo.js'

const execAsync = promisify(exec)

const ACTIVE_HEARTBEAT_TTL_MS = 60_000
const SPAWN_READY_TIMEOUT_MS = 30_000

function panopticonDir(): string {
  return join(homedir(), '.panopticon')
}
function heartbeatsDir(): string {
  return join(panopticonDir(), 'heartbeats')
}
function agentsDir(): string {
  return join(panopticonDir(), 'agents')
}

export class PiSpawnTimeout extends Error {
  readonly code = 'PI_SPAWN_TIMEOUT' as const
  constructor(agentId: string) {
    super(`Pi agent ${agentId} did not write ready.json within ${SPAWN_READY_TIMEOUT_MS}ms`)
    this.name = 'PiSpawnTimeout'
  }
}

export interface PiSpawnConfig extends SpawnConfig {
  /** Absolute path to packages/pi-extension/dist/index.js. */
  piExtensionPath: string
  /** Optional extra args appended to the `pi` command line. */
  extraPiArgs?: string
}

function agentDirFor(agentId: string): string {
  return join(agentsDir(), agentId)
}

function piSessionDirFor(agentId: string): string {
  return join(agentDirFor(agentId), 'sessions')
}

function readyPathFor(agentId: string): string {
  return piFifoPaths(agentId).readyPath
}

export class PiRuntime implements AgentRuntime {
  readonly name = 'pi' as const

  /** Resolve the latest Pi session JSONL for an agent. Pi nests files under
   *  <agentDir>/sessions/<encoded-cwd>/<timestamp>_<id>.jsonl, but we tolerate
   *  any depth and just pick the freshest .jsonl by mtime. */
  getSessionPath(agentId: string): string | null {
    const root = piSessionDirFor(agentId)
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
      const sess = listSessions().find(s => s.name === agentId)
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
    const parsed = parsePiSession(session)
    return parsed?.usage ?? null
  }

  /** Pi reports per-message inline cost.total. We pass that through as the
   *  totalCost and back out per-bucket costs from the parser's modelBreakdown
   *  is not informative (Pi does not report cache vs input vs output cost
   *  separately on a session level), so we leave the per-bucket fields zero. */
  getSessionCost(agentId: string): CostBreakdown | null {
    const session = this.getSessionPath(agentId)
    if (!session) return null
    const parsed = parsePiSession(session)
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
      throw new PiNotReady(`Pi agent ${agentId}: ready.json not present yet`)
    }
    writePiCommand(agentId, { cmd: 'prompt', text: message })
  }

  /**
   * Kill a Pi agent via the documented escalation ladder (PAN-636 bead 8qco).
   *
   *   1. Send {cmd:'abort'} via the RPC fifo (graceful — Pi can flush
   *      session.jsonl and write any pending heartbeat).
   *   2. Wait up to 2s for the tmux session to disappear on its own.
   *   3. SIGTERM the Pi process group via tmux send-signal -s TERM.
   *   4. Wait up to 5s for the tmux session to disappear.
   *   5. tmux kill-session (effectively SIGKILL on the pane).
   *   6. Always unlink rpc.in, ready.json, heartbeat, and completed marker.
   *      NEVER touch session JSONL files under <agentDir>/sessions/ — per
   *      the JSONL-is-sacred rule in CLAUDE.md.
   */
  async killAgent(agentId: string): Promise<void> {
    // Step 1: graceful RPC abort.
    try {
      writePiCommand(agentId, { cmd: 'abort' })
    } catch {
      // No reader / not ready — fall through to signal escalation.
    }

    // Step 2: poll for tmux exit up to 2s.
    if (await pollUntilSessionGone(agentId, 2_000)) {
      cleanupPiTransientFiles(agentId)
      return
    }

    // Step 3: SIGTERM via tmux. Best-effort — if it fails the kill-session
    // fallback below will still take the pane down.
    try {
      await execAsync(`tmux -L panopticon send-keys -t ${agentId} C-c 2>/dev/null || true`)
    } catch {
      // ignore
    }
    try {
      await execAsync(`pkill -TERM -f "agent-id=${agentId}" 2>/dev/null || true`)
    } catch {
      // ignore
    }

    // Step 4: poll for tmux exit up to another 5s (7s total budget).
    if (await pollUntilSessionGone(agentId, 5_000)) {
      cleanupPiTransientFiles(agentId)
      return
    }

    // Step 5: SIGKILL fallback via tmux kill-session.
    try {
      if (await sessionExistsAsync(agentId)) {
        await killSessionAsync(agentId)
      }
    } finally {
      cleanupPiTransientFiles(agentId)
    }
  }

  async spawnAgent(config: SpawnConfig & { piExtensionPath?: string }): Promise<Agent> {
    const piExtensionPath = config.piExtensionPath
    if (!piExtensionPath) {
      throw new Error('PiRuntime.spawnAgent requires piExtensionPath in config')
    }

    const agentId = config.agentId
    const dir = agentDirFor(agentId)
    const sessionDir = piSessionDirFor(agentId)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    mkdirSync(sessionDir, { recursive: true, mode: 0o700 })

    // Writer side relies on the fifo existing before tmux starts the launcher.
    const fifoPath = await createPiFifo(agentId)

    const promptFile = config.prompt ? writeAgentPromptFile(agentId, config.prompt) : undefined

    const launcherScript = generateLauncherScript({
      agentType: 'work',
      workingDir: config.workspace,
      harness: 'pi',
      piExtensionPath,
      piFifoPath: fifoPath,
      piSessionDir: sessionDir,
      model: config.model,
      promptFile,
      panopticonEnv: { agentId },
      setTerminalEnv: true,
      trapHup: true,
    })

    const launcherPath = join(dir, 'pi-launcher.sh')
    writeFileSync(launcherPath, launcherScript)
    chmodSync(launcherPath, 0o755)

    await createSessionAsync(agentId, config.workspace, `bash ${launcherPath}`, {
      env: { PANOPTICON_AGENT_ID: agentId },
    })

    await waitForReady(agentId, SPAWN_READY_TIMEOUT_MS)

    const readyData = readReady(agentId)
    return {
      id: agentId,
      sessionId: readyData?.sessionId ?? 'unknown',
      runtime: 'pi',
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
      const sessionRoot = piSessionDirFor(agentName)
      if (!existsSync(sessionRoot)) continue
      const files: { path: string; mtime: number }[] = []
      walkJsonl(sessionRoot, files)
      for (const file of files) {
        const parsed = parsePiSession(file.path)
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
    return await sessionExistsAsync(agentId)
  }
}

export function createPiRuntime(): PiRuntime {
  return new PiRuntime()
}

// ────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────

async function pollUntilSessionGone(agentId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await sessionExistsAsync(agentId))) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}

/**
 * Remove Pi's transient per-agent files: rpc.in fifo, ready.json,
 * heartbeats/<id>.json, completed marker. Never touches session JSONLs
 * under <agentDir>/sessions/ — those are sacred (CLAUDE.md).
 */
function cleanupPiTransientFiles(agentId: string): void {
  try { destroyPiFifo(agentId) } catch { /* ignore */ }
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
  throw new PiSpawnTimeout(agentId)
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
