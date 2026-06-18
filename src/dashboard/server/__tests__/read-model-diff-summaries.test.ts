import { describe, it, expect, vi, afterEach } from 'vitest'
import { Effect } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shouldSkipCheckpointReconciliation } from '../read-model.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('../../../lib/agents.js')
  vi.doUnmock('../../../lib/agent-enrichment.js')
  vi.doUnmock('../../../lib/checkpoint/checkpoint-manager.js')
})

async function withIsolatedReadModel<T>(
  run: (svc: {
    getSnapshot: unknown
    getTurnDiffSummaries: (agentId: string) => unknown
    applyEvent: (event: unknown) => void
  }) => Promise<T>,
  options?: { setupMocks?: () => void },
): Promise<T> {
  const tmpHome = mkdtempSync(join(tmpdir(), 'pan-1024-read-model-'))
  const originalHome = process.env['PANOPTICON_HOME']
  process.env['PANOPTICON_HOME'] = tmpHome

  try {
    vi.resetModules()
    options?.setupMocks?.()
    const { ReadModelService, ReadModelServiceLive } = await import('../read-model.js')
    const program = Effect.gen(function* () {
      const svc = yield* ReadModelService
      return yield* Effect.promise(() => run(svc as never))
    })
    return await Effect.runPromise(Effect.provide(program, ReadModelServiceLive))
  } finally {
    process.env['PANOPTICON_HOME'] = originalHome
    rmSync(tmpHome, { recursive: true, force: true })
  }
}

describe('ReadModel diff summaries', () => {
  it('keeps turn diff summaries off the dashboard snapshot while serving them separately', async () => {
    const timestamp = '2026-05-08T05:00:00.000Z'

    const result = await withIsolatedReadModel(async (readModel) => {
      readModel.applyEvent({
        type: 'agent.started',
        sequence: 1,
        timestamp,
        payload: {
          agentId: 'agent-1024',
          agent: {
            id: 'agent-1024',
            issueId: 'PAN-1024',
            workspace: '/tmp/pan-1024',
            status: 'running',
          },
        },
      })

      readModel.applyEvent({
        type: 'agent.turn_diff_completed',
        sequence: 2,
        timestamp,
        payload: {
          agentId: 'agent-1024',
          turnId: 'turn-1',
          completedAt: timestamp,
          files: [{ path: 'src/example.ts', additions: 3, deletions: 1 }],
          checkpointRef: 'refs/pan/turn/turn-1',
        },
      })

      const snapshot = await Effect.runPromise(readModel.getSnapshot as Effect.Effect<any>)
      const summaries = await Effect.runPromise(readModel.getTurnDiffSummaries('agent-1024') as Effect.Effect<any>)
      return { snapshot, summaries }
    })

    expect(result.snapshot).not.toHaveProperty('turnDiffSummariesByAgentId')
    expect(result.summaries).toEqual([
      {
        turnId: 'turn-1',
        completedAt: timestamp,
        files: [{ path: 'src/example.ts', additions: 3, deletions: 1 }],
        checkpointRef: 'refs/pan/turn/turn-1',
      },
    ])
  }, 30000)

  it('keeps a 100+ agent serialized dashboard snapshot under 5 MB even when retained diff summaries exceed that size in memory', async () => {
    const encoder = new TextEncoder()
    const baseTimestamp = Date.parse('2026-05-08T05:00:00.000Z')
    const agentCount = 101
    const turnsPerAgent = 205
    const filesPerTurn = 3

    const result = await withIsolatedReadModel(async (readModel) => {
      let sequence = 0
      const agentIds: string[] = []

      for (let agentIndex = 0; agentIndex < agentCount; agentIndex++) {
        const agentId = `agent-${agentIndex + 1}`
        agentIds.push(agentId)

        sequence += 1
        const startedAt = new Date(baseTimestamp + sequence * 1000).toISOString()
        readModel.applyEvent({
          type: 'agent.started',
          sequence,
          timestamp: startedAt,
          payload: {
            agentId,
            agent: {
              id: agentId,
              issueId: `PAN-${2000 + agentIndex}`,
              workspace: `/tmp/pan-${agentIndex + 1}`,
              status: 'running',
            },
          },
        })

        for (let turn = 1; turn <= turnsPerAgent; turn++) {
          sequence += 1
          const timestamp = new Date(baseTimestamp + sequence * 1000).toISOString()
          readModel.applyEvent({
            type: 'agent.turn_diff_completed',
            sequence,
            timestamp,
            payload: {
              agentId,
              turnId: `turn-${turn}`,
              completedAt: timestamp,
              checkpointRef: `refs/pan/turn/${agentId}/turn-${turn}`,
              files: Array.from({ length: filesPerTurn }, (_, fileIndex) => ({
                path: `src/features/${agentId}/turn-${turn}/deeply/nested/component-${fileIndex + 1}-${'x'.repeat(64)}.ts`,
                additions: fileIndex + 1,
                deletions: fileIndex % 2,
              })),
            },
          })
        }
      }

      let retainedSummaryBytes = 0
      for (const agentId of agentIds) {
        const summaries = await Effect.runPromise(readModel.getTurnDiffSummaries(agentId) as Effect.Effect<any>)
        retainedSummaryBytes += encoder.encode(JSON.stringify(summaries)).length
      }

      const snapshot = await Effect.runPromise(readModel.getSnapshot as Effect.Effect<any>)
      const serializedSnapshotBytes = encoder.encode(JSON.stringify(snapshot)).length
      return { snapshot, retainedSummaryBytes, serializedSnapshotBytes }
    })

    expect(result.snapshot).not.toHaveProperty('turnDiffSummariesByAgentId')
    expect(result.retainedSummaryBytes).toBeGreaterThan(5 * 1024 * 1024)
    expect(result.serializedSnapshotBytes).toBeLessThan(5 * 1024 * 1024)
  }, 30000)

  it('returns defensive copies of in-memory turn diff summaries', async () => {
    const timestamp = '2026-05-08T05:00:00.000Z'

    const result = await withIsolatedReadModel(async (readModel) => {
      readModel.applyEvent({
        type: 'agent.started',
        sequence: 1,
        timestamp,
        payload: {
          agentId: 'agent-1024',
          agent: {
            id: 'agent-1024',
            issueId: 'PAN-1024',
            workspace: '/tmp/pan-1024',
            status: 'running',
          },
        },
      })

      readModel.applyEvent({
        type: 'agent.turn_diff_completed',
        sequence: 2,
        timestamp,
        payload: {
          agentId: 'agent-1024',
          turnId: 'turn-1',
          completedAt: timestamp,
          files: [{ path: 'src/example.ts', additions: 3, deletions: 1 }],
        },
      })

      const first = await Effect.runPromise(readModel.getTurnDiffSummaries('agent-1024') as Effect.Effect<any>)
      first[0].files[0].path = 'mutated.ts'
      const second = await Effect.runPromise(readModel.getTurnDiffSummaries('agent-1024') as Effect.Effect<any>)
      return second
    })

    expect(result[0].files[0].path).toBe('src/example.ts')
  }, 30000)

  it('retains only the latest 200 in-memory turn diff summaries per agent', async () => {
    const baseTimestamp = Date.parse('2026-05-08T05:00:00.000Z')

    const result = await withIsolatedReadModel(async (readModel) => {
      readModel.applyEvent({
        type: 'agent.started',
        sequence: 1,
        timestamp: new Date(baseTimestamp).toISOString(),
        payload: {
          agentId: 'agent-1024',
          agent: {
            id: 'agent-1024',
            issueId: 'PAN-1024',
            workspace: '/tmp/pan-1024',
            status: 'running',
          },
        },
      })

      for (let turn = 1; turn <= 205; turn++) {
        const timestamp = new Date(baseTimestamp + turn * 1000).toISOString()
        readModel.applyEvent({
          type: 'agent.turn_diff_completed',
          sequence: turn + 1,
          timestamp,
          payload: {
            agentId: 'agent-1024',
            turnId: `turn-${turn}`,
            completedAt: timestamp,
            files: [{ path: `src/example-${turn}.ts`, additions: turn, deletions: 0 }],
          },
        })
      }

      return Effect.runPromise(readModel.getTurnDiffSummaries('agent-1024') as Effect.Effect<any>)
    })

    expect(result).toHaveLength(200)
    expect(result[0].turnId).toBe('turn-6')
    expect(result.at(-1)?.turnId).toBe('turn-205')
  }, 30000)
})

describe('ReadModel checkpoint reconciliation', () => {
  it('caps checkpoint reconciliation before diffing old history while preserving absolute turn counts', async () => {
    const checkpoints = Array.from({ length: 205 }, (_, index) => `turn-${index + 1}`)
    const listCheckpoints = vi.fn(() => Effect.succeed(checkpoints))
    // Real signatures (PAN-checkpoint-namespacing): both helpers take agentId as the
    // second argument so refs can be scoped per-agent. Mocks must mirror that or the
    // production read-model loop never produces summaries and the test hangs.
    const diffCheckpointFiles = vi.fn((_workspace: string, _agentId: string, prevTurnId: string, turnId: string) => Effect.succeed([
      { path: `${prevTurnId}-to-${turnId}.ts`, additions: 1, deletions: 0 },
    ]))
    const getCheckpointTimestamp = vi.fn((_workspace: string, _agentId: string, turnId: string) => {
      const turnNumber = Number.parseInt(turnId.replace('turn-', ''), 10)
      return Effect.succeed(new Date(Date.parse('2026-05-08T05:00:00.000Z') + turnNumber * 1000).toISOString())
    })
    const deleteLegacyCheckpointRefs = vi.fn(() => Effect.succeed(0))

    const summaries = await withIsolatedReadModel(
      async (readModel) => {
        await vi.waitFor(async () => {
          const reconciled = await Effect.runPromise(readModel.getTurnDiffSummaries('agent-reconcile') as Effect.Effect<any>)
          expect(reconciled).toHaveLength(200)
        }, { timeout: 30000 })

        return Effect.runPromise(readModel.getTurnDiffSummaries('agent-reconcile') as Effect.Effect<any>)
      },
      {
        setupMocks: () => {
          vi.doMock('../../../lib/checkpoint/checkpoint-manager.js', () => ({
            listCheckpoints,
            diffCheckpointFiles,
            getCheckpointTimestamp,
            deleteLegacyCheckpointRefs,
          }))
          vi.doMock('../../../lib/agent-enrichment.js', () => ({
            computeAgentEnrichment: vi.fn(() => Effect.succeed(undefined)),
          }))
          vi.doMock('../../../lib/agents.js', () => ({
            listRunningAgents: vi.fn(() => Effect.succeed([
              {
                id: 'agent-reconcile',
                issueId: 'PAN-1024',
                workspace: '/tmp/pan-1024',
                runtime: 'claude-code',
                model: 'sonnet',
                status: 'running',
                tmuxActive: true,
                startedAt: '2026-05-08T05:00:00.000Z',
                lastActivity: '2026-05-08T05:00:00.000Z',
                branch: 'feature/pan-1024',
                costSoFar: 0,
                sessionId: 'session-1',
                harness: 'claude-code',
                role: 'work',
              },
            ])),
            listRunningAgentsProgram: vi.fn(() => Effect.succeed([
              {
                id: 'agent-reconcile',
                issueId: 'PAN-1024',
                workspace: '/tmp/pan-1024',
                runtime: 'claude-code',
                model: 'sonnet',
                status: 'running',
                tmuxActive: true,
                startedAt: '2026-05-08T05:00:00.000Z',
                lastActivity: '2026-05-08T05:00:00.000Z',
                branch: 'feature/pan-1024',
                costSoFar: 0,
                sessionId: 'session-1',
                harness: 'claude-code',
                role: 'work',
              },
            ])),
            // PAN-1048 P2: now async.
            warnOnBareNumericIssueIds: vi.fn(async () => {}),
          }))
        },
      },
    )

    expect(diffCheckpointFiles).toHaveBeenCalledTimes(200)
    expect(diffCheckpointFiles).toHaveBeenNthCalledWith(1, '/tmp/pan-1024', 'agent-reconcile', 'turn-5', 'turn-6')
    expect(diffCheckpointFiles).toHaveBeenLastCalledWith('/tmp/pan-1024', 'agent-reconcile', 'turn-204', 'turn-205')
    expect(summaries[0].turnId).toBe('turn-6')
    expect(summaries[0].checkpointTurnCount).toBe(6)
    expect(summaries.at(-1)?.turnId).toBe('turn-205')
    expect(summaries.at(-1)?.checkpointTurnCount).toBe(205)
  }, 30000)
})

describe('shouldSkipCheckpointReconciliation', () => {
  it('skips agents without a workspace or with terminal statuses', () => {
    expect(shouldSkipCheckpointReconciliation({ status: 'running', workspace: undefined })).toBe(true)
    expect(shouldSkipCheckpointReconciliation({ status: 'stopped', workspace: '/tmp/pan-1024' })).toBe(true)
    expect(shouldSkipCheckpointReconciliation({ status: 'running', workspace: '/tmp/pan-1024' })).toBe(false)
  })
})
