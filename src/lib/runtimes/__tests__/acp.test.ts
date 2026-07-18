import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tmuxMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  killSession: vi.fn(),
  sessionExists: vi.fn(),
}))

vi.mock('../tmux-cli.js', () => ({
  tmuxCreateSession: tmuxMocks.createSession,
  tmuxKillSession: tmuxMocks.killSession,
  tmuxSessionExists: tmuxMocks.sessionExists,
}))

import type { AgentState } from '../../agents/agent-state.js'
import { BRIDGE_TOKEN_HEADER } from '../../bridge-token.js'
import { packageRoot } from '../../paths.js'
import { AcpRuntimeSync } from '../acp.js'

const tempHomes: string[] = []
const servers: Server[] = []

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'overdeck-acp-runtime-'))
  tempHomes.push(home)
  return home
}

function writeAgentFile(home: string, agentId: string, file: string, content: string): string {
  const agentDir = join(home, 'agents', agentId)
  mkdirSync(agentDir, { recursive: true })
  const path = join(agentDir, file)
  writeFileSync(path, content)
  return path
}

async function listenOnSocket(
  socketPath: string,
  handle: (headers: Record<string, string | string[] | undefined>, body: unknown) => void,
  delayMs = 0,
): Promise<void> {
  mkdirSync(join(socketPath, '..'), { recursive: true })
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      handle(request.headers, JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const respond = () => {
        response.writeHead(202, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true }))
      }
      if (delayMs > 0) setTimeout(respond, delayMs)
      else respond()
    })
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
}

beforeEach(() => {
  tmuxMocks.createSession.mockReset()
  tmuxMocks.killSession.mockReset()
  tmuxMocks.sessionExists.mockReset()
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  )
  tempHomes.splice(0).forEach((home) => rmSync(home, { recursive: true, force: true }))
})

describe('AcpRuntimeSync', () => {
  it('uses the ACP transcript mtime for activity and heartbeat without cost data', () => {
    const home = makeHome()
    const runtime = new AcpRuntimeSync({ overdeckHome: home })
    const transcript = writeAgentFile(home, 'agent-activity', 'acp-session.jsonl', '{}\n')

    expect(runtime.getSessionPath('agent-activity')).toBe(transcript)
    expect(runtime.getLastActivity('agent-activity')).toEqual(expect.any(Date))
    expect(runtime.getHeartbeat('agent-activity')).toMatchObject({
      agentId: 'agent-activity',
      source: 'jsonl',
      confidence: 'medium',
    })
    expect(runtime.getTokenUsage('agent-activity')).toBeNull()
    expect(runtime.getSessionCost('agent-activity')).toBeNull()
  })

  it('spawns the package host with the preflight-resolved binary and fresh readiness', async () => {
    const home = makeHome()
    const staleSessionPath = writeAgentFile(home, 'agent-spawn', 'acp-session-id', 'stale-session\n')
    tmuxMocks.createSession.mockImplementation(async (agentId: string) => {
      expect(existsSync(staleSessionPath)).toBe(false)
      writeAgentFile(home, agentId, 'acp-session-id', 'session-2858\n')
      writeAgentFile(home, agentId, 'acp-token', 'secret\n')
    })
    tmuxMocks.sessionExists.mockResolvedValue(true)
    const runtime = new AcpRuntimeSync({
      overdeckHome: home,
      prepareLaunch: async () => ({
        binaryPath: '/opt/kimi code/bin/kimi',
        pathExport: 'export PATH=/opt/kimi-code/bin:"$PATH"',
      }),
    })

    const agent = await runtime.spawnAgent({
      agentId: 'agent-spawn',
      workspace: '/tmp/work space',
      runtime: 'acp',
      env: { EXTRA: 'value' },
    })

    expect(tmuxMocks.createSession).toHaveBeenCalledWith(
      'agent-spawn',
      '/tmp/work space',
      expect.stringContaining(`node '${join(packageRoot, 'dist', 'acp-host.js')}' --agent 'agent-spawn' --provider 'kimi'`),
      {
        EXTRA: 'value',
        OVERDECK_AGENT_ID: 'agent-spawn',
      },
    )
    const command = tmuxMocks.createSession.mock.calls[0]?.[2]
    expect(command).toContain("--workspace '/tmp/work space'")
    expect(command).toContain("--binary-path '/opt/kimi code/bin/kimi'")
    expect(command).not.toContain('--model')
    expect(agent).toMatchObject({
      id: 'agent-spawn',
      sessionId: 'session-2858',
      runtime: 'acp',
      workspace: '/tmp/work space',
    })
    await expect(runtime.isRunning('agent-spawn')).resolves.toBe(true)
  })

  it('kills a host that never produces fresh readiness', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const home = makeHome()
    writeAgentFile(home, 'agent-timeout', 'acp-session-id', 'stale-session\n')
    tmuxMocks.createSession.mockResolvedValue(undefined)
    tmuxMocks.sessionExists.mockResolvedValue(true)
    const runtime = new AcpRuntimeSync({
      overdeckHome: home,
      prepareLaunch: async () => ({
        binaryPath: '/opt/kimi/bin/kimi',
        pathExport: 'export PATH=/opt/kimi/bin:"$PATH"',
      }),
    })

    const spawn = runtime.spawnAgent({
      agentId: 'agent-timeout',
      workspace: '/tmp/workspace',
      runtime: 'acp',
    })
    const rejection = expect(spawn).rejects.toThrow(
      'ACP agent agent-timeout did not write acp-session-id',
    )
    await vi.advanceTimersByTimeAsync(30_000)

    await rejection
    expect(tmuxMocks.killSession).toHaveBeenCalledWith('agent-timeout')
  })

  it('posts authenticated messages and surfaces missing protocol artifacts', async () => {
    const home = makeHome()
    const agentId = 'agent-delivery'
    const token = 'delivery-token'
    writeAgentFile(home, agentId, 'acp-token', token)
    const socketPath = join(home, 'sockets', `acp-${agentId}.sock`)
    const received: Array<{ headers: Record<string, string | string[] | undefined>; body: unknown }> = []
    await listenOnSocket(socketPath, (headers, body) => received.push({ headers, body }))
    const runtime = new AcpRuntimeSync({ overdeckHome: home })

    await runtime.sendMessage(agentId, 'hello over ACP')

    expect(received).toEqual([
      {
        headers: expect.objectContaining({ [BRIDGE_TOKEN_HEADER]: token }),
        body: { op: 'message', content: 'hello over ACP' },
      },
    ])
    await expect(runtime.sendMessage('agent-missing', 'hello')).rejects.toThrow(
      'ACP agent agent-missing: host socket is not available',
    )

    const missingTokenId = 'agent-missing-token'
    const missingTokenSocket = join(home, 'sockets', `acp-${missingTokenId}.sock`)
    await listenOnSocket(missingTokenSocket, () => undefined)
    await expect(runtime.sendMessage(missingTokenId, 'hello')).rejects.toThrow(
      'ACP agent agent-missing-token: missing acp-token',
    )
  })

  it('times out when the host does not acknowledge queue acceptance', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const home = makeHome()
    const agentId = 'agent-timeout'
    const token = 'delivery-token'
    writeAgentFile(home, agentId, 'acp-token', token)
    const socketPath = join(home, 'sockets', `acp-${agentId}.sock`)
    let markRequestReceived!: () => void
    const requestReceived = new Promise<void>((resolve) => {
      markRequestReceived = resolve
    })
    await listenOnSocket(socketPath, () => {
      markRequestReceived()
    }, 20_000)
    const runtime = new AcpRuntimeSync({ overdeckHome: home })

    const delivery = runtime.sendMessage(agentId, 'queued ACP turn')
    const rejection = expect(delivery).rejects.toThrow(
      'ACP host request timed out after 5000ms',
    )
    await requestReceived
    await vi.advanceTimersByTimeAsync(5_100)

    await rejection
  })

  it('enumerates ACP sessions from the canonical agent resolver', () => {
    const home = makeHome()
    writeAgentFile(home, 'agent-acp', 'acp-session-id', 'session-acp\n')
    writeAgentFile(home, 'agent-acp', 'acp-session.jsonl', '{"role":"assistant"}\n')
    const states: AgentState[] = [
      {
        id: 'agent-acp',
        issueId: 'PAN-2858',
        workspace: '/tmp/acp-workspace',
        harness: 'acp',
        role: 'work',
        model: 'kimi-for-coding',
        status: 'running',
        startedAt: '2026-07-17T10:00:00.000Z',
      },
      {
        id: 'agent-claude',
        issueId: 'PAN-1',
        workspace: '/tmp/acp-workspace',
        harness: 'claude-code',
        role: 'work',
        model: 'claude-sonnet-4-6',
        status: 'running',
        startedAt: '2026-07-17T10:00:00.000Z',
      },
    ]
    const runtime = new AcpRuntimeSync({
      overdeckHome: home,
      listAgentStates: () => states,
    })

    expect(runtime.listSessions('/tmp/acp-workspace')).toEqual([
      {
        id: 'session-acp',
        agentId: 'agent-acp',
        workspace: '/tmp/acp-workspace',
        model: 'kimi-for-coding',
        startedAt: new Date('2026-07-17T10:00:00.000Z'),
        lastActivity: expect.any(Date),
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
      },
    ])
    expect(runtime.listSessions('/tmp/other-workspace')).toEqual([])
  })

  it('interrupts before the signal ladder and preserves the transcript', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const home = makeHome()
    const agentId = 'agent-kill'
    const transcript = writeAgentFile(home, agentId, 'acp-session.jsonl', '{"role":"assistant"}\n')
    writeAgentFile(home, agentId, 'acp-token', 'kill-token\n')
    const socketPath = join(home, 'sockets', `acp-${agentId}.sock`)
    let interruptReceived!: () => void
    const receivedInterrupt = new Promise<void>((resolve) => {
      interruptReceived = resolve
    })
    const operations: unknown[] = []
    await listenOnSocket(socketPath, (_headers, body) => {
      operations.push(body)
      interruptReceived()
    })
    tmuxMocks.sessionExists.mockResolvedValue(true)
    const execCommand = vi.fn(async (command: string) => ({
      stdout: command.includes('list-panes') ? '4242\n' : '',
    }))
    const runtime = new AcpRuntimeSync({ overdeckHome: home, execCommand })

    const kill = runtime.killAgent(agentId)
    await receivedInterrupt
    await new Promise<void>((resolve) => setImmediate(resolve))
    await vi.advanceTimersByTimeAsync(7_000)
    await kill

    expect(operations[0]).toEqual({ op: 'interrupt' })
    expect(execCommand).toHaveBeenCalledWith(expect.stringContaining('list-panes'))
    expect(execCommand).toHaveBeenCalledWith(expect.stringContaining('kill -TERM'))
    expect(execCommand).toHaveBeenCalledWith(expect.stringContaining('kill -KILL'))
    expect(tmuxMocks.killSession).toHaveBeenCalledWith(agentId)
    expect(existsSync(transcript)).toBe(true)
  })
})
