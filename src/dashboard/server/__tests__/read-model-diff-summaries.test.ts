import { describe, it, expect, vi } from 'vitest'
import { Effect } from 'effect'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function withIsolatedReadModel<T>(run: (svc: {
  getSnapshot: unknown
  getTurnDiffSummaries: (agentId: string) => unknown
  applyEvent: (event: unknown) => void
}) => Promise<T>): Promise<T> {
  const tmpHome = mkdtempSync(join(tmpdir(), 'pan-1024-read-model-'))
  const originalHome = process.env['PANOPTICON_HOME']
  process.env['PANOPTICON_HOME'] = tmpHome

  try {
    vi.resetModules()
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
})
