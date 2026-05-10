/**
 * Diff routes — turn diff summaries and unified diff computation
 *
 * GET /api/agents/:agentId/diffs          — all turn diff summaries
 * GET /api/agents/:agentId/diffs/:turnId  — unified diff for a specific turn
 * GET /api/agents/:agentId/diffs/full     — full thread diff (all turns combined)
 */

import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http'
import { jsonResponse } from '../http-helpers.js'
import { ReadModelService } from '../read-model.js'
import { getEventStore } from '../event-store.js'
import {
  captureCheckpoint,
  diffCheckpoints,
  diffCheckpointFiles,
  diffAgainstMain,
  diffAgainstMainFiles,
  listCheckpoints,
} from '../../../lib/checkpoint/checkpoint-manager.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validateOrigin(request: { headers: Record<string, string | string[] | undefined> }): { ok: boolean; error?: string } {
  const origin = request.headers['origin']
  if (origin && typeof origin === 'string' && !origin.includes('localhost') && !origin.includes('127.0.0.1')) {
    return { ok: false, error: 'Invalid origin' }
  }
  return { ok: true }
}

// ─── Route: GET /api/agents/:agentId/diffs ────────────────────────────────────

const getDiffsRoute = HttpRouter.add(
  'GET',
  '/api/agents/:agentId/diffs',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const originCheck = validateOrigin(request)
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 })
    }

    const params = yield* HttpRouter.params
    const agentId = params.agentId
    const readModel = yield* ReadModelService

    return yield* Effect.promise(async () => {
      try {
        const snapshot = await Effect.runPromise(readModel.getSnapshot)
        const agent = (snapshot.agents as any[]).find((a: any) => a.id === agentId)
        if (!agent) {
          return jsonResponse({ error: 'Agent not found' }, { status: 404 })
        }

        const workspace: string | null = agent.workspace ?? null
        const summaries = await Effect.runPromise(readModel.getTurnDiffSummaries(agentId))

        let checkpointTurns: string[] = []
        if (workspace) {
          try {
            checkpointTurns = await listCheckpoints(workspace)
          } catch {
            // Workspace might not exist yet
          }
        }

        return jsonResponse({ agentId, summaries, checkpointTurns })
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[diffs] list diffs failed:', msg)
        return jsonResponse({ error: 'Internal server error' }, { status: 500 })
      }
    })
  }),
)

// ─── Route: GET /api/agents/:agentId/diffs/:turnId ────────────────────────────

const getTurnDiffRoute = HttpRouter.add(
  'GET',
  '/api/agents/:agentId/diffs/:turnId',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const originCheck = validateOrigin(request)
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 })
    }

    const params = yield* HttpRouter.params
    const agentId = params.agentId
    const turnId = params.turnId
    const readModel = yield* ReadModelService

    return yield* Effect.promise(async () => {
      try {
        const snapshot = await Effect.runPromise(readModel.getSnapshot)
        const agent = (snapshot.agents as any[]).find((a: any) => a.id === agentId)
        if (!agent) {
          return jsonResponse({ error: 'Agent not found' }, { status: 404 })
        }

        const workspace: string | null = agent.workspace ?? null
        if (!workspace) {
          return jsonResponse({ error: 'Agent has no workspace' }, { status: 400 })
        }

        const checkpoints = await listCheckpoints(workspace)
        const turnIdx = checkpoints.indexOf(turnId)
        if (turnIdx < 0) {
          return jsonResponse({ error: 'Checkpoint not found' }, { status: 404 })
        }

        const fromTurnId = turnIdx > 0 ? checkpoints[turnIdx - 1] : turnId
        const url = new URL(request.url, 'http://localhost')
        const filePath = url.searchParams.get('file') ?? undefined
        const diff = await diffCheckpoints(workspace, fromTurnId, turnId, filePath)

        return jsonResponse({ agentId, turnId, fromTurnId, diff })
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[diffs] get turn diff failed:', msg)
        return jsonResponse({ error: 'Internal server error' }, { status: 500 })
      }
    })
  }),
)

// ─── Route: GET /api/agents/:agentId/diffs/full ──────────────────────────────

const getFullDiffRoute = HttpRouter.add(
  'GET',
  '/api/agents/:agentId/diffs/full',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const originCheck = validateOrigin(request)
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 })
    }

    const params = yield* HttpRouter.params
    const agentId = params.agentId
    const readModel = yield* ReadModelService

    return yield* Effect.promise(async () => {
      try {
        const snapshot = await Effect.runPromise(readModel.getSnapshot)
        const agent = (snapshot.agents as any[]).find((a: any) => a.id === agentId)
        if (!agent) {
          return jsonResponse({ error: 'Agent not found' }, { status: 404 })
        }

        const workspace: string | null = agent.workspace ?? null
        if (!workspace) {
          return jsonResponse({ error: 'Agent has no workspace' }, { status: 400 })
        }

        const checkpoints = await listCheckpoints(workspace)
        if (checkpoints.length < 2) {
          return jsonResponse({ agentId, diff: '', files: [], turnCount: checkpoints.length })
        }

        const firstTurn = checkpoints[0]
        const lastTurn = checkpoints[checkpoints.length - 1]
        const url = new URL(request.url, 'http://localhost')
        const filePath = url.searchParams.get('file') ?? undefined
        const files = await diffCheckpointFiles(workspace, firstTurn, lastTurn)
        const diff = filePath ? await diffCheckpoints(workspace, firstTurn, lastTurn, filePath) : undefined

        return jsonResponse({
          agentId,
          fromTurnId: firstTurn,
          toTurnId: lastTurn,
          ...(diff !== undefined && { diff }),
          files,
          turnCount: checkpoints.length,
        })
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[diffs] get full diff failed:', msg)
        return jsonResponse({ error: 'Internal server error' }, { status: 500 })
      }
    })
  }),
)

// ─── Route: GET /api/agents/:agentId/diffs/vs-main ──────────────────────────
// Full diff of the workspace against the main branch.

const getVsMainDiffRoute = HttpRouter.add(
  'GET',
  '/api/agents/:agentId/diffs/vs-main',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const originCheck = validateOrigin(request)
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 })
    }

    const params = yield* HttpRouter.params
    const agentId = params.agentId
    const readModel = yield* ReadModelService

    return yield* Effect.promise(async () => {
      try {
        const snapshot = await Effect.runPromise(readModel.getSnapshot)
        const agent = (snapshot.agents as any[]).find((a: any) => a.id === agentId)
        if (!agent) {
          return jsonResponse({ error: 'Agent not found' }, { status: 404 })
        }

        const workspace: string | null = agent.workspace ?? null
        if (!workspace) {
          return jsonResponse({ error: 'Agent has no workspace' }, { status: 400 })
        }

        const url = new URL(request.url, 'http://localhost')
        const filePath = url.searchParams.get('file') ?? undefined
        const files = await diffAgainstMainFiles(workspace)
        const diff = filePath ? await diffAgainstMain(workspace, filePath) : undefined

        return jsonResponse({ agentId, ...(diff !== undefined && { diff }), files })
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[diffs] get vs-main diff failed:', msg)
        return jsonResponse({ error: 'Internal server error' }, { status: 500 })
      }
    })
  }),
)

// ─── Route: POST /api/agents/:agentId/diffs/test-checkpoint ─────────────────
// Test-only: captures a checkpoint and emits a turn_diff_completed event.

const postTestCheckpointRoute = HttpRouter.add(
  'POST',
  '/api/agents/:agentId/diffs/test-checkpoint',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const originCheck = validateOrigin(request)
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 })
    }

    const params = yield* HttpRouter.params
    const agentId = params.agentId
    const readModel = yield* ReadModelService

    return yield* Effect.promise(async () => {
      try {
        const snapshot = await Effect.runPromise(readModel.getSnapshot)
        const agent = (snapshot.agents as any[]).find((a: any) => a.id === agentId)
        if (!agent) {
          return jsonResponse({ error: 'Agent not found' }, { status: 404 })
        }

        const workspace: string | null = agent.workspace ?? null
        if (!workspace) {
          return jsonResponse({ error: 'Agent has no workspace' }, { status: 400 })
        }

        const turnId = `test-turn-${Date.now()}`

        // Capture checkpoint
        await captureCheckpoint(workspace, turnId)

        // Get file changes from previous checkpoint (if any)
        const checkpoints = await listCheckpoints(workspace)
        const prevCheckpoint = checkpoints.length >= 2 ? checkpoints[checkpoints.length - 2] : null
        let files: Array<{ path: string; kind?: string; additions?: number; deletions?: number }> = []
        if (prevCheckpoint) {
          files = await diffCheckpointFiles(workspace, prevCheckpoint, turnId)
        }

        // Emit event
        const store = getEventStore()
        await store.appendAsync({
          type: 'agent.turn_diff_completed',
          timestamp: new Date().toISOString(),
          payload: {
            agentId,
            turnId,
            completedAt: new Date().toISOString(),
            files,
            checkpointRef: `refs/pan/turn/${turnId}`,
            assistantMessageId: undefined,
            checkpointTurnCount: checkpoints.length,
          },
        } as any)

        return jsonResponse({ turnId, files, checkpointCount: checkpoints.length })
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[diffs] test checkpoint failed:', msg)
        return jsonResponse({ error: msg }, { status: 500 })
      }
    })
  }),
)

// ─── Compose ──────────────────────────────────────────────────────────────────

export const diffsRouteLayer = Layer.mergeAll(
  getDiffsRoute,
  getTurnDiffRoute,
  getFullDiffRoute,
  getVsMainDiffRoute,
  postTestCheckpointRoute,
)

export default diffsRouteLayer
