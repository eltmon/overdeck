import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const subscriptionMocks = vi.hoisted(() => ({
  useAgentOutputSubscription: vi.fn(),
}))

vi.mock('../../hooks/useAgentOutputSubscription', () => subscriptionMocks)
vi.mock('./CanvasTerminal', () => ({ CanvasTerminal: () => <div data-testid="canvas-terminal" /> }))

import { AgentCard } from './AgentCard'
import type { Agent } from '../../types'

let intersectionCallback: IntersectionObserverCallback

class TestIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return [] }
  readonly root = null
  readonly rootMargin = '200px'
  readonly thresholds = [0]
}

const agent: Agent = {
  id: 'agent-pan-1',
  issueId: 'PAN-1',
  runtime: 'local',
  model: 'test-model',
  status: 'running',
  startedAt: '2026-07-19T00:00:00.000Z',
  consecutiveFailures: 0,
  killCount: 0,
}

describe('AgentCard output interest', () => {
  beforeEach(() => {
    subscriptionMocks.useAgentOutputSubscription.mockClear()
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('subscribes only while the card is in or near the viewport', () => {
    render(<AgentCard agent={agent} onClick={() => undefined} />)
    expect(subscriptionMocks.useAgentOutputSubscription).toHaveBeenLastCalledWith(agent.id, false)

    act(() => {
      intersectionCallback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    expect(subscriptionMocks.useAgentOutputSubscription).toHaveBeenLastCalledWith(agent.id, true)

    act(() => {
      intersectionCallback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
    expect(subscriptionMocks.useAgentOutputSubscription).toHaveBeenLastCalledWith(agent.id, false)
  })
})
