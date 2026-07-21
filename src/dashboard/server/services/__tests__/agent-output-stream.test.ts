import { Effect, Stream } from 'effect'
import { describe, expect, it, vi } from 'vitest'

const interestMocks = vi.hoisted(() => ({
  release: vi.fn(),
  retainAgentOutputInterest: vi.fn(),
}))

vi.mock('../agent-output-service.js', () => ({
  retainAgentOutputInterest: interestMocks.retainAgentOutputInterest,
}))

import { streamAgentOutput } from '../agent-output-stream.js'
import type { EventStoreServiceShape } from '../domain-services.js'

function eventStoreWith(events: Array<Record<string, unknown>>): EventStoreServiceShape {
  return {
    append: vi.fn(),
    appendAsync: vi.fn(),
    readFrom: vi.fn(),
    queryByType: vi.fn(),
    getLatestSequence: Effect.succeed(0),
    streamEvents: Stream.fromIterable(events) as EventStoreServiceShape['streamEvents'],
  }
}

describe('streamAgentOutput', () => {
  it('retains interest for the stream lifetime and emits only the requested agent', async () => {
    interestMocks.release.mockClear()
    interestMocks.retainAgentOutputInterest.mockReturnValue(interestMocks.release)
    const store = eventStoreWith([
      { type: 'agent.output_received', payload: { agentId: 'agent-one', lines: ['a', 'b'] } },
      { type: 'agent.output_received', payload: { agentId: 'agent-two', lines: ['other'] } },
      { type: 'agent.status_changed', payload: { agentId: 'agent-one' } },
    ])

    const output = await Effect.runPromise(
      streamAgentOutput(store, 'agent-one').pipe(Stream.runCollect),
    )

    expect(Array.from(output)).toEqual([
      { agentId: 'agent-one', line: 'a' },
      { agentId: 'agent-one', line: 'b' },
    ])
    expect(interestMocks.retainAgentOutputInterest).toHaveBeenCalledWith('agent-one')
    expect(interestMocks.release).toHaveBeenCalledOnce()
  })
})
