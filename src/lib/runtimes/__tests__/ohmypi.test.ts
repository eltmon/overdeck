import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { OhmypiRuntimeSync, createOhmypiRuntimeSync, OhmypiSpawnTimeout } from '../ohmypi.js'
import { getGlobalRegistry, getRuntime, setGlobalRegistry, RuntimeRegistry } from '../index.js'
import { createClaudeCodeRuntimeSync } from '../claude-code.js'
import { createOhmypiFifo } from '../ohmypi-fifo.js'
import { OhmypiNotReady } from '../ohmypi-fifo.js'
import { sessionExists } from '../../tmux.js'

const FIXTURE_LINEAR = join(__dirname, '..', '..', 'cost-parsers', '__tests__', 'fixtures', 'pi', 'linear.jsonl')

function withFakeHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'pan-ohmypi-runtime-'))
  const originalHome = process.env['HOME']
  const originalOverdeckHome = process.env.OVERDECK_HOME
  process.env['HOME'] = home
  process.env.OVERDECK_HOME = join(home, '.overdeck')
  return {
    home,
    cleanup: () => {
      if (originalHome === undefined) delete process.env['HOME']
      else process.env['HOME'] = originalHome
      if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME
      else process.env.OVERDECK_HOME = originalOverdeckHome
      rmSync(home, { recursive: true, force: true })
    },
  }
}

describe('OhmypiRuntime registry registration (AC1)', () => {
  let saved: RuntimeRegistry | null = null
  beforeEach(() => {
    saved = (getGlobalRegistry() as unknown as RuntimeRegistry)
    setGlobalRegistry(new RuntimeRegistry())
  })
  afterEach(() => {
    if (saved) setGlobalRegistry(saved)
  })

  it('default global registry contains both claude-code and ohmypi (AC1)', () => {
    const fresh = new RuntimeRegistry()
    fresh.register(createClaudeCodeRuntimeSync())
    fresh.register(createOhmypiRuntimeSync())
    setGlobalRegistry(fresh)
    expect(getRuntime('ohmypi')?.name).toBe('ohmypi')
    expect(getRuntime('claude-code')?.name).toBe('claude-code')
  })
})

describe('OhmypiRuntime.sendMessage', () => {
  let h: ReturnType<typeof withFakeHome>
  beforeEach(() => { h = withFakeHome() })
  afterEach(() => h.cleanup())

  it('rejects with OhmypiNotReady when ready.json is missing (AC3)', async () => {
    const r = new OhmypiRuntimeSync()
    await expect(r.sendMessage('agent-x', 'hello')).rejects.toBeInstanceOf(OhmypiNotReady)
  })
})

describe('OhmypiRuntime.spawnAgent precondition checks', () => {
  let h: ReturnType<typeof withFakeHome>
  beforeEach(() => { h = withFakeHome() })
  afterEach(() => h.cleanup())

  it('rejects synchronously when piExtensionPath is not provided', async () => {
    const r = new OhmypiRuntimeSync()
    await expect(
      r.spawnAgent({ agentId: 'agent-x', workspace: h.home } as any),
    ).rejects.toThrow(/piExtensionPath/)
  })

  it('OhmypiSpawnTimeout is an exported error class with a typed code', () => {
    const err = new OhmypiSpawnTimeout('agent-x')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('OHMYPI_SPAWN_TIMEOUT')
    expect(err.message).toMatch(/agent-x/)
  })

  it('PAN-2101: timeout includes crash text captured in output.log', () => {
    const dir = join(h.home, '.overdeck', 'agents', 'agent-crash')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'output.log'), [
      'starting omp rpc mode',
      'Error: synthetic omp crash before ready.json',
    ].join('\n'))

    const err = new OhmypiSpawnTimeout('agent-crash')

    expect(err.message).toContain('output.log tail:')
    expect(err.message).toContain('synthetic omp crash')
    expect(err.message).toContain('ready.json')
  })
})

describe('OhmypiRuntime.getHeartbeat (AC4)', () => {
  let h: ReturnType<typeof withFakeHome>
  beforeEach(() => { h = withFakeHome() })
  afterEach(() => h.cleanup())

  it('returns active-heartbeat source when the heartbeat file is fresh', () => {
    const r = new OhmypiRuntimeSync()
    const beats = join(h.home, '.overdeck', 'heartbeats')
    mkdirSync(beats, { recursive: true })
    writeFileSync(
      join(beats, 'agent-A.json'),
      JSON.stringify({
        agent_id: 'agent-A',
        timestamp: new Date().toISOString(),
        tool_name: 'Bash',
        last_action: 'tool_end',
        pid: 1234,
      }),
    )
    const hb = r.getHeartbeat('agent-A')
    expect(hb).not.toBeNull()
    expect(hb!.source).toBe('active-heartbeat')
    expect(hb!.toolName).toBe('Bash')
    expect(hb!.confidence).toBe('high')
  })

  it('falls back to jsonl mtime when heartbeat is stale', () => {
    const r = new OhmypiRuntimeSync()
    const beats = join(h.home, '.overdeck', 'heartbeats')
    mkdirSync(beats, { recursive: true })
    writeFileSync(
      join(beats, 'agent-B.json'),
      JSON.stringify({
        agent_id: 'agent-B',
        timestamp: new Date(Date.now() - 300_000).toISOString(),
        tool_name: 'old',
      }),
    )
    const sessRoot = join(h.home, '.overdeck', 'agents', 'agent-B', 'sessions')
    mkdirSync(sessRoot, { recursive: true })
    writeFileSync(join(sessRoot, '2026-05-05_x.jsonl'), '{"type":"session"}\n')

    const hb = r.getHeartbeat('agent-B')
    expect(hb).not.toBeNull()
    expect(hb!.source).toBe('jsonl')
    expect(hb!.confidence).toBe('medium')
  })

  it('returns null when no heartbeat file and no jsonl exist', () => {
    const r = new OhmypiRuntimeSync()
    expect(r.getHeartbeat('agent-C')).toBeNull()
  })
})

describe('OhmypiRuntime.getSessionCost (AC5)', () => {
  let h: ReturnType<typeof withFakeHome>
  beforeEach(() => { h = withFakeHome() })
  afterEach(() => h.cleanup())

  it('returns a CostBreakdown derived from parseOhmypiSession on the active session', () => {
    const r = new OhmypiRuntimeSync()
    const sessRoot = join(h.home, '.overdeck', 'agents', 'agent-D', 'sessions')
    mkdirSync(sessRoot, { recursive: true })
    const content = require('node:fs').readFileSync(FIXTURE_LINEAR, 'utf-8')
    writeFileSync(join(sessRoot, 'session.jsonl'), content)

    const breakdown = r.getSessionCost('agent-D')
    expect(breakdown).not.toBeNull()
    // Linear fixture totals: 0.0006 + 0.000525.
    expect(breakdown!.totalCost).toBeCloseTo(0.001125, 9)
    expect(breakdown!.currency).toBe('USD')
  })
})

const execMock = vi.hoisted(() => vi.fn((_cmd: string, _options?: unknown) => ''))
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  const kCustom = Symbol.for('nodejs.util.promisify.custom')

  function exec(cmd: string, optionsOrCb: unknown, maybeCallback?: unknown) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback
    const options = typeof optionsOrCb === 'function' ? undefined : optionsOrCb
    try {
      const result = execMock(cmd, options)
      ;(callback as (err: Error | null, stdout?: string, stderr?: string) => void)(null, result ?? '', '')
    } catch (err) {
      ;(callback as (err: Error | null, stdout?: string, stderr?: string) => void)(err as Error, '', '')
    }
  }
  ;(exec as any)[kCustom] = (cmd: string, options?: unknown) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      try {
        const result = execMock(cmd, options)
        resolve({ stdout: result ?? '', stderr: '' })
      } catch (err) {
        reject(err)
      }
    })

  return {
    ...actual,
    exec,
  }
})

vi.mock('../../tmux.js', async () => {
  const actual = await vi.importActual<typeof import('../../tmux.js')>('../../tmux.js')
  return {
    ...actual,
    createSession: vi.fn(() => Effect.succeed(undefined)),
    sessionExists: vi.fn(() => Effect.succeed(false)),
    killSession: vi.fn(() => Effect.succeed(undefined)),
  }
})

describe('OhmypiRuntime.spawnAgent resume via session.id (PAN-636 / PAN-1989)', () => {
  let h: ReturnType<typeof withFakeHome>
  let warnSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    h = withFakeHome()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
    h.cleanup()
  })

  function preCreateReady(agentId: string): void {
    const dir = join(h.home, '.overdeck', 'agents', agentId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'ready.json'), JSON.stringify({ sessionId: 'irrelevant' }))
  }

  it('AC2: re-spawning after a kill passes resumeSessionId to the launcher when session.id is present', async () => {
    const agentId = 'agent-resume-1'
    const dir = join(h.home, '.overdeck', 'agents', agentId)
    const sessionsDir = join(dir, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(join(dir, 'session.id'), 'sess-stored-7777\n')
    writeFileSync(join(sessionsDir, '01a-session.jsonl'), '{"type":"session"}\n')
    preCreateReady(agentId)

    const r = new OhmypiRuntimeSync()
    await r.spawnAgent({
      agentId,
      workspace: h.home,
      model: 'claude-sonnet-4-6',
      piExtensionPath: '/tmp/fake-extension/dist/index.js',
    } as any)

    const launcher = require('node:fs').readFileSync(join(dir, 'ohmypi-launcher.sh'), 'utf-8')
    // omp uses --resume (updated from pi's --session in PAN-1989 launcher bead)
    expect(launcher).toMatch(/sess-stored-7777/)
  })

  it('AC3: goes fresh and warns only when NEITHER session.id NOR a parseable session id exists', async () => {
    const agentId = 'agent-resume-2'
    const dir = join(h.home, '.overdeck', 'agents', agentId)
    const sessionsDir = join(dir, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(join(sessionsDir, '01a-session.jsonl'), '{"type":"session"}\n')
    preCreateReady(agentId)

    const r = new OhmypiRuntimeSync()
    await r.spawnAgent({
      agentId,
      workspace: h.home,
      model: 'claude-sonnet-4-6',
      piExtensionPath: '/tmp/fake-extension/dist/index.js',
    } as any)

    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(warned).toMatch(/no resumable session id/)
  })

  it('PAN-1988: recovers the real session id from the freshest JSONL when session.id is absent', async () => {
    const agentId = 'agent-resume-jsonl'
    const dir = join(h.home, '.overdeck', 'agents', agentId)
    const sessionsDir = join(dir, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(join(sessionsDir, '01a-session.jsonl'), '{"type":"session","version":3,"id":"real-ohmypi-sess-9999","timestamp":"2026-05-05T10:00:00.000Z"}\n')
    preCreateReady(agentId)

    const r = new OhmypiRuntimeSync()
    await r.spawnAgent({
      agentId,
      workspace: h.home,
      model: 'claude-sonnet-4-6',
      piExtensionPath: '/tmp/fake-extension/dist/index.js',
    } as any)

    const launcher = require('node:fs').readFileSync(join(dir, 'ohmypi-launcher.sh'), 'utf-8')
    expect(launcher).toMatch(/real-ohmypi-sess-9999/)

    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(warned).not.toMatch(/no resumable session id/)
  })

  it('first-ever spawn (no prior sessions/*.jsonl, no session.id) does NOT warn — clean path', async () => {
    const agentId = 'agent-resume-3-first'
    preCreateReady(agentId)

    const r = new OhmypiRuntimeSync()
    await r.spawnAgent({
      agentId,
      workspace: h.home,
      model: 'claude-sonnet-4-6',
      piExtensionPath: '/tmp/fake-extension/dist/index.js',
    } as any)

    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(warned).not.toMatch(/session\.id/)
  })

  it('AC(launcher-omp): launcher contains omp binary and no pi --mode invocation', async () => {
    const agentId = 'agent-omp-binary'
    const dir = join(h.home, '.overdeck', 'agents', agentId)
    preCreateReady(agentId)

    const r = new OhmypiRuntimeSync()
    await r.spawnAgent({
      agentId,
      workspace: h.home,
      model: 'claude-sonnet-4-6',
      piExtensionPath: '/tmp/fake-extension/dist/index.js',
    } as any)

    const launcher = require('node:fs').readFileSync(join(dir, 'ohmypi-launcher.sh'), 'utf-8')
    expect(launcher).toMatch(/\bomp\b/)
    expect(launcher).not.toMatch(/\bpi --mode\b/)
  })
})

describe('OhmypiRuntime.killAgent escalation ladder + cleanup (PAN-1989)', () => {
  let h: ReturnType<typeof withFakeHome>
  beforeEach(() => { h = withFakeHome() })
  afterEach(() => h.cleanup())

  it('removes rpc.in, ready.json, completed, and heartbeat — but NEVER session JSONL files', async () => {
    const r = new OhmypiRuntimeSync()
    await Effect.runPromise(createOhmypiFifo('agent-K'))
    const agentDir = join(h.home, '.overdeck', 'agents', 'agent-K')
    const heartbeatsRoot = join(h.home, '.overdeck', 'heartbeats')
    const sessRoot = join(agentDir, 'sessions')
    require('node:fs').mkdirSync(sessRoot, { recursive: true })
    require('node:fs').mkdirSync(heartbeatsRoot, { recursive: true })
    require('node:fs').writeFileSync(join(agentDir, 'ready.json'), '{}')
    require('node:fs').writeFileSync(join(agentDir, 'completed'), '{}')
    require('node:fs').writeFileSync(join(heartbeatsRoot, 'agent-K.json'), '{}')
    const sacredJsonl = join(sessRoot, '019df-x.jsonl')
    require('node:fs').writeFileSync(sacredJsonl, '{"type":"session"}\n')

    await r.killAgent('agent-K')

    expect(require('node:fs').existsSync(join(agentDir, 'rpc.in'))).toBe(false)
    expect(require('node:fs').existsSync(join(agentDir, 'ready.json'))).toBe(false)
    expect(require('node:fs').existsSync(join(agentDir, 'completed'))).toBe(false)
    expect(require('node:fs').existsSync(join(heartbeatsRoot, 'agent-K.json'))).toBe(false)
    // Sacred-JSONL invariant: session jsonls survive killAgent.
    expect(require('node:fs').existsSync(sacredJsonl)).toBe(true)
  })

  it('exits within ~3s when there is no tmux session to escalate against', async () => {
    const r = new OhmypiRuntimeSync()
    await Effect.runPromise(createOhmypiFifo('agent-K2'))
    const start = Date.now()
    await r.killAgent('agent-K2')
    expect(Date.now() - start).toBeLessThan(3_500)
  })
})

describe('OhmypiRuntime.killAgent PAN-1798 server-kill guard', () => {
  let h: ReturnType<typeof withFakeHome>
  const mockedSessionExists = vi.mocked(sessionExists)

  beforeEach(() => {
    h = withFakeHome()
    execMock.mockClear()
    mockedSessionExists.mockClear()
  })
  afterEach(() => h.cleanup())

  it('kills the pane process group by PID and never uses pkill -f', async () => {
    const sessionAliveStart = Date.now()
    mockedSessionExists.mockImplementation(() => {
      const alive = Date.now() - sessionAliveStart < 2_500
      return Effect.succeed(alive) as ReturnType<typeof sessionExists>
    })

    execMock.mockImplementation((cmd: string) => {
      if (cmd.includes('list-panes') && cmd.includes('agent-PAN1798')) {
        return '4242\n'
      }
      return ''
    })

    const r = new OhmypiRuntimeSync()
    await Effect.runPromise(createOhmypiFifo('agent-PAN1798'))
    await r.killAgent('agent-PAN1798')

    const commands = execMock.mock.calls.map((c) => String(c[0]))
    expect(commands.some((c) => c.includes('pkill -f'))).toBe(false)
    expect(commands.some((c) => c.includes('kill -TERM -- -4242'))).toBe(true)
  })
})

describe('OhmypiFifo FIFO delivery (resume→FIFO path, PAN-1859)', () => {
  let h: ReturnType<typeof withFakeHome>
  beforeEach(() => { h = withFakeHome() })
  afterEach(() => h.cleanup())

  it('OhmypiNotReady is thrown when the agent is not ready (sendMessage guard)', async () => {
    const r = new OhmypiRuntimeSync()
    // No ready.json — sendMessage must throw OhmypiNotReady.
    await expect(r.sendMessage('agent-fifo-test', 'test msg')).rejects.toBeInstanceOf(OhmypiNotReady)
  })
})
