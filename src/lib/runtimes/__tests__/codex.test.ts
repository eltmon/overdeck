import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'

import { CodexRuntimeSync, findRolloutPath, writeThreadId, initCodexHome, extractThreadIdFromRollout, findLatestRollout, toCodexSandboxValue } from '../codex.js'
import * as tmuxForCodexTest from '../../tmux.js'
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

  it('pre-seeds folder trust and autonomy so the TUI skips its first-run wizard', () => {
    const codexDir = join(ctx.codexHome, 'agent-init-trust')
    initCodexHome(codexDir, {
      trustedDir: '/home/eltmon/Projects/panopticon-cli',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    })
    const { readFileSync: readNode } = require('node:fs')
    const config = readNode(join(codexDir, 'config.toml'), 'utf8')
    expect(config).toContain('approval_policy = "never"')
    expect(config).toContain('sandbox_mode = "danger-full-access"')
    // The folder-trust entry is what the onboarding wizard persists; pre-writing
    // it suppresses the wizard on a fresh per-agent CODEX_HOME.
    expect(config).toContain('[projects."/home/eltmon/Projects/panopticon-cli"]')
    expect(config).toContain('trust_level = "trusted"')
  })

  it('seeds auth.json from the global ~/.codex so the TUI skips sign-in onboarding', () => {
    // The fake HOME is the test base; withFakeCodexHome() points CODEX_HOME at
    // <base>/.codex, which is also where homedir()/.codex resolves. Drop a fake
    // global credential there.
    const { writeFileSync: writeNode, readFileSync: readNode, existsSync: existsNode } = require('node:fs')
    writeNode(join(ctx.codexHome, 'auth.json'), '{"tokens":{"access_token":"global"}}')

    const codexDir = join(ctx.agentsHome, 'agent-init-auth')
    initCodexHome(codexDir)

    const seeded = join(codexDir, 'auth.json')
    expect(existsNode(seeded)).toBe(true)
    expect(JSON.parse(readNode(seeded, 'utf8')).tokens.access_token).toBe('global')
  })

  it('does not clobber an existing per-agent auth.json (refreshed token survives resume)', () => {
    const { writeFileSync: writeNode, readFileSync: readNode, mkdirSync: mkdirNode } = require('node:fs')
    writeNode(join(ctx.codexHome, 'auth.json'), '{"tokens":{"access_token":"global-stale"}}')

    const codexDir = join(ctx.agentsHome, 'agent-init-auth-resume')
    mkdirNode(codexDir, { recursive: true })
    writeNode(join(codexDir, 'auth.json'), '{"tokens":{"access_token":"home-fresh"}}')

    initCodexHome(codexDir) // resume — must not overwrite the home's own token

    expect(JSON.parse(readNode(join(codexDir, 'auth.json'), 'utf8')).tokens.access_token).toBe('home-fresh')
  })

  it('always rewrites config.toml so permission-mode changes apply on resume', () => {
    const codexDir = join(ctx.codexHome, 'agent-init-03')
    initCodexHome(codexDir)
    const { writeFileSync: writeNode, readFileSync: readNode } = require('node:fs')
    writeNode(join(codexDir, 'config.toml'), 'custom-content')
    initCodexHome(codexDir, { approvalPolicy: 'explicit' }) // second call — should overwrite with new policy
    const config = readNode(join(codexDir, 'config.toml'), 'utf8')
    expect(config).not.toBe('custom-content')
    expect(config).toContain('approval_policy = "explicit"')
  })
})

describe('extractThreadIdFromRollout', () => {
  it('extracts the full trailing session UUID (not just the last segment)', () => {
    // Real codex format: rollout-<timestamp>-<uuid>.jsonl. The id is the whole
    // UUID; returning only the last hyphen group breaks resume + lookups.
    expect(
      extractThreadIdFromRollout(
        '/path/sessions/2026/06/09/rollout-2026-06-09T01-47-53-019eaaec-4dfa-7ab1-90ba-9104d16534d1.jsonl',
      ),
    ).toBe('019eaaec-4dfa-7ab1-90ba-9104d16534d1')
  })

  it('returns null when there is no trailing UUID', () => {
    expect(extractThreadIdFromRollout('/path/notarollout.jsonl')).toBeNull()
    expect(extractThreadIdFromRollout('/path/rollout-uuid-abc123.jsonl')).toBeNull()
  })
})

describe('findLatestRollout', () => {
  let ctx: ReturnType<typeof withFakeCodexHome>
  beforeEach(() => { ctx = withFakeCodexHome() })
  afterEach(() => ctx.cleanup())

  it('returns the most-recently-modified rollout across nested day dirs', () => {
    const home = join(ctx.agentsHome, 'conv-x', 'codex-home')
    const older = join(home, 'sessions', '2026', '06', '08')
    const newer = join(home, 'sessions', '2026', '06', '09')
    mkdirSync(older, { recursive: true })
    mkdirSync(newer, { recursive: true })
    const oldPath = join(older, 'rollout-2026-06-08T10-00-00-019eaaaa-1111-2222-3333-444444444444.jsonl')
    const newPath = join(newer, 'rollout-2026-06-09T10-00-00-019eaabb-5555-6666-7777-888888888888.jsonl')
    writeFileSync(oldPath, '{}')
    writeFileSync(newPath, '{}')
    // Force the newer file to have a later mtime regardless of write order.
    const { utimesSync } = require('node:fs')
    utimesSync(oldPath, new Date(1000), new Date(1000))
    utimesSync(newPath, new Date(2000), new Date(2000))

    expect(findLatestRollout(home)).toBe(newPath)
  })

  it('returns null when there are no rollouts', () => {
    const home = join(ctx.agentsHome, 'conv-empty', 'codex-home')
    mkdirSync(join(home, 'sessions'), { recursive: true })
    expect(findLatestRollout(home)).toBeNull()
  })

  it('skips newer subagent (guardian) rollouts in favor of the user thread (PAN-1805)', () => {
    const home = join(ctx.agentsHome, 'agent-x', 'codex-home')
    const day = join(home, 'sessions', '2026', '06', '12')
    mkdirSync(day, { recursive: true })
    const userPath = join(day, 'rollout-2026-06-12T11-19-17-019ebc6a-8368-7263-8dae-fbd31fc6025c.jsonl')
    const guardianPath = join(day, 'rollout-2026-06-12T11-19-57-019ebc6b-1fcb-7711-a3b2-52a7c5f00ea1.jsonl')
    writeFileSync(userPath, JSON.stringify({ type: 'session_meta', payload: { thread_source: 'user' } }) + '\n')
    writeFileSync(guardianPath, JSON.stringify({ type: 'session_meta', payload: { thread_source: 'subagent', source: { subagent: { other: 'guardian' } } } }) + '\n')
    const { utimesSync } = require('node:fs')
    // The guardian thread interleaves writes with the main thread and is the
    // most recently modified here — it must still lose to the user thread.
    utimesSync(userPath, new Date(1000), new Date(1000))
    utimesSync(guardianPath, new Date(2000), new Date(2000))

    expect(findLatestRollout(home)).toBe(userPath)
  })

  it('falls back to a subagent rollout when no user thread exists', () => {
    const home = join(ctx.agentsHome, 'agent-y', 'codex-home')
    const day = join(home, 'sessions', '2026', '06', '12')
    mkdirSync(day, { recursive: true })
    const guardianPath = join(day, 'rollout-2026-06-12T11-19-57-019ebc6b-1fcb-7711-a3b2-52a7c5f00ea2.jsonl')
    writeFileSync(guardianPath, JSON.stringify({ type: 'session_meta', payload: { thread_source: 'subagent' } }) + '\n')

    expect(findLatestRollout(home)).toBe(guardianPath)
  })
})

describe('CodexRuntimeSync.killAgent — JSONL-is-sacred', () => {
  let ctx: ReturnType<typeof withFakeCodexHome>

  beforeEach(() => {
    ctx = withFakeCodexHome()
    vi.useFakeTimers()
    vi.spyOn(tmuxForCodexTest, 'sessionExists').mockReturnValue(Effect.succeed(false))
    vi.spyOn(tmuxForCodexTest, 'killSession').mockReturnValue(Effect.succeed(undefined))
  })
  afterEach(() => {
    ctx.cleanup()
    vi.useRealTimers()
  })

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

describe('toCodexSandboxValue (PAN-1799)', () => {
  it("translates Panopticon's abstract 'workspace' to workspace-write", () => {
    expect(toCodexSandboxValue('workspace')).toBe('workspace-write');
  });
  it('passes through valid codex values unchanged', () => {
    expect(toCodexSandboxValue('read-only')).toBe('read-only');
    expect(toCodexSandboxValue('workspace-write')).toBe('workspace-write');
    expect(toCodexSandboxValue('danger-full-access')).toBe('danger-full-access');
  });
  it('defaults undefined and unknown values to workspace-write', () => {
    expect(toCodexSandboxValue(undefined)).toBe('workspace-write');
    expect(toCodexSandboxValue('bogus')).toBe('workspace-write');
  });
});
