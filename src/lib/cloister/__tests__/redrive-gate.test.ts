import { afterEach, describe, expect, it, vi } from 'vitest'

import { decideAgentAutonomousRedrive } from '../redrive-gate.js'
import { setCachedMemoryVerdictForTests } from '../memory-verdict-cache.js'

afterEach(() => setCachedMemoryVerdictForTests(null))

describe('decideAgentAutonomousRedrive pending decision gate', () => {
  it('defers with needs-you when the agent is waiting on a permission decision', async () => {
    const detectPendingOperatorDecision = vi.fn(async () => ({
      source: 'pane' as const,
      reason: 'tool_permission' as const,
      prompt: 'Allow this command?',
    }))

    await expect(decideAgentAutonomousRedrive(
      {},
      '/tmp/agent-pan-3228',
      true,
      { detectPendingOperatorDecision },
    )).resolves.toEqual({
      decision: 'defer',
      reason: 'agent is waiting on an operator decision (tool_permission)',
      needsYou: true,
    })
    expect(detectPendingOperatorDecision).toHaveBeenCalledWith('agent-pan-3228')
  })

  it('preserves autonomous admission when no operator decision is pending', async () => {
    await expect(decideAgentAutonomousRedrive(
      {},
      '/tmp/agent-pan-3228',
      true,
      { detectPendingOperatorDecision: vi.fn(async () => null) },
    )).resolves.toEqual({
      decision: 'proceed',
      gateDecision: { decision: 'proceed' },
    })
  })
})
