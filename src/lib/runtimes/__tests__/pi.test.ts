import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PiRuntime, createPiRuntime, PiSpawnTimeout } from '../pi.js'
import { getGlobalRegistry, getRuntime, setGlobalRegistry, RuntimeRegistry } from '../index.js'
import { createClaudeCodeRuntime } from '../claude-code.js'
import { createPiFifo } from '../pi-fifo.js'
import { PiNotReady } from '../pi-fifo.js'

const FIXTURE_LINEAR = join(__dirname, '..', '..', 'cost-parsers', '__tests__', 'fixtures', 'pi', 'linear.jsonl')

function withFakeHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'pan-pi-runtime-'))
  const originalHome = process.env['HOME']
  process.env['HOME'] = home
  return {
    home,
    cleanup: () => {
      if (originalHome === undefined) delete process.env['HOME']
      else process.env['HOME'] = originalHome
      rmSync(home, { recursive: true, force: true })
    },
  }
}

describe('PiRuntime registry registration (AC1)', () => {
  let saved: RuntimeRegistry | null = null
  beforeEach(() => {
    saved = (getGlobalRegistry() as unknown as RuntimeRegistry)
    // Reset to a fresh registry so we can re-trigger the default registrations.
    setGlobalRegistry(new RuntimeRegistry())
  })
  afterEach(() => {
    if (saved) setGlobalRegistry(saved)
  })

  it('default global registry contains both claude-code and pi (AC1)', () => {
    const fresh = new RuntimeRegistry()
    fresh.register(createClaudeCodeRuntime())
    fresh.register(createPiRuntime())
    setGlobalRegistry(fresh)
    expect(getRuntime('pi')?.name).toBe('pi')
    expect(getRuntime('claude-code')?.name).toBe('claude-code')
  })
})

describe('PiRuntime.sendMessage', () => {
  let h: ReturnType<typeof withFakeHome>
  beforeEach(() => { h = withFakeHome() })
  afterEach(() => h.cleanup())

  it('rejects with PiNotReady when ready.json is missing (AC3)', async () => {
    const r = new PiRuntime()
    await expect(r.sendMessage('agent-x', 'hello')).rejects.toBeInstanceOf(PiNotReady)
  })
})

describe('PiRuntime.spawnAgent precondition checks', () => {
  let h: ReturnType<typeof withFakeHome>
  beforeEach(() => { h = withFakeHome() })
  afterEach(() => h.cleanup())

  it('rejects synchronously when piExtensionPath is not provided', async () => {
    const r = new PiRuntime()
    await expect(
      r.spawnAgent({ agentId: 'agent-x', workspace: h.home } as any),
    ).rejects.toThrow(/piExtensionPath/)
  })

  // Full spawn flow with a 30s timeout is exercised by the e2e bead
  // workspace-w1o0 (smoke test that drives a real Pi process through one
  // prompt). PiSpawnTimeout is a typed error class — verify it is exported
  // and constructible so consumers can `instanceof` against it.
  it('PiSpawnTimeout is an exported error class with a typed code', () => {
    const err = new PiSpawnTimeout('agent-x')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('PI_SPAWN_TIMEOUT')
    expect(err.message).toMatch(/agent-x/)
  })
})

describe('PiRuntime.getHeartbeat (AC4)', () => {
  let h: ReturnType<typeof withFakeHome>
  beforeEach(() => { h = withFakeHome() })
  afterEach(() => h.cleanup())

  it('returns active-heartbeat source when the heartbeat file is fresh', () => {
    const r = new PiRuntime()
    const beats = join(h.home, '.panopticon', 'heartbeats')
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
    const r = new PiRuntime()
    const beats = join(h.home, '.panopticon', 'heartbeats')
    mkdirSync(beats, { recursive: true })
    // 5 minutes ago — past 60s TTL.
    writeFileSync(
      join(beats, 'agent-B.json'),
      JSON.stringify({
        agent_id: 'agent-B',
        timestamp: new Date(Date.now() - 300_000).toISOString(),
        tool_name: 'old',
      }),
    )
    // Provide a session jsonl so jsonl source has something to point at.
    const sessRoot = join(h.home, '.panopticon', 'agents', 'agent-B', 'sessions')
    mkdirSync(sessRoot, { recursive: true })
    writeFileSync(join(sessRoot, '2026-05-05_x.jsonl'), '{"type":"session"}\n')

    const hb = r.getHeartbeat('agent-B')
    expect(hb).not.toBeNull()
    expect(hb!.source).toBe('jsonl')
    expect(hb!.confidence).toBe('medium')
  })

  it('returns null when no heartbeat file and no jsonl exist', () => {
    const r = new PiRuntime()
    expect(r.getHeartbeat('agent-C')).toBeNull()
  })
})

describe('PiRuntime.getSessionCost (AC5)', () => {
  let h: ReturnType<typeof withFakeHome>
  beforeEach(() => { h = withFakeHome() })
  afterEach(() => h.cleanup())

  it('returns a CostBreakdown derived from parsePiSession on the active session', () => {
    const r = new PiRuntime()
    const sessRoot = join(h.home, '.panopticon', 'agents', 'agent-D', 'sessions')
    mkdirSync(sessRoot, { recursive: true })
    // Reuse the linear fixture we built earlier to verify total flows through.
    const content = require('node:fs').readFileSync(FIXTURE_LINEAR, 'utf-8')
    writeFileSync(join(sessRoot, 'session.jsonl'), content)

    const breakdown = r.getSessionCost('agent-D')
    expect(breakdown).not.toBeNull()
    // Linear fixture totals: 0.0006 + 0.000525.
    expect(breakdown!.totalCost).toBeCloseTo(0.001125, 9)
    expect(breakdown!.currency).toBe('USD')
  })
})

// ── PiRuntime resume behavior (PAN-636 workspace-3119) ──────────────────────
// The pi-extension persists ~/.panopticon/agents/<id>/session.id on every
// session_start with a non-null sessionId; PiRuntime.spawnAgent reads that
// file and forwards it as `pi --session <id>` so the next spawn lands in the
// same Pi session. We mock tmux out so we can drive spawnAgent end-to-end
// without a real shell process.
vi.mock('../../tmux.js', async () => {
  const actual = await vi.importActual<typeof import('../../tmux.js')>('../../tmux.js')
  return {
    ...actual,
    createSessionAsync: vi.fn(async () => undefined),
    sessionExistsAsync: vi.fn(async () => false),
    killSessionAsync: vi.fn(async () => undefined),
  }
})

describe('PiRuntime.spawnAgent resume via session.id (PAN-636 workspace-3119)', () => {
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
    const dir = join(h.home, '.panopticon', 'agents', agentId)
    mkdirSync(dir, { recursive: true })
    // waitForReady polls existsSync(ready.json) — pre-create so spawnAgent
    // returns immediately instead of polling for 30s.
    writeFileSync(join(dir, 'ready.json'), JSON.stringify({ sessionId: 'irrelevant' }))
  }

  it('AC2: re-spawning after a kill emits `pi --session <id>` when session.id is present', async () => {
    const agentId = 'agent-resume-1'
    const dir = join(h.home, '.panopticon', 'agents', agentId)
    const sessionsDir = join(dir, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    // Simulate a prior spawn that already wrote session.id and one .jsonl
    writeFileSync(join(dir, 'session.id'), 'sess-stored-7777\n')
    writeFileSync(join(sessionsDir, '01a-session.jsonl'), '{"type":"session"}\n')
    preCreateReady(agentId)

    const r = new PiRuntime()
    await r.spawnAgent({
      agentId,
      workspace: h.home,
      model: 'claude-sonnet-4-6',
      piExtensionPath: '/tmp/fake-extension/dist/index.js',
    } as any)

    const launcher = require('node:fs').readFileSync(join(dir, 'pi-launcher.sh'), 'utf-8')
    expect(launcher).toMatch(/--session\s+'?sess-stored-7777'?/)
  })

  it('AC3: omits --session and warns when sessions/*.jsonl exists but session.id is missing', async () => {
    const agentId = 'agent-resume-2'
    const dir = join(h.home, '.panopticon', 'agents', agentId)
    const sessionsDir = join(dir, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    writeFileSync(join(sessionsDir, '01a-session.jsonl'), '{"type":"session"}\n')
    // session.id intentionally absent
    preCreateReady(agentId)

    const r = new PiRuntime()
    await r.spawnAgent({
      agentId,
      workspace: h.home,
      model: 'claude-sonnet-4-6',
      piExtensionPath: '/tmp/fake-extension/dist/index.js',
    } as any)

    const launcher = require('node:fs').readFileSync(join(dir, 'pi-launcher.sh'), 'utf-8')
    expect(launcher).not.toMatch(/--session\s+\S/)

    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(warned).toMatch(/session\.id is missing/)
  })

  it('first-ever spawn (no prior sessions/*.jsonl, no session.id) does NOT warn — clean path', async () => {
    const agentId = 'agent-resume-3-first'
    preCreateReady(agentId)

    const r = new PiRuntime()
    await r.spawnAgent({
      agentId,
      workspace: h.home,
      model: 'claude-sonnet-4-6',
      piExtensionPath: '/tmp/fake-extension/dist/index.js',
    } as any)

    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(warned).not.toMatch(/session\.id/)
  })
})

describe('PiRuntime.killAgent escalation ladder + cleanup (PAN-636 bead 8qco)', () => {
  let h: ReturnType<typeof withFakeHome>
  beforeEach(() => { h = withFakeHome() })
  afterEach(() => h.cleanup())

  it('removes rpc.in, ready.json, completed, and heartbeat — but NEVER session JSONL files', async () => {
    const r = new PiRuntime()
    await createPiFifo('agent-K')
    const agentDir = join(h.home, '.panopticon', 'agents', 'agent-K')
    const heartbeatsRoot = join(h.home, '.panopticon', 'heartbeats')
    const sessRoot = join(agentDir, 'sessions')
    require('node:fs').mkdirSync(sessRoot, { recursive: true })
    require('node:fs').mkdirSync(heartbeatsRoot, { recursive: true })
    require('node:fs').writeFileSync(join(agentDir, 'ready.json'), '{}')
    require('node:fs').writeFileSync(join(agentDir, 'completed'), '{}')
    require('node:fs').writeFileSync(join(heartbeatsRoot, 'agent-K.json'), '{}')
    // Sacred — must survive killAgent.
    const sacredJsonl = join(sessRoot, '019df-x.jsonl')
    require('node:fs').writeFileSync(sacredJsonl, '{"type":"session"}\n')

    await r.killAgent('agent-K')

    expect(require('node:fs').existsSync(join(agentDir, 'rpc.in'))).toBe(false)
    expect(require('node:fs').existsSync(join(agentDir, 'ready.json'))).toBe(false)
    expect(require('node:fs').existsSync(join(agentDir, 'completed'))).toBe(false)
    expect(require('node:fs').existsSync(join(heartbeatsRoot, 'agent-K.json'))).toBe(false)
    // The sacred-JSONL invariant: session jsonls survive killAgent.
    expect(require('node:fs').existsSync(sacredJsonl)).toBe(true)
  })

  it('exits within ~3s when there is no tmux session to escalate against', async () => {
    const r = new PiRuntime()
    await createPiFifo('agent-K2')
    const start = Date.now()
    await r.killAgent('agent-K2')
    expect(Date.now() - start).toBeLessThan(3_500)
  })
})
