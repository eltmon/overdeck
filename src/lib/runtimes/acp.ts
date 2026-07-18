import { exec } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { AgentState } from '../agents/agent-state.js'
import { materializeAcpContextFile } from '../acp/context.js'
import { listAgentStates } from '../agents/queries.js'
import { BRIDGE_TOKEN_HEADER } from '../bridge-token.js'
import { prepareHarnessLaunch } from '../harness-binary.js'
import { getOverdeckHome, packageRoot } from '../paths.js'
import { getRuntimeBehavior } from './behavior.js'
import {
  tmuxCreateSession,
  tmuxKillSession,
  tmuxSessionExists,
} from './tmux-cli.js'
import type {
  Agent,
  AgentRuntimeSync,
  CostBreakdown,
  HarnessBehavior,
  Heartbeat,
  Session,
  SpawnConfig,
  TokenUsage,
} from './types.js'

const execAsync = promisify(exec)
const HOST_REQUEST_TIMEOUT_MS = 5_000
const SPAWN_READY_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 100

interface AcpHostResponse {
  readonly status: number
  readonly body: string
}

export interface AcpSpawnConfig extends SpawnConfig {
  readonly provider?: string
}

export interface AcpRuntimeOptions {
  readonly provider?: string
  readonly overdeckHome?: string
  readonly execCommand?: (command: string) => Promise<{ readonly stdout: string }>
  readonly prepareLaunch?: () => Promise<{ readonly binaryPath: string; readonly pathExport: string }>
  readonly listAgentStates?: () => AgentState[]
}

export class AcpSpawnTimeout extends Error {
  readonly code = 'ACP_SPAWN_TIMEOUT' as const

  constructor(agentId: string) {
    super(`ACP agent ${agentId} did not write acp-session-id within ${SPAWN_READY_TIMEOUT_MS}ms`)
    this.name = 'AcpSpawnTimeout'
  }
}

export class AcpRuntimeSync implements AgentRuntimeSync {
  readonly name = 'acp' as const
  private readonly provider: string
  private readonly overdeckHome: string | undefined
  private readonly execCommand: (command: string) => Promise<{ readonly stdout: string }>
  private readonly prepareLaunch: () => Promise<{ readonly binaryPath: string; readonly pathExport: string }>
  private readonly resolveAgentStates: () => AgentState[]

  constructor(options: AcpRuntimeOptions = {}) {
    this.provider = options.provider ?? 'kimi'
    this.overdeckHome = options.overdeckHome
    this.execCommand = options.execCommand ?? execAsync
    this.prepareLaunch = options.prepareLaunch ?? (() => prepareHarnessLaunch('acp'))
    this.resolveAgentStates = options.listAgentStates ?? (() => listAgentStates())
  }

  getHarnessBehavior(): HarnessBehavior {
    return getRuntimeBehavior('acp')
  }

  getSessionPath(agentId: string): string {
    return join(this.home(), 'agents', agentId, 'acp-session.jsonl')
  }

  getLastActivity(agentId: string): Date | null {
    try {
      return statSync(this.getSessionPath(agentId)).mtime
    } catch {
      return null
    }
  }

  getHeartbeat(agentId: string): Heartbeat | null {
    const lastActivity = this.getLastActivity(agentId)
    if (!lastActivity) return null

    return {
      timestamp: lastActivity,
      agentId,
      source: 'jsonl',
      confidence: 'medium',
    }
  }

  getTokenUsage(_agentId: string): TokenUsage | null {
    return null
  }

  getSessionCost(_agentId: string): CostBreakdown | null {
    return null
  }

  async sendMessage(agentId: string, message: string): Promise<void> {
    const socketPath = this.socketPath(agentId)
    if (!existsSync(socketPath)) {
      throw new Error(`ACP agent ${agentId}: host socket is not available`)
    }
    const token = this.readToken(agentId)
    if (!token) {
      throw new Error(`ACP agent ${agentId}: missing acp-token`)
    }

    await postUnixSocketJson(socketPath, token, {
      op: 'message',
      content: message,
    }, HOST_REQUEST_TIMEOUT_MS)
  }

  async killAgent(agentId: string): Promise<void> {
    const socketPath = this.socketPath(agentId)
    const token = this.readToken(agentId)
    if (existsSync(socketPath) && token) {
      try {
        await postUnixSocketJson(socketPath, token, { op: 'interrupt' }, HOST_REQUEST_TIMEOUT_MS)
      } catch {
        // Best effort: the process signal ladder below still tears down the host.
      }
    }

    if (await pollUntilSessionGone(agentId, 2_000)) return

    let panePid: string | null = null
    try {
      const { stdout } = await this.execCommand(
        `tmux -L overdeck list-panes -t ${shellQuote(agentId)} -F '#{pane_pid}' 2>/dev/null`,
      )
      panePid = stdout.trim() || null
      if (panePid) {
        await this.execCommand(
          `kill -TERM -- -${panePid} 2>/dev/null || kill -TERM ${panePid} 2>/dev/null || true`,
        )
      }
    } catch {
      // Best effort: the remaining kill ladder still tears down the tmux session.
    }

    if (await pollUntilSessionGone(agentId, 5_000)) return
    if (panePid) {
      try {
        await this.execCommand(
          `kill -KILL -- -${panePid} 2>/dev/null || kill -KILL ${panePid} 2>/dev/null || true`,
        )
      } catch {
        // Best effort: tmuxKillSession below removes any remaining session.
      }
    }
    if (await tmuxSessionExists(agentId)) await tmuxKillSession(agentId)
  }

  async spawnAgent(config: AcpSpawnConfig): Promise<Agent> {
    const provider = config.provider ?? this.provider
    const { binaryPath } = await this.prepareLaunch()
    const contextFile = materializeAcpContextFile(
      join(this.home(), 'agents', config.agentId),
      config.workspace,
    )
    const command = [
      'node',
      shellQuote(join(packageRoot, 'dist', 'acp-host.js')),
      '--agent',
      shellQuote(config.agentId),
      '--provider',
      shellQuote(provider),
      '--workspace',
      shellQuote(config.workspace),
      '--binary-path',
      shellQuote(binaryPath),
      '--context-file',
      shellQuote(contextFile),
    ]
    if (config.sessionId) command.push('--resume', shellQuote(config.sessionId))
    if (config.model) command.push('--model', shellQuote(config.model))

    rmSync(this.agentPath(config.agentId, 'acp-session-id'), { force: true })

    await tmuxCreateSession(
      config.agentId,
      config.workspace,
      command.join(' '),
      {
        ...config.env,
        OVERDECK_AGENT_ID: config.agentId,
      },
    )

    try {
      const sessionId = await this.waitForSessionId(config.agentId)
      if (!sessionId) throw new AcpSpawnTimeout(config.agentId)

      if (config.prompt) await this.sendMessage(config.agentId, config.prompt)

      return {
        id: config.agentId,
        sessionId,
        runtime: 'acp',
        model: config.model ?? '',
        workspace: config.workspace,
        startedAt: new Date(),
      }
    } catch (error) {
      if (await tmuxSessionExists(config.agentId)) await tmuxKillSession(config.agentId)
      throw error
    }
  }

  listSessions(workspace?: string): Session[] {
    const sessions: Session[] = []
    for (const state of this.resolveAgentStates()) {
      if (state.harness !== 'acp') continue
      if (workspace && state.workspace !== workspace) continue

      const sessionId = this.readSessionId(state.id)
      if (!sessionId) continue

      const sessionPath = this.getSessionPath(state.id)
      let lastActivity: Date
      try {
        lastActivity = statSync(sessionPath).mtime
      } catch {
        try {
          lastActivity = statSync(this.agentPath(state.id, 'acp-session-id')).mtime
        } catch {
          continue
        }
      }

      sessions.push({
        id: sessionId,
        agentId: state.id,
        workspace: state.workspace,
        model: state.model ?? '',
        startedAt: new Date(state.startedAt),
        lastActivity,
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
      })
    }
    return sessions
  }

  async isRunning(agentId: string): Promise<boolean> {
    return tmuxSessionExists(agentId)
  }

  private home(): string {
    return this.overdeckHome ?? getOverdeckHome()
  }

  private agentPath(agentId: string, file: string): string {
    return join(this.home(), 'agents', agentId, file)
  }

  private socketPath(agentId: string): string {
    return join(this.home(), 'sockets', `acp-${agentId}.sock`)
  }

  private readToken(agentId: string): string | null {
    try {
      return readFileSync(this.agentPath(agentId, 'acp-token'), 'utf8').trim() || null
    } catch {
      return null
    }
  }

  private readSessionId(agentId: string): string | null {
    try {
      return readFileSync(this.agentPath(agentId, 'acp-session-id'), 'utf8').trim() || null
    } catch {
      return null
    }
  }

  private async waitForSessionId(agentId: string): Promise<string | null> {
    const deadline = Date.now() + SPAWN_READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      const sessionId = this.readSessionId(agentId)
      if (sessionId) return sessionId
      await delay(POLL_INTERVAL_MS)
    }
    return null
  }
}

async function pollUntilSessionGone(agentId: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await tmuxSessionExists(agentId))) return true
    await delay(POLL_INTERVAL_MS)
  }
  return false
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function postUnixSocketJson(
  socketPath: string,
  token: string,
  body: unknown,
  timeoutMs?: number,
): Promise<AcpHostResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timeout: NodeJS.Timeout | undefined
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      callback()
    }
    const client = request(
      {
        socketPath,
        path: '/',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [BRIDGE_TOKEN_HEADER]: token,
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8')
          const status = response.statusCode ?? 0
          if (status < 200 || status >= 300) {
            finish(() => reject(new Error(`ACP host returned HTTP ${status}: ${responseBody}`)))
            return
          }
          finish(() => resolve({ status, body: responseBody }))
        })
      },
    )
    if (timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        client.destroy(new Error(`ACP host request timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      timeout.unref?.()
    }
    client.once('error', (error) => finish(() => reject(error)))
    client.end(JSON.stringify(body))
  })
}

export function createAcpRuntimeSync(options: AcpRuntimeOptions = {}): AcpRuntimeSync {
  return new AcpRuntimeSync(options)
}
