import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CodexRuntimeSync, findRolloutPath, writeThreadId, initCodexHome, extractThreadIdFromRollout } from '../codex.js'
import { getGlobalRegistry, getRuntime, setGlobalRegistry, RuntimeRegistry } from '../index.js'
import { createClaudeCodeRuntimeSync } from '../claude-code.js'
import { createPiRuntimeSync } from '../pi.js'
import { createCodexRuntimeSync } from '../codex.js'

function withFakeCodexHome(): { codexHome: string; agentsHome: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'pan-codex-runtime-'))
  const codexHome = join(base, '.codex')
  const agentsHome = join(base, '.panopticon', 'agents')
  mkdirSync(codexHome, { recursive: true })
  mkdirSync(agentsHome, { recursive: true })
  const originalCodexHome = process.env['CODEX_HOME']
  const originalHome = process.env['HOME']
  process.env['CODEX_HOME'] = codexHome
  process.env['HOME'] = base
  return {
    codexHome,
    agentsHome,
    cleanup: () => {
      if (originalCodexHome === undefined) {
        delete process.env['CODEX_HOME']
      } else {
        process.env['CODEX_HOME'] = originalCodexHome
      }
      if (originalHome === undefined) {
        delete process.env['HOME']
      } else {
        process.env['HOME'] = originalHome
      }
      rmSync(base, { recursive: true, force: true })
    },
  }
}

describe('CodexRuntimeSync — session path resolution', () => {
  let ctx: ReturnType<typeof withFakeCodexHome>

  beforeEach(() => { ctx = withFakeCodexHome() })
  afterEach(() => ctx.cleanup())

  it('returns null when no thread-id file exists', () => {
    const rt = new CodexRuntimeSync()
    expect(rt.getSessionPath('agent-test-01')).toBeNull()
  })

  it('resolves the rollout JSONL by thread-id under the per-agent CODEX_HOME/sessions', () => {
    const threadId = 'abc1234567890def'
    // Build a realistic date-partitioned rollout tree in the per-agent CODEX_HOME.
    // getSessionPath now uses ~/.panopticon/agents/<id>/codex-home, not the global ~/.codex.
    const agentDir = join(ctx.agentsHome, 'agent-test-01')
    const perAgentCodexHome = join(agentDir, 'codex-home')
    const dayDir = join(perAgentCodexHome, 'sessions', '2025', '06', '01')
    mkdirSync(dayDir, { recursive: true })
    const rolloutPath = join(dayDir, `rollout-some-uuid-${threadId}.jsonl`)
    writeFileSync(rolloutPath, '{"type":"message"}\n')

    mkdirSync(agentDir, { recursive: true })
    writeThreadId('agent-test-01', threadId)

    const rt = new CodexRuntimeSync()
    expect(rt.getSessionPath('agent-test-01')).toBe(rolloutPath)
  })

  it('returns null when thread-id is present but no matching rollout exists', () => {
    const agentDir = join(ctx.agentsHome, 'agent-test-02')
    mkdirSync(agentDir, { recursive: true })
    writeThreadId('agent-test-02', 'no-such-thread')

    const rt = new CodexRuntimeSync()
    expect(rt.getSessionPath('agent-test-02')).toBeNull()
  })
})

describe('findRolloutPath', () => {
  let ctx: ReturnType<typeof withFakeCodexHome>
  beforeEach(() => { ctx = withFakeCodexHome() })
  afterEach(() => ctx.cleanup())

  it('finds a rollout in a nested date tree', () => {
    const threadId = 'thread123'
    const dir = join(ctx.codexHome, 'sessions', '2025', '12', '31')
    mkdirSync(dir, { recursive: true })
    const rollout = join(dir, `rollout-uuid-${threadId}.jsonl`)
    writeFileSync(rollout, '')

    expect(findRolloutPath(ctx.codexHome, threadId)).toBe(rollout)
  })

  it('returns null when sessions directory does not exist', () => {
    expect(findRolloutPath(ctx.codexHome, 'missing')).toBeNull()
  })
})

describe('initCodexHome', () => {
  let ctx: ReturnType<typeof withFakeCodexHome>
  beforeEach(() => { ctx = withFakeCodexHome() })
  afterEach(() => ctx.cleanup())

  it('creates sessions/ subdirectory', () => {
    const codexDir = join(ctx.codexHome, 'agent-init-01')
    initCodexHome(codexDir)
    const { existsSync: existsNode } = require('node:fs')
    expect(existsNode(join(codexDir, 'sessions'))).toBe(true)
  })

  it('writes config.toml with flat top-level Codex keys', () => {
    const codexDir = join(ctx.codexHome, 'agent-init-02')
    initCodexHome(codexDir)
    const { readFileSync: readNode } = require('node:fs')
    const config = readNode(join(codexDir, 'config.toml'), 'utf8')
    // approval_policy is a flat top-level string, not an [approval] table.
    expect(config).toContain('approval_policy = "never"')
    // No TOML table sections — Codex deserializes these keys as scalars, and a
    // `[model]` table breaks config load with "invalid type: map, expected a
    // string in `model`" (PAN-1574 regression).
    expect(config).not.toMatch(/^\[(model|approval|notify)\]/m)
  })

  it('is idempotent — does not overwrite existing config', () => {
    const codexDir = join(ctx.codexHome, 'agent-init-03')
    initCodexHome(codexDir)
    const { writeFileSync: writeNode, readFileSync: readNode } = require('node:fs')
    writeNode(join(codexDir, 'config.toml'), 'custom-content')
    initCodexHome(codexDir) // second call — should not overwrite
    const config = readNode(join(codexDir, 'config.toml'), 'utf8')
    expect(config).toBe('custom-content')
  })
})

describe('extractThreadIdFromRollout', () => {
  it('extracts the last segment as thread-id', () => {
    expect(extractThreadIdFromRollout('/path/to/rollout-uuid-abc123.jsonl')).toBe('abc123')
  })

  it('handles multi-segment UUIDs', () => {
    expect(extractThreadIdFromRollout('/path/rollout-a1b2c3d4-e5f6-g7h8-i9j0-k1l2m3n4o5p6-mythread.jsonl')).toBe('mythread')
  })

  it('returns null for invalid filenames', () => {
    expect(extractThreadIdFromRollout('/path/notarollout.jsonl')).toBeNull()
  })
})

describe('CodexRuntimeSync.killAgent — JSONL-is-sacred', () => {
  let ctx: ReturnType<typeof withFakeCodexHome>

  beforeEach(() => { ctx = withFakeCodexHome() })
  afterEach(() => ctx.cleanup())

  it('does not delete the rollout JSONL during a kill (JSONL-is-sacred)', async () => {
    const threadId = 'killtest123'
    const dayDir = join(ctx.codexHome, 'sessions', '2025', '06', '01')
    mkdirSync(dayDir, { recursive: true })
    const rolloutPath = join(dayDir, `rollout-uuid-${threadId}.jsonl`)
    writeFileSync(rolloutPath, '{"type":"task_started"}\n')

    const agentDir = join(ctx.agentsHome, 'agent-kill-01')
    mkdirSync(agentDir, { recursive: true })
    writeThreadId('agent-kill-01', threadId)

    const rt = new CodexRuntimeSync()
    // killAgent with a non-existent session should complete without throwing.
    // (No real tmux session to kill in unit test — it will no-op the ladder.)
    await expect(rt.killAgent('agent-kill-01')).resolves.not.toThrow()

    // Rollout JSONL must still exist after kill.
    const { existsSync: existsSyncNode } = await import('node:fs')
    expect(existsSyncNode(rolloutPath)).toBe(true)
  })
})

describe('CodexRuntimeSync.getHeartbeat — 3-tier ladder', () => {
  let ctx: ReturnType<typeof withFakeCodexHome>

  beforeEach(() => { ctx = withFakeCodexHome() })
  afterEach(() => ctx.cleanup())

  it('tier 1: returns high-confidence heartbeat from a fresh heartbeat.json (<60s)', () => {
    const agentId = 'agent-hb-01'
    const heartbeatDir = join(ctx.agentsHome, '..', 'heartbeats')
    mkdirSync(heartbeatDir, { recursive: true })
    const heartbeatPath = join(heartbeatDir, `${agentId}.json`)
    const now = new Date().toISOString()
    writeFileSync(heartbeatPath, JSON.stringify({ timestamp: now, tool_name: 'Bash', last_action: 'ran tests' }))

    const rt = new CodexRuntimeSync()
    const hb = rt.getHeartbeat(agentId)
    expect(hb).not.toBeNull()
    expect(hb!.source).toBe('active-heartbeat')
    expect(hb!.confidence).toBe('high')
    expect(hb!.toolName).toBe('Bash')
  })

  it('tier 1: ignores a stale heartbeat.json (>60s old) and falls through', () => {
    const agentId = 'agent-hb-stale'
    const heartbeatDir = join(ctx.agentsHome, '..', 'heartbeats')
    mkdirSync(heartbeatDir, { recursive: true })
    const heartbeatPath = join(heartbeatDir, `${agentId}.json`)
    const old = new Date(Date.now() - 120_000).toISOString()
    writeFileSync(heartbeatPath, JSON.stringify({ timestamp: old }))

    // No rollout and no tmux session — should fall through to null.
    const rt = new CodexRuntimeSync()
    const hb = rt.getHeartbeat(agentId)
    // tier 2 and tier 3 also absent — expect null
    expect(hb).toBeNull()
  })

  it('tier 2: returns medium-confidence heartbeat from rollout mtime when heartbeat.json absent', () => {
    const agentId = 'agent-hb-02'
    const threadId = 'hbthread123'
    // Rollout must be in the per-agent CODEX_HOME, not the global ~/.codex
    const agentDir = join(ctx.agentsHome, agentId)
    const perAgentCodexHome = join(agentDir, 'codex-home')
    const dayDir = join(perAgentCodexHome, 'sessions', '2025', '06', '01')
    mkdirSync(dayDir, { recursive: true })
    const rolloutPath = join(dayDir, `rollout-uuid-${threadId}.jsonl`)
    writeFileSync(rolloutPath, '{"type":"token_count"}\n')

    mkdirSync(agentDir, { recursive: true })
    writeThreadId(agentId, threadId)

    const rt = new CodexRuntimeSync()
    const hb = rt.getHeartbeat(agentId)
    expect(hb).not.toBeNull()
    expect(hb!.source).toBe('jsonl')
    expect(hb!.confidence).toBe('medium')
  })

  it('tier 3: returns null when all tiers are absent', () => {
    const rt = new CodexRuntimeSync()
    expect(rt.getHeartbeat('agent-hb-missing')).toBeNull()
  })
})

describe('CodexRuntimeSync.getTokenUsage + getSessionCost', () => {
  let ctx: ReturnType<typeof withFakeCodexHome>

  beforeEach(() => { ctx = withFakeCodexHome() })
  afterEach(() => ctx.cleanup())

  function seedFixtureRollout(agentId: string, threadId: string): string {
    // Rollout must be in the per-agent CODEX_HOME (not global ~/.codex) to
    // match the fixed getSessionPath which uses join(agentDirFor(id), 'codex-home').
    const agentDir = join(ctx.agentsHome, agentId)
    const perAgentCodexHome = join(agentDir, 'codex-home')
    const dayDir = join(perAgentCodexHome, 'sessions', '2025', '06', '01')
    mkdirSync(dayDir, { recursive: true })
    const rolloutPath = join(dayDir, `rollout-uuid-${threadId}.jsonl`)
    // Minimal token_count fixture matching the codex rollout format.
    const lines = [
      JSON.stringify({ type: 'task_started', model: 'codex-4o', task: 'test task', thread_id: threadId, timestamp: '2025-06-01T10:00:00Z' }),
      JSON.stringify({ type: 'token_count', info: { total_token_usage: { input: 100, cached_input: 20, output: 30, reasoning_output: 0, total: 130 }, last_token_usage: { input: 100, cached_input: 20, output: 30, total: 130 } }, timestamp: '2025-06-01T10:00:05Z' }),
    ]
    writeFileSync(rolloutPath, lines.join('\n') + '\n')
    mkdirSync(agentDir, { recursive: true })
    writeThreadId(agentId, threadId)
    return rolloutPath
  }

  it('getTokenUsage returns null when no thread-id exists', () => {
    const rt = new CodexRuntimeSync()
    expect(rt.getTokenUsage('agent-tu-missing')).toBeNull()
  })

  it('getTokenUsage reads input/output token counts from the rollout fixture', () => {
    seedFixtureRollout('agent-tu-01', 'tuthread001')
    const rt = new CodexRuntimeSync()
    const usage = rt.getTokenUsage('agent-tu-01')
    expect(usage).not.toBeNull()
    expect(usage!.inputTokens).toBeGreaterThan(0)
    expect(usage!.outputTokens).toBeGreaterThan(0)
  })

  it('getSessionCost returns null when no thread-id exists', () => {
    const rt = new CodexRuntimeSync()
    expect(rt.getSessionCost('agent-cost-missing')).toBeNull()
  })

  it('getSessionCost returns a CostBreakdown with totalCost >= 0', () => {
    seedFixtureRollout('agent-cost-01', 'costthread001')
    const rt = new CodexRuntimeSync()
    const cost = rt.getSessionCost('agent-cost-01')
    expect(cost).not.toBeNull()
    expect(typeof cost!.totalCost).toBe('number')
    expect(cost!.totalCost).toBeGreaterThanOrEqual(0)
    expect(cost!.currency).toBe('USD')
  })
})

describe('getRuntimeForAgent — codex dispatch', () => {
  it('returns the Codex runtime for an agent whose state has harness=codex', () => {
    const registry = new RuntimeRegistry()
    registry.register(createClaudeCodeRuntimeSync())
    registry.register(createPiRuntimeSync())
    registry.register(createCodexRuntimeSync())
    setGlobalRegistry(registry)

    // The registry dispatches by harness from agent state. We verify the
    // codex runtime is reachable via getRuntime — the getRuntimeForAgent path
    // requires a real agent state file which is integration-tested elsewhere.
    const rt = getRuntime('codex')
    expect(rt).toBeDefined()
    expect(rt?.name).toBe('codex')
  })
})
