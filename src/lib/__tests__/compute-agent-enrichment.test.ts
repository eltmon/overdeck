import { describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { computeAgentEnrichment, EMPTY_PENDING_INPUTS_SCAN } from '../agent-enrichment.js'
import * as agentState from '../agents/agent-state.js'
import * as runtimeState from '../agents/runtime-state.js'
import * as agentInputDetection from '../agent-input-detection.js'

vi.mock('../agents/agent-state.js', async (importOriginal) => {
  const original = await importOriginal<typeof agentState>()
  return {
    ...original,
    getAgentDir: vi.fn(),
    getAgentStateSync: vi.fn(),
  }
})

vi.mock('../agents/runtime-state.js', async (importOriginal) => {
  const original = await importOriginal<typeof runtimeState>()
  return {
    ...original,
    getAgentRuntimeState: vi.fn(),
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
  const getAgentRuntimeStateMock = vi.mocked(runtimeState.getAgentRuntimeState)
  const getAgentStateSyncMock = vi.mocked(agentState.getAgentStateSync)
  const detectAwaitingInputForAgentMock = vi.mocked(agentInputDetection.detectAwaitingInputForAgent)

  it('produces pendingInputKinds for a review-role agent even when hasActiveSpecialist is true', async () => {
    const agentDir = makeAgentDir('review')
    const agentId = `agent-test-${Date.now()}`
    vi.spyOn(agentState, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role: 'review' } as ReturnType<typeof agentState.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'idle', resolution: 'working', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed({ reason: 'rate_limit', prompt: 'Switch model?' }))

    const enrichment = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, true, EMPTY_PENDING_INPUTS_SCAN))

    expect(enrichment.role).toBe('review')
    expect(enrichment.hasPendingQuestion).toBe(true)
    expect(enrichment.pendingInputKinds).toContain('rateLimit')
    expect(enrichment.pendingInputCount).toBeGreaterThan(0)

    rmSync(agentDir, { recursive: true, force: true })
  })

  it('surfaces a tool_permission pane detection for a work-role agent even when hasActiveSpecialist is true', async () => {
    const agentDir = makeAgentDir('work')
    const agentId = `agent-test-${Date.now()}`
    vi.spyOn(agentState, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role: 'work' } as ReturnType<typeof agentState.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'idle', resolution: 'working', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed({ reason: 'tool_permission', prompt: 'Allow background operator?' }))

    const enrichment = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, true, EMPTY_PENDING_INPUTS_SCAN))

    expect(enrichment.role).toBe('work')
    expect(enrichment.hasPendingQuestion).toBe(true)
    expect(enrichment.pendingInputKinds).toEqual(['permissionRequest'])
    expect(enrichment.resolution).toBe('needs_input')

    rmSync(agentDir, { recursive: true, force: true })
  })

  // Review fix (PAN-3233): the pane exemption must not also unsuppress
  // unrelated stale JSONL/plan state sitting in the same scan.
  it('surfaces only the pane permission — not a stale pendingProposedPlan — when both are present under an active specialist', async () => {
    const agentDir = makeAgentDir('work')
    const agentId = `agent-test-${Date.now()}`
    vi.spyOn(agentState, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role: 'work' } as ReturnType<typeof agentState.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'idle', resolution: 'working', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed({ reason: 'tool_permission', prompt: 'Allow background operator?' }))
    const scanWithStalePlan = {
      ...EMPTY_PENDING_INPUTS_SCAN,
      exitPlanModePending: true,
      pendingProposedPlan: { toolUseId: 'toolu_stale_plan', askedAt: '2026-07-28T11:00:00.000Z', plan: 'Stale cached plan' },
    }

    const enrichment = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, true, scanWithStalePlan))

    expect(enrichment.hasPendingQuestion).toBe(true)
    expect(enrichment.pendingInputKinds).toEqual(['permissionRequest'])
    expect(enrichment.pendingProposedPlan).toBeUndefined()

    rmSync(agentDir, { recursive: true, force: true })
  })

  it('suppresses a JSONL AskUserQuestion for a work-role agent when hasActiveSpecialist is true', async () => {
    const agentDir = makeAgentDir('work')
    const agentId = `agent-test-${Date.now()}`
    vi.spyOn(agentState, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role: 'work' } as ReturnType<typeof agentState.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'idle', resolution: 'working', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed(null))
    const scanWithQuestion = {
      ...EMPTY_PENDING_INPUTS_SCAN,
      askUserQuestions: [
        {
          toolId: 'toolu_suppressed_auq',
          timestamp: '2026-07-28T12:00:00.000Z',
          questions: [
            { question: 'Which approach?', header: 'Approach', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
          ],
        },
      ],
    }

    const enrichment = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, true, scanWithQuestion))

    expect(enrichment.role).toBe('work')
    expect(enrichment.hasPendingQuestion).toBe(false)
    expect(enrichment.pendingInputKinds).toEqual([])
    expect(enrichment.pendingInputCount).toBe(0)

    rmSync(agentDir, { recursive: true, force: true })
  })

  it('suppresses the whole pendingQuestion fingerprint, not just hasPendingQuestion', async () => {
    const agentDir = makeAgentDir('work')
    const agentId = `agent-test-${Date.now()}`
    vi.spyOn(agentState, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role: 'work' } as ReturnType<typeof agentState.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'idle', resolution: 'working', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed(null))
    const scanWithQuestion = {
      ...EMPTY_PENDING_INPUTS_SCAN,
      askUserQuestions: [
        {
          toolId: 'toolu_fingerprint_auq',
          timestamp: '2026-07-28T12:00:00.000Z',
          questions: [
            { question: 'Which approach?', header: 'Approach', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
          ],
        },
      ],
    }

    const enrichment = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, true, scanWithQuestion))

    expect(enrichment.hasPendingQuestion).toBe(false)
    expect(enrichment.pendingQuestionCount).toBe(0)
    expect(enrichment.pendingQuestionPrompt).toBeUndefined()
    expect(enrichment.pendingQuestionReason).toBeUndefined()

    rmSync(agentDir, { recursive: true, force: true })
  })
})

describe('computeAgentEnrichment pendingQuestionCount folding', () => {
  const getAgentRuntimeStateMock = vi.mocked(runtimeState.getAgentRuntimeState)
  const getAgentStateSyncMock = vi.mocked(agentState.getAgentStateSync)
  const detectAwaitingInputForAgentMock = vi.mocked(agentInputDetection.detectAwaitingInputForAgent)

  it('counts 1 for a blocking pane detection with no JSONL questions', async () => {
    const agentDir = makeAgentDir('work')
    const agentId = `agent-test-${Date.now()}`
    vi.spyOn(agentState, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role: 'work' } as ReturnType<typeof agentState.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'idle', resolution: 'working', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed({ reason: 'tool_permission', prompt: 'Allow?' }))

    const enrichment = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, false, EMPTY_PENDING_INPUTS_SCAN))

    expect(enrichment.pendingQuestionCount).toBe(1)

    rmSync(agentDir, { recursive: true, force: true })
  })

  it('counts 0 for the generic other fallback', async () => {
    const agentDir = makeAgentDir('work')
    const agentId = `agent-test-${Date.now()}`
    vi.spyOn(agentState, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role: 'work' } as ReturnType<typeof agentState.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'idle', resolution: 'needs_input', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed(null))

    const enrichment = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, false, EMPTY_PENDING_INPUTS_SCAN))

    expect(enrichment.pendingQuestionReason).toBe('other')
    expect(enrichment.pendingQuestionCount).toBe(0)

    rmSync(agentDir, { recursive: true, force: true })
  })

  it('reports the JSONL question count unchanged when JSONL questions are pending', async () => {
    const agentDir = makeAgentDir('work')
    const agentId = `agent-test-${Date.now()}`
    vi.spyOn(agentState, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role: 'work' } as ReturnType<typeof agentState.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'idle', resolution: 'working', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed(null))
    const scanWithQuestion = {
      ...EMPTY_PENDING_INPUTS_SCAN,
      askUserQuestions: [
        {
          toolId: 'toolu_count_auq',
          timestamp: '2026-07-28T12:00:00.000Z',
          questions: [
            { question: 'Which approach?', header: 'Approach', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
          ],
        },
      ],
    }

    const enrichment = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, false, scanWithQuestion))

    expect(enrichment.pendingQuestionCount).toBe(1)

    rmSync(agentDir, { recursive: true, force: true })
  })
})

describe('computeAgentEnrichment paneQuestion kind', () => {
  const getAgentRuntimeStateMock = vi.mocked(runtimeState.getAgentRuntimeState)
  const getAgentStateSyncMock = vi.mocked(agentState.getAgentStateSync)
  const detectAwaitingInputForAgentMock = vi.mocked(agentInputDetection.detectAwaitingInputForAgent)

  it('surfaces paneQuestion for a runtime user_question detection', async () => {
    const agentDir = makeAgentDir('work')
    const agentId = `agent-test-${Date.now()}`
    vi.spyOn(agentState, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role: 'work' } as ReturnType<typeof agentState.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(
      Effect.succeed({ state: 'waiting-on-human', waitingReason: 'user_question', resolution: 'working', resolutionCount: 0 }),
    )
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed(null))

    const enrichment = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, false, EMPTY_PENDING_INPUTS_SCAN))

    expect(enrichment.hasPendingQuestion).toBe(true)
    expect(enrichment.pendingInputKinds).toEqual(['paneQuestion'])
    expect(enrichment.pendingInputCount).toBe(1)

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
  const getAgentRuntimeStateMock = vi.mocked(runtimeState.getAgentRuntimeState)
  const getAgentStateSyncMock = vi.mocked(agentState.getAgentStateSync)
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
    vi.spyOn(agentState, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role } as ReturnType<typeof agentState.getAgentStateSync>)
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

/**
 * An interactive session does not finish — it yields the turn. A question asked
 * in prose leaves no AskUserQuestion tool_use and no modal in the pane, so every
 * other detector misses it and the agent sits silent. Observed live on
 * planning-pan-2760: 36 minutes idle with three options on screen, and the
 * dashboard reporting hasPendingQuestion:false.
 */
describe('computeAgentEnrichment interactive turn-end', () => {
  const getAgentRuntimeStateMock = vi.mocked(runtimeState.getAgentRuntimeState)
  const getAgentStateSyncMock = vi.mocked(agentState.getAgentStateSync)
  const detectAwaitingInputForAgentMock = vi.mocked(agentInputDetection.detectAwaitingInputForAgent)

  function arrange(role: string, agentId: string, state: string) {
    const agentDir = makeAgentDir(role)
    vi.spyOn(agentState, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role } as ReturnType<typeof agentState.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state, resolution: 'working', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed(null))
    return agentDir
  }

  it('flags an idle plan-role agent as waiting on the operator', async () => {
    const agentId = 'planning-pan-2760'
    const dir = arrange('plan', agentId, 'idle')

    const e = await Effect.runPromise(
      computeAgentEnrichment(agentId, undefined, false, EMPTY_PENDING_INPUTS_SCAN),
    )

    expect(e.pendingInputKinds).toContain('agentTurnEnded')
    expect(e.hasPendingQuestion).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('does NOT flag an idle work-role agent — its idle can mean between-items', async () => {
    const agentId = 'agent-pan-2760'
    const dir = arrange('work', agentId, 'idle')

    const e = await Effect.runPromise(
      computeAgentEnrichment(agentId, undefined, false, EMPTY_PENDING_INPUTS_SCAN),
    )

    expect(e.pendingInputKinds).not.toContain('agentTurnEnded')
    expect(e.hasPendingQuestion).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('does NOT flag an actively working plan agent', async () => {
    const agentId = 'planning-pan-2761'
    const dir = arrange('plan', agentId, 'active')

    const e = await Effect.runPromise(
      computeAgentEnrichment(agentId, undefined, false, EMPTY_PENDING_INPUTS_SCAN),
    )

    expect(e.pendingInputKinds).not.toContain('agentTurnEnded')
    rmSync(dir, { recursive: true, force: true })
  })

  it('prefers the real question over the generic turn-end when both are true', async () => {
    const agentId = 'planning-pan-2762'
    const dir = arrange('plan', agentId, 'idle')

    const scan = {
      askUserQuestions: [{
        toolId: 'toolu_real',
        timestamp: '2026-07-15T12:00:00.000Z',
        questions: [{ question: 'Which approach?', header: 'Approach', multiSelect: false, options: [{ label: 'A', description: 'a' }] }],
      }],
      enterPlanModeOpen: false,
      exitPlanModePending: false,
    }
    const e = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, false, scan))

    expect(e.pendingInputKinds).toContain('askUserQuestion')
    expect(e.pendingInputKinds).not.toContain('agentTurnEnded')
    expect(e.pendingQuestionReason).toBe('user_question')
    rmSync(dir, { recursive: true, force: true })
  })
})

/**
 * The plan payload was a dead wire: the scan produced it and the poller emitted
 * `enrichment.pendingProposedPlan`, but the field was never on AgentEnrichment,
 * so it read `undefined` forever and no plan reached the store from the agent
 * path. It compiled because the root tsconfig excluded the dashboard.
 */
describe('computeAgentEnrichment plan payload', () => {
  const getAgentRuntimeStateMock = vi.mocked(runtimeState.getAgentRuntimeState)
  const getAgentStateSyncMock = vi.mocked(agentState.getAgentStateSync)
  const detectAwaitingInputForAgentMock = vi.mocked(agentInputDetection.detectAwaitingInputForAgent)

  const scanWithPlan = {
    askUserQuestions: [],
    enterPlanModeOpen: false,
    exitPlanModePending: true,
    pendingProposedPlan: { toolUseId: 'toolu_plan', askedAt: '2026-07-16T03:00:00.000Z', plan: 'Revert 58e23c4.' },
  }

  function arrange(role: string, agentId: string) {
    const dir = makeAgentDir(role)
    vi.spyOn(agentState, 'getAgentDir').mockReturnValue(dir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role } as ReturnType<typeof agentState.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'active', resolution: 'working', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed(null))
    return dir
  }

  it('carries the proposed plan through to the enrichment', async () => {
    const agentId = 'agent-pan-2748'
    const dir = arrange('work', agentId)

    const e = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, false, scanWithPlan))

    expect(e.pendingProposedPlan?.toolUseId).toBe('toolu_plan')
    expect(e.pendingInputKinds).toContain('exitPlanMode')
    rmSync(dir, { recursive: true, force: true })
  })

  it('suppresses the plan while a specialist owns the issue', async () => {
    const agentId = 'agent-pan-2749'
    const dir = arrange('work', agentId)

    const e = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, true, scanWithPlan))

    expect(e.pendingProposedPlan).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })
})

/**
 * PAN-3070 — an agent frozen on an unanswered tool-permission prompt was
 * reported `resolution: working` (and `status: healthy` by the REST listing)
 * for hours, while the Decisions surface simultaneously showed it as needing
 * the operator. The runtime resolution is written by the stop hook and stays at
 * whatever it last was, so the detection computed here is the fresher evidence
 * and has to win.
 */
describe('computeAgentEnrichment blocking-prompt resolution', () => {
  const getAgentRuntimeStateMock = vi.mocked(runtimeState.getAgentRuntimeState)
  const getAgentStateSyncMock = vi.mocked(agentState.getAgentStateSync)
  const detectAwaitingInputForAgentMock = vi.mocked(agentInputDetection.detectAwaitingInputForAgent)

  function arrange(agentId: string) {
    const agentDir = makeAgentDir('work')
    vi.spyOn(agentState, 'getAgentDir').mockReturnValue(agentDir)
    getAgentStateSyncMock.mockReturnValue({ id: agentId, role: 'work' } as ReturnType<typeof agentState.getAgentStateSync>)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'active', resolution: 'working', resolutionCount: 3 }))
    return agentDir
  }

  it('reports needs_input and a permissionRequest kind for a parked permission prompt', async () => {
    const agentId = 'agent-min-896'
    const dir = arrange(agentId)
    detectAwaitingInputForAgentMock.mockReturnValue(
      Effect.succeed({ reason: 'tool_permission', prompt: 'Allow .devcontainer edit?' }),
    )

    const e = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, false, EMPTY_PENDING_INPUTS_SCAN))

    expect(e.hasPendingQuestion).toBe(true)
    expect(e.pendingQuestionReason).toBe('tool_permission')
    expect(e.resolution).toBe('needs_input')
    expect(e.pendingInputKinds).toContain('permissionRequest')
    expect(e.pendingInputCount).toBeGreaterThan(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it('leaves a genuinely working agent alone', async () => {
    const agentId = 'agent-pan-3070'
    const dir = arrange(agentId)
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed(null))

    const e = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, false, EMPTY_PENDING_INPUTS_SCAN))

    expect(e.hasPendingQuestion).toBe(false)
    expect(e.resolution).toBe('working')
    expect(e.pendingInputKinds).toEqual([])
    rmSync(dir, { recursive: true, force: true })
  })
})
