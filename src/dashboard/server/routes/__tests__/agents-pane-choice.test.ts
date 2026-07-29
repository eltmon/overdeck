import { describe, expect, it, vi } from 'vitest'

import {
  handleGetAgentPaneChoice,
  handlePostAgentPaneChoice,
} from '../agents/permissions.js'

const agentId = 'agent-pan-3228'
const paneChoice = {
  signature: 'sig-1',
  title: 'Allow this command?',
  contextLines: ['Bash command'],
  options: [
    { number: 1, label: 'Yes', recommended: false },
    { number: 2, label: 'No', recommended: false },
  ],
  selectedIndex: 0,
  footerHint: 'Enter to confirm',
  confidence: 'high' as const,
}

describe('agent pane-choice handlers', () => {
  it('GET returns the parsed menu payload and reports when no menu is pending', async () => {
    await expect(handleGetAgentPaneChoice(agentId, {
      captureSessionPaneChoice: vi.fn(async () => paneChoice),
    })).resolves.toEqual({
      body: { pending: true, ...paneChoice },
    })

    await expect(handleGetAgentPaneChoice(agentId, {
      captureSessionPaneChoice: vi.fn(async () => null),
    })).resolves.toEqual({
      body: { pending: false },
    })
  })

  it('POST answers a matching menu and emits issue-scoped activity', async () => {
    const emitActivityEntry = vi.fn()
    const answerSessionPaneChoice = vi.fn(async () => ({
      body: { ok: true, answeredLabel: 'No' },
    }))

    const result = await handlePostAgentPaneChoice(
      agentId,
      { selectedIndex: 1, signature: 'sig-1' },
      {
        getAgentState: vi.fn(async () => ({ issueId: 'PAN-3228' })),
        answerSessionPaneChoice,
        emitActivityEntry,
      },
    )

    expect(result).toEqual({ body: { ok: true, answeredLabel: 'No' } })
    expect(answerSessionPaneChoice).toHaveBeenCalledWith(agentId, {
      selectedIndex: 1,
      signature: 'sig-1',
    })
    expect(emitActivityEntry).toHaveBeenCalledWith({
      source: 'dashboard',
      level: 'info',
      issueId: 'PAN-3228',
      message: "Operator answered agent-pan-3228's pane menu: No",
    })
  })

  it('POST preserves menu-changed refusal and returns 404 for unknown agents', async () => {
    await expect(handlePostAgentPaneChoice(
      agentId,
      { selectedIndex: 0, signature: 'stale' },
      {
        getAgentState: vi.fn(async () => ({ issueId: 'PAN-3228' })),
        answerSessionPaneChoice: vi.fn(async () => ({
          body: { error: 'The choice menu changed', code: 'menu-changed' },
          status: 409,
        })),
      },
    )).resolves.toEqual({
      body: { error: 'The choice menu changed', code: 'menu-changed' },
      status: 409,
    })

    await expect(handlePostAgentPaneChoice(
      'agent-missing',
      { selectedIndex: 0, signature: 'sig-1' },
      { getAgentState: vi.fn(async () => null) },
    )).resolves.toEqual({
      body: { error: 'Agent agent-missing not found' },
      status: 404,
    })
  })
})
