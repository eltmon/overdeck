import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const transportMocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
}))

vi.mock('../lib/wsTransport', () => ({
  getTransport: () => ({ subscribe: transportMocks.subscribe }),
}))

import {
  resetAgentOutputSubscriptionsForTests,
  retainAgentOutputSubscription,
} from './useAgentOutputSubscription'
import { useDashboardStore } from '../lib/store'

describe('agent output subscriptions', () => {
  beforeEach(() => {
    transportMocks.subscribe.mockReset()
    useDashboardStore.setState({ agentOutputById: {}, sequence: 7 })
  })

  afterEach(() => {
    resetAgentOutputSubscriptionsForTests()
  })

  it('shares one transport stream per agent until the final release', () => {
    const unsubscribe = vi.fn()
    transportMocks.subscribe.mockReturnValue(unsubscribe)

    const releaseFirst = retainAgentOutputSubscription('agent-one')
    const releaseSecond = retainAgentOutputSubscription('agent-one')

    expect(transportMocks.subscribe).toHaveBeenCalledOnce()
    releaseFirst()
    expect(unsubscribe).not.toHaveBeenCalled()
    releaseSecond()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('routes dedicated output lines through the existing capped reducer', () => {
    let listener: ((output: { agentId: string; line: string }) => void) | undefined
    transportMocks.subscribe.mockImplementation((_connect, next) => {
      listener = next
      return vi.fn()
    })

    const release = retainAgentOutputSubscription('agent-one')
    listener?.({ agentId: 'agent-one', line: 'new output' })

    expect(useDashboardStore.getState().agentOutputById['agent-one']).toEqual(['new output'])
    expect(useDashboardStore.getState().sequence).toBe(7)
    release()
  })

  it('opens independent streams for different agents', () => {
    transportMocks.subscribe.mockReturnValue(vi.fn())

    const releaseOne = retainAgentOutputSubscription('agent-one')
    const releaseTwo = retainAgentOutputSubscription('agent-two')

    expect(transportMocks.subscribe).toHaveBeenCalledTimes(2)
    releaseOne()
    releaseTwo()
  })
})
