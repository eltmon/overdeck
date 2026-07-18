import { exec } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { BRIDGE_TOKEN_HEADER } from '../bridge-token.js'
import { getOverdeckHome } from '../paths.js'
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

  constructor(options: AcpRuntimeOptions = {}) {
    this.provider = options.provider ?? 'kimi'
    this.overdeckHome = options.overdeckHome
    this.execCommand = options.execCommand ?? execAsync
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
    const token = this.readToken(agentId)
    if (!existsSync(socketPath) || !token) return

    try {
      await postUnixSocketJson(socketPath, token, {
        op: 'message',
        content: message,
      })
    } catch (error) {
      if (isUnavailableSocket(error)) return
      throw error
    }
  }

  async killAgent(agentId: string): Promise<void> {
    const socketPath = this.socketPath(agentId)
    const token = this.readToken(agentId)
    if (existsSync(socketPath) && token) {
      try {
        await postUnixSocketJson(socketPath, token, { op: 'interrupt' })
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
    const command = [
      'node',
      'dist/acp-host.js',
      '--agent',
      shellQuote(config.agentId),
      '--provider',
      shellQuote(provider),
      '--workspace',
      shellQuote(config.workspace),
    ]
    if (config.sessionId) command.push('--resume', shellQuote(config.sessionId))
    if (config.model) command.push('--model', shellQuote(config.model))

    await tmuxCreateSession(
      config.agentId,
      config.workspace,
      command.join(' '),
      {
        ...config.env,
        OVERDECK_AGENT_ID: config.agentId,
      },
    )

    const sessionId = await this.waitForSessionId(config.agentId)
    if (!sessionId) throw new AcpSpawnTimeout(config.agentId)

    if (config.prompt) {
      const token = this.readToken(config.agentId)
      if (!token) throw new Error(`ACP agent ${config.agentId}: missing acp-token after startup`)
      await postUnixSocketJson(this.socketPath(config.agentId), token, {
        op: 'message',
        content: config.prompt,
      })
    }

    return {
      id: config.agentId,
      sessionId,
      runtime: 'acp',
      model: config.model ?? '',
      workspace: config.workspace,
      startedAt: new Date(),
    }
  }

  listSessions(_workspace?: string): Session[] {
    return []
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
): Promise<AcpHostResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
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
    client.setTimeout(HOST_REQUEST_TIMEOUT_MS, () => {
      client.destroy(new Error(`ACP host request timed out after ${HOST_REQUEST_TIMEOUT_MS}ms`))
    })
    client.once('error', (error) => finish(() => reject(error)))
    client.end(JSON.stringify(body))
  })
}

function isUnavailableSocket(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ECONNREFUSED'
}

export function createAcpRuntimeSync(options: AcpRuntimeOptions = {}): AcpRuntimeSync {
  return new AcpRuntimeSync(options)
}
