import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// Re-route paths.ts to a fixed per-suite path so getAgentState reads our
// fixture state.json files instead of the real ~/.overdeck. paths.ts
// freezes the constants at import time, and vi.mock is hoisted above all
// imports — so we use a literal path here and clean it up in afterAll.
const TEST_OVERDECK_HOME = '/tmp/pan-test-runtime-dispatch'
const TEST_AGENTS_DIR = '/tmp/pan-test-runtime-dispatch/agents'

vi.mock('../../paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../paths.js')>()),
  OVERDECK_HOME: '/tmp/pan-test-runtime-dispatch',
  AGENTS_DIR: '/tmp/pan-test-runtime-dispatch/agents',
  getOverdeckHome: () => '/tmp/pan-test-runtime-dispatch',
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

import { RuntimeRegistry, setGlobalRegistry, getGlobalRegistry, getHarnessBehavior } from '../index.js'
import type { AgentRuntimeSync, HarnessBehavior } from '../types.js'

function stubRuntime(name: 'claude-code' | 'ohmypi' | 'codex'): AgentRuntimeSync {
  const behavior = getHarnessBehavior(name)
  return {
    name,
    getHarnessBehavior: () => behavior,
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
    fresh.register(stubRuntime('ohmypi'))
    fresh.register(stubRuntime('codex'))
    setGlobalRegistry(fresh)
  })
  afterEach(() => {
    if (savedRegistry) setGlobalRegistry(savedRegistry)
  })

  it('normalizes legacy pi harness to ohmypi runtime (PAN-1989)', () => {
    writeAgentState('agent-pi-1', { harness: 'pi' })
    expect(getGlobalRegistry().getRuntimeForAgent('agent-pi-1')?.name).toBe('ohmypi')
  })

  it('returns the ohmypi runtime when state.harness === "ohmypi" (PAN-1989)', () => {
    writeAgentState('agent-ohmypi-1', { harness: 'ohmypi' })
    expect(getGlobalRegistry().getRuntimeForAgent('agent-ohmypi-1')?.name).toBe('ohmypi')
  })

  it('returns the codex runtime when state.harness === "codex" (PAN-1574)', () => {
    writeAgentState('agent-codex-1', { harness: 'codex' })
    expect(getGlobalRegistry().getRuntimeForAgent('agent-codex-1')?.name).toBe('codex')
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

function pickBehaviorFields(behavior: HarnessBehavior): Record<string, unknown> {
  return {
    executableName: behavior.executableName,
    processNames: behavior.processNames,
    launchCommandKind: behavior.launchCommandKind,
    deliveryKind: behavior.deliveryKind,
    readinessKind: behavior.readinessKind,
    transcriptKind: behavior.transcriptKind,
    sessionIdSource: behavior.sessionIdSource,
    contextLayerKind: behavior.contextLayerKind,
    feedKind: behavior.feedKind,
    supportsPtySupervisor: behavior.supportsPtySupervisor,
    supportsChannelsBridge: behavior.supportsChannelsBridge,
    supportsConversationStreaming: behavior.supportsConversationStreaming,
    supportsPatchProjection: behavior.supportsPatchProjection,
    usesRpcFifo: behavior.usesRpcFifo,
    usesCodexHome: behavior.usesCodexHome,
    injectsPromptTimeMemory: behavior.injectsPromptTimeMemory,
    workAgentMode: behavior.workAgentMode,
    readyTimeoutSeconds: behavior.readyTimeoutSeconds,
  }
}

describe('getHarnessBehavior', () => {
  it('preserves Claude Code behavior switches', () => {
    expect(pickBehaviorFields(getHarnessBehavior('claude-code'))).toEqual({
      executableName: 'claude',
      processNames: ['claude'],
      launchCommandKind: 'claude-code',
      deliveryKind: 'pty-supervisor',
      readinessKind: 'claude-session-signal',
      transcriptKind: 'claude-jsonl',
      sessionIdSource: 'launcher-session-id',
      contextLayerKind: 'claude',
      feedKind: 'claude_code',
      supportsPtySupervisor: true,
      supportsChannelsBridge: true,
      supportsConversationStreaming: false,
      supportsPatchProjection: true,
      usesRpcFifo: false,
      usesCodexHome: false,
      injectsPromptTimeMemory: false,
      workAgentMode: 'claude-code',
      readyTimeoutSeconds: 30,
    })
  })

  it('normalizes legacy pi to ohmypi behavior switches', () => {
    expect(getHarnessBehavior('pi')).toBe(getHarnessBehavior('ohmypi'))
    expect(pickBehaviorFields(getHarnessBehavior('ohmypi'))).toMatchObject({
      executableName: 'omp',
      processNames: ['omp'],
      deliveryKind: 'rpc-fifo',
      readinessKind: 'ohmypi-ready-file',
      transcriptKind: 'ohmypi-jsonl',
      sessionIdSource: 'transcript-jsonl',
      contextLayerKind: 'pi',
      feedKind: 'pi',
      supportsPtySupervisor: false,
      supportsChannelsBridge: false,
      supportsConversationStreaming: true,
      usesRpcFifo: true,
      readyTimeoutSeconds: 120,
    })
  })

  it('preserves Codex behavior switches', () => {
    expect(pickBehaviorFields(getHarnessBehavior('codex'))).toMatchObject({
      executableName: 'codex',
      processNames: ['codex'],
      launchCommandKind: 'codex-work-tui',
      deliveryKind: 'codex-exec-resume',
      readinessKind: 'codex-tui-prompt',
      transcriptKind: 'codex-rollout-jsonl',
      sessionIdSource: 'codex-thread-id',
      contextLayerKind: 'codex',
      feedKind: 'codex',
      supportsPtySupervisor: true,
      supportsChannelsBridge: false,
      supportsConversationStreaming: true,
      supportsPatchProjection: true,
      usesCodexHome: true,
      workAgentMode: 'codex-work-tui',
      readyTimeoutSeconds: 30,
    })
  })
})

afterEach(() => {
  // Per-test cleanup so state.json fixtures don't bleed between cases.
  rmSync(TEST_AGENTS_DIR, { recursive: true, force: true })
  void TEST_OVERDECK_HOME // referenced for clarity
})
