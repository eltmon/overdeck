import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// Re-route paths.ts to a fixed per-suite path so getAgentState reads our
// fixture state.json files instead of the real ~/.panopticon. paths.ts
// freezes the constants at import time, and vi.mock is hoisted above all
// imports — so we use a literal path here and clean it up in afterAll.
const TEST_PANOPTICON_HOME = '/tmp/pan-test-runtime-dispatch'
const TEST_AGENTS_DIR = '/tmp/pan-test-runtime-dispatch/agents'

vi.mock('../../paths.js', () => ({
  PANOPTICON_HOME: '/tmp/pan-test-runtime-dispatch',
  AGENTS_DIR: '/tmp/pan-test-runtime-dispatch/agents',
  PROJECT_PRDS_ACTIVE_SUBDIR: 'active',
  PROJECT_PRDS_PLANNED_SUBDIR: 'planned',
  PROJECT_PRDS_COMPLETED_SUBDIR: 'completed',
  CONFIG_DIR: '/tmp/pan-test-runtime-dispatch',
  SKILLS_DIR: '/tmp/pan-test-runtime-dispatch/skills',
  COMMANDS_DIR: '/tmp/pan-test-runtime-dispatch/commands',
  BIN_DIR: '/tmp/pan-test-runtime-dispatch/bin',
  BACKUPS_DIR: '/tmp/pan-test-runtime-dispatch/backups',
  COSTS_DIR: '/tmp/pan-test-runtime-dispatch/costs',
  HEARTBEATS_DIR: '/tmp/pan-test-runtime-dispatch/heartbeats',
  ARCHIVES_DIR: '/tmp/pan-test-runtime-dispatch/archives',
  encodeClaudeProjectDir: (p: string) => p,
}))

import { RuntimeRegistry, setGlobalRegistry, getGlobalRegistry } from '../index.js'
import type { AgentRuntimeSync } from '../types.js'

function stubRuntime(name: 'claude-code' | 'pi'): AgentRuntimeSync {
  return {
    name,
    getSessionPath: () => null,
    getLastActivity: () => null,
    getHeartbeat: () => null,
    getTokenUsage: () => null,
    getSessionCost: () => null,
    sendMessage: () => {},
    killAgent: () => {},
    spawnAgent: () => ({ id: 'x', sessionId: 'y', runtime: name, model: 'z', workspace: '/', startedAt: new Date() }) as never,
    listSessions: () => [],
    isRunning: () => false,
  }
}

function writeAgentState(agentId: string, fields: Record<string, unknown>): void {
  const dir = join(TEST_AGENTS_DIR, agentId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({
      id: agentId,
      issueId: 'PAN-X',
      workspace: '/tmp',
      role: 'work',
      model: 'sonnet',
      status: 'running',
      startedAt: new Date().toISOString(),
      ...fields,
    }),
  )
}

describe('RuntimeRegistry.getRuntimeForAgent dispatches by state.harness (PAN-636)', () => {
  let savedRegistry: ReturnType<typeof getGlobalRegistry> | null = null

  beforeEach(() => {
    savedRegistry = getGlobalRegistry()
    const fresh = new RuntimeRegistry()
    fresh.register(stubRuntime('claude-code'))
    fresh.register(stubRuntime('pi'))
    setGlobalRegistry(fresh)
  })
  afterEach(() => {
    if (savedRegistry) setGlobalRegistry(savedRegistry)
  })

  it('returns the pi runtime when state.harness === "pi" (AC1)', () => {
    writeAgentState('agent-pi-1', { harness: 'pi' })
    expect(getGlobalRegistry().getRuntimeForAgent('agent-pi-1')?.name).toBe('pi')
  })

  it('returns the claude-code runtime when state.harness === "claude-code" (AC1)', () => {
    writeAgentState('agent-cc-1', { harness: 'claude-code' })
    expect(getGlobalRegistry().getRuntimeForAgent('agent-cc-1')?.name).toBe('claude-code')
  })

  it('falls back to claude-code when state.harness is missing (AC2 — back-compat)', () => {
    writeAgentState('agent-legacy-1', {})
    expect(getGlobalRegistry().getRuntimeForAgent('agent-legacy-1')?.name).toBe('claude-code')
  })

  it('falls back to claude-code when state.harness is a legacy/unknown value (AC2)', () => {
    writeAgentState('agent-legacy-2', { harness: 'something-else' })
    expect(getGlobalRegistry().getRuntimeForAgent('agent-legacy-2')?.name).toBe('claude-code')
  })

  it('returns null when no agent state exists', () => {
    expect(getGlobalRegistry().getRuntimeForAgent('agent-unknown')).toBeNull()
  })
})

afterEach(() => {
  // Per-test cleanup so state.json fixtures don't bleed between cases.
  rmSync(TEST_AGENTS_DIR, { recursive: true, force: true })
  void TEST_PANOPTICON_HOME // referenced for clarity
})
