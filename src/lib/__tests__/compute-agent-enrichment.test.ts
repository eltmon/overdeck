import { describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { computeAgentEnrichment } from '../agent-enrichment.js'
import * as agents from '../agents.js'
import * as agentInputDetection from '../agent-input-detection.js'

vi.mock('../agents.js', async (importOriginal) => {
  const original = await importOriginal<typeof agents>()
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
  const getAgentRuntimeStateMock = vi.mocked(agents.getAgentRuntimeState)
  const detectAwaitingInputForAgentMock = vi.mocked(agentInputDetection.detectAwaitingInputForAgent)

  it('produces pendingInputKinds for a review-role agent even when hasActiveSpecialist is true', async () => {
    const agentDir = makeAgentDir('review')
    const agentId = `agent-test-${Date.now()}`
    vi.spyOn(agents, 'getAgentDir').mockReturnValue(agentDir)
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'idle', resolution: 'working', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed({ reason: 'rate_limit', prompt: 'Switch model?' }))

    const enrichment = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, true, true))

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
    getAgentRuntimeStateMock.mockReturnValue(Effect.succeed({ state: 'idle', resolution: 'working', resolutionCount: 0 }))
    detectAwaitingInputForAgentMock.mockReturnValue(Effect.succeed({ reason: 'rate_limit', prompt: 'Switch model?' }))

    const enrichment = await Effect.runPromise(computeAgentEnrichment(agentId, undefined, true, true))

    expect(enrichment.role).toBe('work')
    expect(enrichment.hasPendingQuestion).toBe(false)
    expect(enrichment.pendingInputKinds).toEqual([])
    expect(enrichment.pendingInputCount).toBe(0)

    rmSync(agentDir, { recursive: true, force: true })
  })
})
