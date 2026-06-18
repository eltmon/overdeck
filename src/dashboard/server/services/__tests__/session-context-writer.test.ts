import type { DashboardSnapshot, FeatureRegistryEntry } from '@overdeck/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startSessionContextWriter } from '../session-context-writer.js'

function makeSnapshot(runningAgents: number): DashboardSnapshot {
  return {
    sequence: runningAgents,
    agents: Array.from({ length: runningAgents }, (_, index) => ({
      id: `agent-${index}`,
      issueId: `PAN-${index}`,
      status: 'running',
      hasLiveTmuxSession: true,
    })),
    specialists: [],
    reviewStatuses: [],
    agentRuntimeById: {},
    channelPermissionRequests: [],
    issues: [],
    memory: {
      observationsByIssueId: {},
      statusByIssueId: {
        'PAN-1204': {
          phase: 'working',
          headline: `running ${runningAgents}`,
        },
      },
      rollupsByIssueId: {},
      resetMarkersByScopeId: {},
      healthByIssueId: {},
    },
    timestamp: new Date('2026-05-25T12:00:00.000Z').toISOString(),
  } as unknown as DashboardSnapshot
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('session context writer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes session-context.md on startup', async () => {
    const writeFile = vi.fn(async () => undefined)
    const mkdir = vi.fn(async () => undefined)
    const unsubscribe = vi.fn()
    const registryEntry: FeatureRegistryEntry = {
      featureId: 'feature-1',
      featureName: 'live-briefing',
      description: null,
      owningWorkspaceId: 'feature-pan-1204',
      owningIssueId: 'PAN-1204',
      owningAgentId: 'agent-pan-1204',
      status: 'active',
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z',
      tags: ['briefing'],
    }

    const writer = startSessionContextWriter({
      path: '/tmp/pan-home/session-context.md',
      readSnapshot: async () => makeSnapshot(1),
      listRegistryEntries: async () => [registryEntry],
      mkdir: mkdir as unknown as typeof import('node:fs/promises').mkdir,
      writeFile: writeFile as unknown as typeof import('node:fs/promises').writeFile,
      subscribe: () => unsubscribe,
      now: () => new Date('2026-05-25T12:00:00.000Z'),
    })

    await flushPromises()

    expect(mkdir).toHaveBeenCalledWith('/tmp/pan-home', { recursive: true })
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile.mock.calls[0]?.[0]).toBe('/tmp/pan-home/session-context.md')
    expect(writeFile.mock.calls[0]?.[1]).toContain('# Working Inside Panopticon')
    expect(writeFile.mock.calls[0]?.[1]).toContain('Running agents: 1')
    expect(writeFile.mock.calls[0]?.[1]).toContain('live-briefing')

    writer.stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('debounces rapid read-model changes into one latest-state write', async () => {
    let listener: (() => void) | null = null
    let snapshot = makeSnapshot(1)
    const writeFile = vi.fn(async () => undefined)

    const writer = startSessionContextWriter({
      path: '/tmp/pan-home/session-context.md',
      readSnapshot: async () => snapshot,
      listRegistryEntries: async () => [],
      mkdir: vi.fn(async () => undefined) as unknown as typeof import('node:fs/promises').mkdir,
      writeFile: writeFile as unknown as typeof import('node:fs/promises').writeFile,
      subscribe: (next) => {
        listener = next
        return vi.fn()
      },
      now: () => new Date('2026-05-25T12:00:00.000Z'),
    })

    await flushPromises()
    writeFile.mockClear()

    snapshot = makeSnapshot(2)
    listener?.()
    snapshot = makeSnapshot(3)
    listener?.()
    snapshot = makeSnapshot(4)
    listener?.()

    await vi.advanceTimersByTimeAsync(499)
    expect(writeFile).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()

    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile.mock.calls[0]?.[1]).toContain('Running agents: 4')
    expect(writeFile.mock.calls[0]?.[1]).toContain('running 4')

    writer.stop()
  })

  it('logs write failures without throwing', async () => {
    const logger = { error: vi.fn(), warn: vi.fn() }
    const writer = startSessionContextWriter({
      path: '/tmp/pan-home/session-context.md',
      readSnapshot: async () => makeSnapshot(1),
      listRegistryEntries: async () => [],
      mkdir: vi.fn(async () => undefined) as unknown as typeof import('node:fs/promises').mkdir,
      writeFile: vi.fn(async () => { throw new Error('disk full') }) as unknown as typeof import('node:fs/promises').writeFile,
      subscribe: () => vi.fn(),
      logger,
      now: () => new Date('2026-05-25T12:00:00.000Z'),
    })

    await flushPromises()

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(String(logger.error.mock.calls[0]?.[0])).toContain('Failed to write live briefing')

    writer.stop()
  })
})
