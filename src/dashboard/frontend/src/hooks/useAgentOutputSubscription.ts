import { useEffect } from 'react'
import { Stream } from 'effect'

import { WS_METHODS, type AgentOutput, type DomainEvent } from '@overdeck/contracts'
import { useDashboardStore } from '../lib/store'
import { getTransport, type PanRpcProtocolClient } from '../lib/wsTransport'

interface SharedAgentOutputSubscription {
  references: number
  unsubscribe: () => void
}

const subscriptions = new Map<string, SharedAgentOutputSubscription>()

function applyOutput(output: AgentOutput): void {
  const state = useDashboardStore.getState()
  state.applyEvent({
    type: 'agent.output_received',
    sequence: state.sequence,
    timestamp: new Date().toISOString(),
    payload: { agentId: output.agentId, lines: [output.line] },
  } as DomainEvent)
}

/** Share one RPC stream per agent across every mounted output surface. */
export function retainAgentOutputSubscription(agentId: string): () => void {
  const existing = subscriptions.get(agentId)
  if (existing) {
    existing.references += 1
  } else {
    subscriptions.set(agentId, {
      references: 1,
      unsubscribe: getTransport().subscribe(
        (client) => (client as PanRpcProtocolClient)[WS_METHODS.subscribeAgentOutput]({ agentId }) as unknown as Stream.Stream<AgentOutput, Error, never>,
        applyOutput,
      ),
    })
  }

  let released = false
  return () => {
    if (released) return
    released = true
    const active = subscriptions.get(agentId)
    if (!active) return
    active.references -= 1
    if (active.references > 0) return
    subscriptions.delete(agentId)
    active.unsubscribe()
  }
}

export function useAgentOutputSubscription(agentId: string, enabled = true): void {
  useEffect(() => {
    if (!enabled) return undefined
    return retainAgentOutputSubscription(agentId)
  }, [agentId, enabled])
}

export function resetAgentOutputSubscriptionsForTests(): void {
  for (const subscription of subscriptions.values()) subscription.unsubscribe()
  subscriptions.clear()
}
