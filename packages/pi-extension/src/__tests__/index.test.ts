import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import overdeckPiExtension, {
  handleSessionStart,
  handleToolExecutionEnd,
  handleTurnEnd,
  handlePanDone,
  handleSessionBriefingContext,
  handleWorkspaceContext,
  overdeckPathsFor,
  probePiExtensionCapabilities,
  setThinkingLevelIfSupported,
  type PiExtensionAPI,
  type PiCommand,
  type ThinkingLevel,
} from '../index.js'

function makeFakeHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'pan-pi-ext-'))
  return {
    home,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  }
}

const fixedTime = '2026-05-07T05:00:00.000Z'
const now = () => fixedTime

// Track fetch calls and control responses per test.
let fetchCalls: { url: string; body: unknown; headers: Record<string, string> }[] = []
let fetchResponse: { status: number } = { status: 200 }

beforeEach(() => {
  fetchCalls = []
  fetchResponse = { status: 200 }
  // Neutralize any ambient OVERDECK_DASHBOARD_URL (set on developer machines
  // running a live `pan dev`) so the default-host tests assert against the
  // production fallback (http://localhost:3011), not the host's value. Tests
  // that exercise the env var stub it explicitly; afterEach unstubs.
  vi.stubEnv('OVERDECK_DASHBOARD_URL', undefined)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const url = _url
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      fetchCalls.push({ url, body, headers: init?.headers as Record<string, string> })
      return { status: fetchResponse.status } as Response
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('handleSessionStart', () => {
  let h: ReturnType<typeof makeFakeHome>
  beforeEach(() => { h = makeFakeHome() })
  afterEach(() => h.cleanup())

  it('writes ~/.overdeck/agents/<id>/ready.json with sessionId and pid', async () => {
    await handleSessionStart(
      { agentId: 'agent-pan-636', home: h.home, pid: 4242, now },
      { reason: 'new', sessionId: 'sess-abc' },
    )
    const paths = overdeckPathsFor('agent-pan-636', h.home)
    expect(existsSync(paths.readyPath)).toBe(true)
    const body = JSON.parse(readFileSync(paths.readyPath, 'utf8'))
    expect(body).toEqual({
      agentId: 'agent-pan-636',
      sessionId: 'sess-abc',
      reason: 'new',
      timestamp: fixedTime,
      pid: 4242,
    })
  })

  it('AC1 (PAN-636 workspace-3119): also writes ~/.overdeck/agents/<id>/session.id with the Pi session id', async () => {
    await handleSessionStart(
      { agentId: 'agent-pan-636', home: h.home, pid: 4242, now },
      { reason: 'new', sessionId: 'sess-resume-target' },
    )
    const paths = overdeckPathsFor('agent-pan-636', h.home)
    expect(existsSync(paths.sessionIdPath)).toBe(true)
    expect(readFileSync(paths.sessionIdPath, 'utf8').trim()).toBe('sess-resume-target')
  })

  it('does NOT write session.id when Pi reports a null/missing sessionId — null would defeat resume', async () => {
    await handleSessionStart(
      { agentId: 'agent-pan-636', home: h.home, pid: 4242, now },
      { reason: 'new' /* sessionId omitted */ },
    )
    const paths = overdeckPathsFor('agent-pan-636', h.home)
    expect(existsSync(paths.sessionIdPath)).toBe(false)
  })

  it('PAN-1134: POSTs model_set + activity idle to the dashboard', async () => {
    await handleSessionStart(
      { agentId: 'agent-pan-636', home: h.home, pid: 4242, now },
      { reason: 'new', sessionId: 'sess-abc' },
    )
    expect(fetchCalls.length).toBe(2)
    expect(fetchCalls[0]!.url).toBe('http://localhost:3011/api/agents/agent-pan-636/heartbeat')
    expect(fetchCalls[0]!.body).toEqual({
      kind: 'model_set',
      model: 'pi',
      claudeSessionId: 'sess-abc',
      timestamp: fixedTime,
    })
    expect(fetchCalls[1]!.body).toEqual({
      kind: 'activity',
      activity: 'idle',
      timestamp: fixedTime,
    })
  })

  it('attaches the internal token when one is available', async () => {
    mkdirSync(join(h.home, '.overdeck'), { recursive: true })
    writeFileSync(join(h.home, '.overdeck', 'internal-token'), 'test-token\n')

    await handleSessionStart(
      { agentId: 'agent-pan-636', home: h.home, pid: 4242, now },
      { reason: 'new', sessionId: 'sess-abc' },
    )

    expect(fetchCalls[0]!.headers['x-overdeck-internal-token']).toBe('test-token')
  })

  it('buffers to pending-events.jsonl when dashboard returns 503', async () => {
    fetchResponse = { status: 503 }
    await handleSessionStart(
      { agentId: 'agent-pan-636', home: h.home, pid: 4242, now },
      { reason: 'new', sessionId: 'sess-abc' },
    )
    const paths = overdeckPathsFor('agent-pan-636', h.home)
    expect(existsSync(paths.pendingEventsPath)).toBe(true)
    const lines = readFileSync(paths.pendingEventsPath, 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]!).kind).toBe('model_set')
    expect(JSON.parse(lines[1]!).kind).toBe('activity')
  })

  it('caps pending event replay to a bounded tail when dashboard remains unavailable', async () => {
    fetchResponse = { status: 503 }
    const paths = overdeckPathsFor('agent-pan-636', h.home)
    mkdirSync(join(h.home, '.overdeck', 'agents', 'agent-pan-636'), { recursive: true })
    const lines = Array.from({ length: 350 }, (_, index) => JSON.stringify({ kind: 'activity', activity: 'idle', sequence: index }))
    writeFileSync(paths.pendingEventsPath, `${lines.join('\n')}\n`)

    await handleToolExecutionEnd(
      { agentId: 'agent-pan-636', home: h.home, pid: 99, now },
      { toolName: 'Bash', isError: false },
    )

    const remaining = readFileSync(paths.pendingEventsPath, 'utf8').trim().split('\n')
    expect(remaining.length).toBeLessThanOrEqual(202)
    expect(JSON.parse(remaining[0]!).sequence).toBeGreaterThanOrEqual(150)
  })

  it('flushes pending events on the next successful POST', async () => {
    // First call fails.
    fetchResponse = { status: 503 }
    await handleSessionStart(
      { agentId: 'agent-pan-636', home: h.home, pid: 4242, now },
      { reason: 'new', sessionId: 'sess-abc' },
    )
    const paths = overdeckPathsFor('agent-pan-636', h.home)
    expect(existsSync(paths.pendingEventsPath)).toBe(true)

    // Second call succeeds — should drain pending first, then POST new events.
    fetchResponse = { status: 200 }
    fetchCalls = []
    await handleToolExecutionEnd(
      { agentId: 'agent-pan-636', home: h.home, pid: 99, now },
      { toolName: 'Bash', isError: false },
    )

    // 2 buffered + activity + cost = 4 POSTs total.
    expect(fetchCalls.length).toBe(4)
    expect(fetchCalls[0]!.body).toEqual({ kind: 'model_set', model: 'pi', claudeSessionId: 'sess-abc', timestamp: fixedTime })
    expect(fetchCalls[1]!.body).toEqual({ kind: 'activity', activity: 'idle', timestamp: fixedTime })
    expect(fetchCalls[2]!.body).toEqual({ kind: 'activity', activity: 'working', tool: 'Bash', timestamp: fixedTime })
    expect(fetchCalls[3]!.body).toMatchObject({ kind: 'cost-event', tool: 'Bash', costUsd: null })

    // Pending file should be gone after successful drain.
    expect(existsSync(paths.pendingEventsPath)).toBe(false)
  })

  it('drops events on 4xx (client error) without buffering', async () => {
    fetchResponse = { status: 422 }
    await handleSessionStart(
      { agentId: 'agent-pan-636', home: h.home, pid: 4242, now },
      { reason: 'new', sessionId: 'sess-abc' },
    )
    const paths = overdeckPathsFor('agent-pan-636', h.home)
    expect(existsSync(paths.pendingEventsPath)).toBe(false)
  })

  it('respects OVERDECK_DASHBOARD_URL env var', async () => {
    vi.stubEnv('OVERDECK_DASHBOARD_URL', 'http://dashboard.local:9999')
    await handleSessionStart(
      { agentId: 'agent-pan-636', home: h.home, pid: 4242, now },
      { reason: 'new', sessionId: 'sess-abc' },
    )
    expect(fetchCalls[0]!.url).toBe('http://dashboard.local:9999/api/agents/agent-pan-636/heartbeat')
    vi.unstubAllEnvs()
  })
})

describe('Pi system prompt context', () => {
  let h: ReturnType<typeof makeFakeHome>
  beforeEach(() => { h = makeFakeHome() })
  afterEach(() => h.cleanup())

  it('appends workspace context and session briefing in order', async () => {
    const cwd = join(h.home, 'workspace')
    mkdirSync(join(cwd, '.pan', 'context'), { recursive: true })
    writeFileSync(join(cwd, '.pan', 'context', 'workspace.md'), 'workspace context')
    writeFileSync(join(h.home, 'session-context.md'), 'live briefing context')
    const appended: string[] = []
    const ctx = { appendSystemPrompt: vi.fn(async (text: string) => { appended.push(text) }) }

    await handleWorkspaceContext(ctx, cwd)
    await handleSessionBriefingContext(ctx, h.home)

    expect(appended).toEqual(['workspace context', 'live briefing context'])
    expect(ctx.appendSystemPrompt).toHaveBeenCalledTimes(2)
  })
})

describe('extension control capabilities', () => {
  it('reports supported runtime control methods', () => {
    const runtime = {
      on: () => {},
      registerCommand: () => {},
      sendUserMessage: () => {},
      setThinkingLevel: () => {},
      getThinkingLevel: () => 'high' as ThinkingLevel,
      setModel: () => {},
      exec: () => {},
    } satisfies PiExtensionAPI
    const ctx = { compact: () => {} }

    expect(probePiExtensionCapabilities(runtime, ctx)).toEqual({
      sendUserMessage: true,
      setThinkingLevel: true,
      getThinkingLevel: true,
      setModel: true,
      exec: true,
      compact: true,
    })
  })

  it('no-ops instead of throwing when setThinkingLevel is unsupported', async () => {
    const runtime = {
      on: () => {},
      registerCommand: () => {},
      sendUserMessage: () => {},
      setModel: () => {},
    } satisfies PiExtensionAPI

    await expect(setThinkingLevelIfSupported(runtime, 'high')).resolves.toBe(false)
  })

  it('dispatches setThinkingLevel when the runtime supports it', async () => {
    const setThinkingLevel = vi.fn()
    const runtime = {
      on: () => {},
      registerCommand: () => {},
      setThinkingLevel,
    } satisfies PiExtensionAPI

    await expect(setThinkingLevelIfSupported(runtime, 'low')).resolves.toBe(true)
    expect(setThinkingLevel).toHaveBeenCalledWith('low')
  })
})

describe('handleToolExecutionEnd', () => {
  let h: ReturnType<typeof makeFakeHome>
  beforeEach(() => { h = makeFakeHome() })
  afterEach(() => h.cleanup())

  it('writes ~/.overdeck/heartbeats/<id>.json with tool name', async () => {
    await handleToolExecutionEnd(
      { agentId: 'agent-pan-636', home: h.home, pid: 99, now },
      { toolName: 'Bash', isError: false },
    )
    const paths = overdeckPathsFor('agent-pan-636', h.home)
    const body = JSON.parse(readFileSync(paths.heartbeatPath, 'utf8'))
    expect(body).toEqual({
      agent_id: 'agent-pan-636',
      timestamp: fixedTime,
      tool_name: 'Bash',
      last_action: 'tool_end',
      pid: 99,
    })
  })

  it('records tool_error when isError is true', async () => {
    await handleToolExecutionEnd(
      { agentId: 'agent-pan-636', home: h.home, pid: 1, now },
      { toolName: 'Bash', isError: true },
    )
    const body = JSON.parse(
      readFileSync(overdeckPathsFor('agent-pan-636', h.home).heartbeatPath, 'utf8'),
    )
    expect(body.last_action).toBe('tool_error')
  })

  it('PAN-1134: POSTs activity working with the tool name and a cost event', async () => {
    await handleToolExecutionEnd(
      { agentId: 'agent-pan-636', home: h.home, pid: 99, now, issueId: 'PAN-636', role: 'work' },
      { toolName: 'Bash', isError: false, usage: { inputTokens: 10, outputTokens: 3 }, costUsd: 0.001 },
    )
    expect(fetchCalls.length).toBe(2)
    expect(fetchCalls[0]!.body).toEqual({
      kind: 'activity',
      activity: 'working',
      tool: 'Bash',
      timestamp: fixedTime,
    })
    expect(fetchCalls[1]!.body).toMatchObject({
      kind: 'cost-event',
      issueId: 'PAN-636',
      tool: 'Bash',
      usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costUsd: 0.001,
    })
  })
})

describe('handleTurnEnd', () => {
  let h: ReturnType<typeof makeFakeHome>
  beforeEach(() => { h = makeFakeHome() })
  afterEach(() => h.cleanup())

  it('refreshes the heartbeat file with turn_end marker', async () => {
    await handleTurnEnd(
      { agentId: 'agent-pan-636', home: h.home, pid: 7, now },
      {},
    )
    const body = JSON.parse(
      readFileSync(overdeckPathsFor('agent-pan-636', h.home).heartbeatPath, 'utf8'),
    )
    expect(body.last_action).toBe('turn_end')
    expect(body.tool_name).toBe('turn_end')
    expect(body.pid).toBe(7)
  })

  it('PAN-1134: POSTs activity idle and a turn cost event', async () => {
    await handleTurnEnd(
      { agentId: 'agent-pan-636', home: h.home, pid: 7, now, issueId: 'PAN-636' },
      {},
    )
    expect(fetchCalls.length).toBe(2)
    expect(fetchCalls[0]!.body).toEqual({
      kind: 'activity',
      activity: 'idle',
      timestamp: fixedTime,
    })
    expect(fetchCalls[1]!.body).toMatchObject({ kind: 'cost-event', issueId: 'PAN-636', tool: 'turn_end' })
  })

  it('posts work-complete when all issue beads are closed', async () => {
    const workspace = join(h.home, 'workspace')
    mkdirSync(join(workspace, '.beads'), { recursive: true })
    writeFileSync(join(workspace, '.beads', 'issues.jsonl'), `${JSON.stringify({ id: 'b1', title: 'PAN-636 implementation', status: 'closed', labels: ['pan-636'] })}\n`)

    await handleTurnEnd(
      { agentId: 'agent-pan-636', home: h.home, pid: 7, now, role: 'work', issueId: 'PAN-636', workspace },
      {},
    )

    expect(fetchCalls.map(call => call.url)).toContain('http://localhost:3011/api/agents/agent-pan-636/work-complete')
    expect(fetchCalls.some(call => (call.body as any).resolution === 'done')).toBe(true)
  })

  it('routes work turn-end completion from launcher session type env', async () => {
    vi.stubEnv('OVERDECK_SESSION_TYPE', 'work')
    const workspace = join(h.home, 'workspace')
    mkdirSync(join(workspace, '.beads'), { recursive: true })
    writeFileSync(join(workspace, '.beads', 'issues.jsonl'), `${JSON.stringify({ id: 'b1', title: 'PAN-636 implementation', status: 'closed', labels: ['pan-636'] })}\n`)

    await handleTurnEnd(
      { agentId: 'agent-pan-636', home: h.home, pid: 7, now, issueId: 'PAN-636', workspace },
      {},
    )

    expect(fetchCalls.map(call => call.url)).toContain('http://localhost:3011/api/agents/agent-pan-636/work-complete')
    expect(fetchCalls.some(call => (call.body as any).resolution === 'done')).toBe(true)
  })

  it('does not auto-complete work on negated ready-for-review output', async () => {
    await handleTurnEnd(
      { agentId: 'agent-pan-636', home: h.home, pid: 7, now, role: 'work', issueId: 'PAN-636' },
      { output: 'Blocked on failing tests; not ready for review.' },
    )

    expect(fetchCalls.map(call => call.url)).not.toContain('http://localhost:3011/api/agents/agent-pan-636/work-complete')
    expect(fetchCalls.some(call => (call.body as any).resolution === 'done')).toBe(false)
  })

  it('routes specialist auto-completion from launcher session type env', async () => {
    vi.stubEnv('OVERDECK_SESSION_TYPE', 'review')

    await handleTurnEnd(
      { agentId: 'agent-pan-636-review', home: h.home, pid: 7, now, issueId: 'PAN-636' },
      { output: 'OVERDECK_SPECIALIST_RESULT: review-agent passed' },
    )

    expect(fetchCalls.map(call => call.url)).toContain('http://localhost:3011/api/specialists/review-agent/auto-complete')
    expect(fetchCalls.at(-1)!.body).toMatchObject({ agentId: 'agent-pan-636-review', issueId: 'PAN-636', role: 'review', sessionId: null, status: 'passed' })
  })

  it('does not auto-complete specialist output from loose pass phrases', async () => {
    await handleTurnEnd(
      { agentId: 'agent-pan-636-review', home: h.home, pid: 7, now, role: 'review', issueId: 'PAN-636' },
      { output: 'Quoted reviewer text said LGTM and CODE APPROVED, but no final sentinel exists.' },
    )

    expect(fetchCalls.map(call => call.url)).not.toContain('http://localhost:3011/api/specialists/review-agent/auto-complete')
  })

  it('gives structured failure evidence precedence over specialist pass sentinels', async () => {
    await handleTurnEnd(
      { agentId: 'agent-pan-636-review', home: h.home, pid: 7, now, role: 'review', issueId: 'PAN-636' },
      { output: '## Verdict: CHANGES REQUESTED\n\nOVERDECK_SPECIALIST_RESULT: review-agent passed' },
    )

    expect(fetchCalls.map(call => call.url)).toContain('http://localhost:3011/api/specialists/review-agent/auto-complete')
    expect(fetchCalls.at(-1)!.body).toMatchObject({ issueId: 'PAN-636', status: 'failed' })
  })

  it('posts specialist auto-complete with trusted runtime metadata when a specialist marker appears', async () => {
    const paths = overdeckPathsFor('agent-pan-636-review', h.home)
    mkdirSync(paths.agentDir, { recursive: true })
    writeFileSync(paths.sessionIdPath, 'pi-session-123\n')

    await handleTurnEnd(
      { agentId: 'agent-pan-636-review', home: h.home, pid: 7, now, role: 'review', issueId: 'PAN-636' },
      { output: 'OVERDECK_SPECIALIST_RESULT: review-agent passed' },
    )

    expect(fetchCalls.map(call => call.url)).toContain('http://localhost:3011/api/specialists/review-agent/auto-complete')
    expect(fetchCalls.at(-1)!.body).toMatchObject({ agentId: 'agent-pan-636-review', issueId: 'PAN-636', role: 'review', sessionId: 'pi-session-123', status: 'passed' })
  })
})

describe('handlePanDone', () => {
  let h: ReturnType<typeof makeFakeHome>
  beforeEach(() => { h = makeFakeHome() })
  afterEach(() => h.cleanup())

  it('writes the completed marker with the trimmed summary', async () => {
    await handlePanDone(
      { agentId: 'agent-pan-636', home: h.home, now },
      '   Implementation complete   ',
    )
    const paths = overdeckPathsFor('agent-pan-636', h.home)
    const body = JSON.parse(readFileSync(paths.completedPath, 'utf8'))
    expect(body).toEqual({
      agentId: 'agent-pan-636',
      timestamp: fixedTime,
      summary: 'Implementation complete',
    })
  })

  it('writes summary=null when args is empty', async () => {
    await handlePanDone({ agentId: 'agent-pan-636', home: h.home, now }, '')
    const body = JSON.parse(
      readFileSync(overdeckPathsFor('agent-pan-636', h.home).completedPath, 'utf8'),
    )
    expect(body.summary).toBeNull()
  })
})

describe('two extension instances with different agent IDs do not collide', () => {
  let h: ReturnType<typeof makeFakeHome>
  beforeEach(() => { h = makeFakeHome() })
  afterEach(() => h.cleanup())

  it('writes to disjoint files under the same HOME (AC3)', async () => {
    await handleSessionStart(
      { agentId: 'agent-A', home: h.home, pid: 1, now },
      { sessionId: 'sess-A' },
    )
    await handleSessionStart(
      { agentId: 'agent-B', home: h.home, pid: 2, now },
      { sessionId: 'sess-B' },
    )
    await handleToolExecutionEnd(
      { agentId: 'agent-A', home: h.home, pid: 1, now },
      { toolName: 'Read' },
    )
    await handleToolExecutionEnd(
      { agentId: 'agent-B', home: h.home, pid: 2, now },
      { toolName: 'Bash' },
    )

    const a = overdeckPathsFor('agent-A', h.home)
    const b = overdeckPathsFor('agent-B', h.home)
    expect(a.readyPath).not.toBe(b.readyPath)
    expect(a.heartbeatPath).not.toBe(b.heartbeatPath)
    expect(JSON.parse(readFileSync(a.readyPath, 'utf8')).sessionId).toBe('sess-A')
    expect(JSON.parse(readFileSync(b.readyPath, 'utf8')).sessionId).toBe('sess-B')
    expect(JSON.parse(readFileSync(a.heartbeatPath, 'utf8')).tool_name).toBe('Read')
    expect(JSON.parse(readFileSync(b.heartbeatPath, 'utf8')).tool_name).toBe('Bash')
  })
})

describe('default export — Pi extension wiring', () => {
  let h: ReturnType<typeof makeFakeHome>
  let originalHome: string | undefined
  let originalAgentId: string | undefined

  beforeEach(() => {
    h = makeFakeHome()
    originalHome = process.env['HOME']
    originalAgentId = process.env['OVERDECK_AGENT_ID']
    process.env['HOME'] = h.home
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env['HOME']
    else process.env['HOME'] = originalHome
    if (originalAgentId === undefined) delete process.env['OVERDECK_AGENT_ID']
    else process.env['OVERDECK_AGENT_ID'] = originalAgentId
    h.cleanup()
  })

  it('returns silently and registers nothing when OVERDECK_AGENT_ID is unset', () => {
    delete process.env['OVERDECK_AGENT_ID']
    const handlers: Record<string, unknown> = {}
    const commands: Record<string, PiCommand> = {}
    const pi: PiExtensionAPI = {
      on: (event: string, handler) => { handlers[event] = handler },
      registerCommand: (name, command) => { commands[name] = command },
    }
    overdeckPiExtension(pi)
    expect(Object.keys(handlers)).toHaveLength(0)
    expect(Object.keys(commands)).toHaveLength(0)
  })

  it('registers all four hooks when OVERDECK_AGENT_ID is set', () => {
    process.env['OVERDECK_AGENT_ID'] = 'agent-pan-636'
    const handlers: Record<string, unknown> = {}
    const commands: Record<string, PiCommand> = {}
    const pi: PiExtensionAPI = {
      on: (event: string, handler) => { handlers[event] = handler },
      registerCommand: (name, command) => { commands[name] = command },
    }
    overdeckPiExtension(pi)
    expect(Object.keys(handlers).sort()).toEqual(['session_start', 'tool_execution_end', 'turn_end'])
    expect(Object.keys(commands)).toEqual(['pan-done'])
  })
})
