import { describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { computeAgentEnrichment, EMPTY_PENDING_INPUTS_SCAN } from '../agent-enrichment.js'
import * as agents from '../agents.js'
import * as agentInputDetection from '../agent-input-detection.js'

vi.mock('../agents.js', async (importOriginal) => {
  const original = await importOriginal<typeof agents>()
  return {
    ...original,
    getAgentRuntimeState: vi.fn(),
    getAgentStateSync: vi.fn(),
  }
})

vi.mock('../agent-input-detection.js', async (importOriginal) => {
  const original = await importOriginal<typeof agentInputDetection>()
  return {
    ...original,
    detectAwaitingInputForAgent: vi.fn(),
  }
})

function makeAgentDir(role: string) {
  const dir = mkdtempSync(join(tmpdir(), 'pan-enrichment-test-'))
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ role }))
  return dir
}

describe('computeAgentEnrichment hasActiveSpecialist suppression', () => {
  const getAgentRuntimeStateMock = vi.mocked(agents.getAgentRuntimeState)
  const getAgentStateSyncMock = vi.mocked(agents.getAgentStateSync)
  const detectAwaitingInputForAgentMock = vi.mocked(agentInputDetection.detectAwaitingInputForAgent)

  it('produces pendingInputKinds for a review-role agent even when hasActiveSpecialist is true', async () => {
    const agentDir = makeAgentDir('review')
    const agentId = `agent-test-${Date.now()}`
    vi.spyOn(agents, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role: 'review' } as ReturnType<typeof agents.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'idle', resolution: 'working', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed({ reason: 'rate_limit', prompt: 'Switch model?' }))

    const enrichment = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, true, EMPTY_PENDING_INPUTS_SCAN))

    expect(enrichment.role).toBe('review')
    expect(enrichment.hasPendingQuestion).toBe(true)
    expect(enrichment.pendingInputKinds).toContain('rateLimit')
    expect(enrichment.pendingInputCount).toBeGreaterThan(0)

    rmSync(agentDir, { recursive: true, force: true })
  })

  it('suppresses pendingInputKinds for a work-role agent when hasActiveSpecialist is true', async () => {
    const agentDir = makeAgentDir('work')
    const agentId = `agent-test-${Date.now()}`
    vi.spyOn(agents, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role: 'work' } as ReturnType<typeof agents.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'idle', resolution: 'working', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed({ reason: 'rate_limit', prompt: 'Switch model?' }))

    const enrichment = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, true, EMPTY_PENDING_INPUTS_SCAN))

    expect(enrichment.role).toBe('work')
    expect(enrichment.hasPendingQuestion).toBe(false)
    expect(enrichment.pendingInputKinds).toEqual([])
    expect(enrichment.pendingInputCount).toBe(0)

    rmSync(agentDir, { recursive: true, force: true })
  })
})

/**
 * Regression: the enrichment must never assert "nothing is pending" from a scan
 * it did not perform. An agent blocked on an AskUserQuestion writes nothing to
 * its JSONL, so its mtime never moves again — the poller therefore replays the
 * cached scan forever. When the old code took that path it fabricated an empty
 * scan, which latched the operator's dialog closed until a server restart.
 */
describe('computeAgentEnrichment cached-scan replay', () => {
  const getAgentRuntimeStateMock = vi.mocked(agents.getAgentRuntimeState)
  const getAgentStateSyncMock = vi.mocked(agents.getAgentStateSync)
  const detectAwaitingInputForAgentMock = vi.mocked(agentInputDetection.detectAwaitingInputForAgent)

  const scanWithQuestion = {
    askUserQuestions: [
      {
        toolId: 'toolu_cached_auq',
        timestamp: '2026-07-15T12:00:00.000Z',
        questions: [
          {
            question: 'Which approach?',
            header: 'Approach',
            multiSelect: false,
            options: [{ label: 'A', description: 'first' }, { label: 'B', description: 'second' }],
          },
        ],
      },
    ],
    enterPlanModeOpen: false,
    exitPlanModePending: false,
  }

  function arrange(role: string, agentId: string) {
    const agentDir = makeAgentDir(role)
    vi.spyOn(agents, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role } as ReturnType<typeof agents.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'idle', resolution: 'working', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed(null))
    return agentDir
  }

  it('surfaces the AskUserQuestion from a replayed scan instead of reporting none', async () => {
    const agentId = 'agent-cached-scan-1'
    const agentDir = arrange('work', agentId)

    const enrichment = await Effect.runPromise(
      computeAgentEnrichment(agentId, undefined, false, scanWithQuestion),
    )

    expect(enrichment.pendingAskUserQuestion?.toolUseId).toBe('toolu_cached_auq')
    expect(enrichment.pendingInputKinds).toContain('askUserQuestion')
    expect(enrichment.hasPendingQuestion).toBe(true)

    rmSync(agentDir, { recursive: true, force: true })
  })

  it('re-surfaces the question once specialist suppression clears, without a fresh scan', async () => {
    const agentId = 'agent-cached-scan-2'
    const agentDir = arrange('work', agentId)

    // A review/test/merge specialist parks the work agent: the payload is suppressed.
    const suppressed = await Effect.runPromise(
      computeAgentEnrichment(agentId, undefined, true, scanWithQuestion),
    )
    expect(suppressed.pendingAskUserQuestion).toBeUndefined()
    expect(suppressed.hasPendingQuestion).toBe(false)

    // Specialist finishes. The JSONL never changed, so only the cached scan is
    // available — the question must come back rather than stay latched off.
    const restored = await Effect.runPromise(
      computeAgentEnrichment(agentId, undefined, false, scanWithQuestion),
    )
    expect(restored.pendingAskUserQuestion?.toolUseId).toBe('toolu_cached_auq')
    expect(restored.hasPendingQuestion).toBe(true)

    rmSync(agentDir, { recursive: true, force: true })
  })

  it('returns the scan it used so the poller can cache it against the mtime', async () => {
    const agentId = 'agent-cached-scan-3'
    const agentDir = arrange('work', agentId)

    const enrichment = await Effect.runPromise(
      computeAgentEnrichment(agentId, undefined, false, scanWithQuestion),
    )
    expect(enrichment.jsonlScan).toEqual(scanWithQuestion)

    rmSync(agentDir, { recursive: true, force: true })
  })

  it('reports nothing pending for an explicitly empty scan', async () => {
    const agentId = 'agent-cached-scan-4'
    const agentDir = arrange('work', agentId)

    const enrichment = await Effect.runPromise(
      computeAgentEnrichment(agentId, undefined, false, EMPTY_PENDING_INPUTS_SCAN),
    )
    expect(enrichment.pendingAskUserQuestion).toBeUndefined()
    expect(enrichment.pendingInputKinds).toEqual([])

    rmSync(agentDir, { recursive: true, force: true })
  })
})
