import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import panopticonPiExtension, {
  handleSessionStart,
  handleToolExecutionEnd,
  handleTurnEnd,
  handlePanDone,
  panopticonPathsFor,
  type PiExtensionAPI,
  type PiCommand,
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

describe('handleSessionStart', () => {
  let h: ReturnType<typeof makeFakeHome>
  beforeEach(() => { h = makeFakeHome() })
  afterEach(() => h.cleanup())

  it('writes ~/.panopticon/agents/<id>/ready.json with sessionId and pid', async () => {
    await handleSessionStart(
      { agentId: 'agent-pan-636', home: h.home, pid: 4242, now },
      { reason: 'new', sessionId: 'sess-abc' },
    )
    const paths = panopticonPathsFor('agent-pan-636', h.home)
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

  it('AC1 (PAN-636 workspace-3119): also writes ~/.panopticon/agents/<id>/session.id with the Pi session id', async () => {
    await handleSessionStart(
      { agentId: 'agent-pan-636', home: h.home, pid: 4242, now },
      { reason: 'new', sessionId: 'sess-resume-target' },
    )
    const paths = panopticonPathsFor('agent-pan-636', h.home)
    expect(existsSync(paths.sessionIdPath)).toBe(true)
    expect(readFileSync(paths.sessionIdPath, 'utf8').trim()).toBe('sess-resume-target')
  })

  it('does NOT write session.id when Pi reports a null/missing sessionId — null would defeat resume', async () => {
    await handleSessionStart(
      { agentId: 'agent-pan-636', home: h.home, pid: 4242, now },
      { reason: 'new' /* sessionId omitted */ },
    )
    const paths = panopticonPathsFor('agent-pan-636', h.home)
    expect(existsSync(paths.sessionIdPath)).toBe(false)
  })

  it('PAN-1134: writes events.jsonl with model_set + activity idle', async () => {
    await handleSessionStart(
      { agentId: 'agent-pan-636', home: h.home, pid: 4242, now },
      { reason: 'new', sessionId: 'sess-abc' },
    )
    const paths = panopticonPathsFor('agent-pan-636', h.home)
    expect(existsSync(paths.eventsPath)).toBe(true)
    const lines = readFileSync(paths.eventsPath, 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]!)).toEqual({
      kind: 'model_set',
      model: 'pi',
      claudeSessionId: 'sess-abc',
      timestamp: fixedTime,
    })
    expect(JSON.parse(lines[1]!)).toEqual({
      kind: 'activity',
      activity: 'idle',
      timestamp: fixedTime,
    })
  })
})

describe('handleToolExecutionEnd', () => {
  let h: ReturnType<typeof makeFakeHome>
  beforeEach(() => { h = makeFakeHome() })
  afterEach(() => h.cleanup())

  it('writes ~/.panopticon/heartbeats/<id>.json with tool name', async () => {
    await handleToolExecutionEnd(
      { agentId: 'agent-pan-636', home: h.home, pid: 99, now },
      { toolName: 'Bash', isError: false },
    )
    const paths = panopticonPathsFor('agent-pan-636', h.home)
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
      readFileSync(panopticonPathsFor('agent-pan-636', h.home).heartbeatPath, 'utf8'),
    )
    expect(body.last_action).toBe('tool_error')
  })

  it('PAN-1134: writes events.jsonl with activity working', async () => {
    await handleToolExecutionEnd(
      { agentId: 'agent-pan-636', home: h.home, pid: 99, now },
      { toolName: 'Bash', isError: false },
    )
    const paths = panopticonPathsFor('agent-pan-636', h.home)
    expect(existsSync(paths.eventsPath)).toBe(true)
    const lines = readFileSync(paths.eventsPath, 'utf8').trim().split('\n')
    expect(lines.length).toBe(1)
    expect(JSON.parse(lines[0]!)).toEqual({
      kind: 'activity',
      activity: 'working',
      tool: 'Bash',
      timestamp: fixedTime,
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
      readFileSync(panopticonPathsFor('agent-pan-636', h.home).heartbeatPath, 'utf8'),
    )
    expect(body.last_action).toBe('turn_end')
    expect(body.tool_name).toBe('turn_end')
    expect(body.pid).toBe(7)
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
    const paths = panopticonPathsFor('agent-pan-636', h.home)
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
      readFileSync(panopticonPathsFor('agent-pan-636', h.home).completedPath, 'utf8'),
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

    const a = panopticonPathsFor('agent-A', h.home)
    const b = panopticonPathsFor('agent-B', h.home)
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
    originalAgentId = process.env['PANOPTICON_AGENT_ID']
    process.env['HOME'] = h.home
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env['HOME']
    else process.env['HOME'] = originalHome
    if (originalAgentId === undefined) delete process.env['PANOPTICON_AGENT_ID']
    else process.env['PANOPTICON_AGENT_ID'] = originalAgentId
    h.cleanup()
  })

  it('returns silently and registers nothing when PANOPTICON_AGENT_ID is unset', () => {
    delete process.env['PANOPTICON_AGENT_ID']
    const handlers: Record<string, unknown> = {}
    const commands: Record<string, PiCommand> = {}
    const pi: PiExtensionAPI = {
      on: (event: string, handler) => { handlers[event] = handler },
      registerCommand: (name, command) => { commands[name] = command },
    }
    panopticonPiExtension(pi)
    expect(Object.keys(handlers)).toHaveLength(0)
    expect(Object.keys(commands)).toHaveLength(0)
  })

  it('registers all four hooks when PANOPTICON_AGENT_ID is set', () => {
    process.env['PANOPTICON_AGENT_ID'] = 'agent-pan-636'
    const handlers: Record<string, unknown> = {}
    const commands: Record<string, PiCommand> = {}
    const pi: PiExtensionAPI = {
      on: (event: string, handler) => { handlers[event] = handler },
      registerCommand: (name, command) => { commands[name] = command },
    }
    panopticonPiExtension(pi)
    expect(Object.keys(handlers).sort()).toEqual(['session_start', 'tool_execution_end', 'turn_end'])
    expect(Object.keys(commands)).toEqual(['pan-done'])
  })
})
