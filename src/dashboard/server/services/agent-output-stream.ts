import { Effect, Stream } from 'effect'

import type { AgentOutput } from '@overdeck/contracts'
import type { EventStoreServiceShape } from './domain-services.js'
import { retainAgentOutputInterest } from './agent-output-service.js'

export function shouldBroadcastDashboardEvent(event: { type: string }): boolean {
  return event.type !== 'agent.output_received'
}

/** Dedicated, scoped stream for one agent's ephemeral output. */
export function streamAgentOutput(
  eventStore: EventStoreServiceShape,
  agentId: string,
): Stream.Stream<AgentOutput> {
  return Stream.unwrap(
    Effect.acquireRelease(
      Effect.sync(() => retainAgentOutputInterest(agentId)),
      (release) => Effect.sync(release),
    ).pipe(
      Effect.map(() => eventStore.streamEvents.pipe(
        Stream.filter(
          (event) => event.type === 'agent.output_received'
            && (event.payload as Record<string, unknown>)['agentId'] === agentId,
        ),
        Stream.flatMap((event) => {
          const payload = event.payload as { agentId: string; lines: string[] }
          return Stream.fromIterable(
            payload.lines.map((line) => ({ agentId: payload.agentId, line })),
          )
        }),
      )),
    ),
  )
}
