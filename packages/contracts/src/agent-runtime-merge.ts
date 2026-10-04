/**
 * Runtime-map helpers shared by the reducers (PAN-4522).
 */
import type { AgentRuntimeSnapshot } from './types'

export function defaultRuntimeSnapshot(agentId: string, timestamp: string, sequence: number): AgentRuntimeSnapshot {
  return { id: agentId, activity: 'idle', lastActivity: timestamp, updatedAtSequence: sequence }
}

/**
 * Merge a snapshot's runtime map into the client's, per agent. A freshly booted
 * server may serve an older or missing entry; a client entry with a strictly
 * newer `lastActivity` (or an equal stamp with a higher `updatedAtSequence`)
 * survives, and an agent the snapshot omits keeps its entry.
 */
export function mergeSnapshotRuntimeById(
  current: Readonly<Record<string, AgentRuntimeSnapshot>>,
  incoming: Readonly<Record<string, AgentRuntimeSnapshot>> | undefined,
): Record<string, AgentRuntimeSnapshot> {
  if (!incoming) return { ...current }
  const merged: Record<string, AgentRuntimeSnapshot> = { ...current }
  for (const [agentId, next] of Object.entries(incoming)) {
    const held = current[agentId]
    merged[agentId] = held && heldIsNewer(held, next) ? held : next
  }
  return merged
}

/** Newer `lastActivity` wins; equal stamps fall to the higher `updatedAtSequence`. */
function heldIsNewer(held: AgentRuntimeSnapshot, next: AgentRuntimeSnapshot): boolean {
  const heldAt = Date.parse(held.lastActivity)
  const nextAt = Date.parse(next.lastActivity)
  if (heldAt > nextAt) return true
  if (heldAt !== nextAt) return false
  return Number.isFinite(held.updatedAtSequence) && Number.isFinite(next.updatedAtSequence)
    && held.updatedAtSequence > next.updatedAtSequence
}
