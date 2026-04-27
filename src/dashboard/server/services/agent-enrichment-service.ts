/**
 * Agent Enrichment Service (PAN-440)
 *
 * Background poller that computes enrichment fields for each running agent
 * every ~3 seconds and emits `agent.enrichment_changed` domain events when
 * the enrichment state changes.
 *
 * Enrichment fields: agentPhase, hasPendingQuestion, pendingQuestionCount,
 * resolution, resolutionCount.
 *
 * These fields were dropped in the Effect server migration (PAN-428) and are
 * restored here via the event-driven projection pipeline.
 */

import { listRunningAgentsAsync } from '../../../lib/agents.js'
import { computeAgentEnrichment, getAgentJsonlMtime, type AgentEnrichment } from '../../../lib/agent-enrichment.js'
import { getReviewStatus } from '../../../lib/review-status.js'
import { getEventStore } from '../event-store.js'
import type { AgentEnrichmentChangedEvent, AgentCreatedEvent, AgentStatusChangedEvent } from '@panctl/contracts'
import { toAgentStatus, toAgentPhase, toAgentResolution } from '../read-model.js'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnrichmentServiceState {
  timer: ReturnType<typeof setInterval> | null
  lastEnrichment: Map<string, AgentEnrichment>
  /** Last known JSONL file mtime per agent — skip re-scan if unchanged */
  lastMtime: Map<string, number | null>
  /** Agent IDs for which we've already emitted agent.created this server lifetime */
  seenAgentIds: Set<string>
  /** Agent IDs for which we've already emitted a status reconciliation event */
  reconciledAgentIds: Set<string>
}

// ─── Diff helpers ─────────────────────────────────────────────────────────────

function enrichmentChanged(prev: AgentEnrichment | undefined, next: AgentEnrichment): boolean {
  if (!prev) return true
  return (
    prev.agentPhase !== next.agentPhase ||
    prev.hasPendingQuestion !== next.hasPendingQuestion ||
    prev.pendingQuestionCount !== next.pendingQuestionCount ||
    prev.resolution !== next.resolution ||
    prev.resolutionCount !== next.resolutionCount
  )
}

// ─── Poller ───────────────────────────────────────────────────────────────────

async function pollOnce(state: EnrichmentServiceState): Promise<void> {
  let runningAgents: Awaited<ReturnType<typeof listRunningAgentsAsync>>
  try {
    runningAgents = await listRunningAgentsAsync()
  } catch {
    return
  }

  const eventStore = getEventStore()

  // Only enrich agents that actually have a live tmux session.
  // Stopped agents have no changing state — their enrichment is static.
  const activeAgents = runningAgents.filter(a => a.tmuxActive)

  await Promise.all(
    activeAgents.map(async (agent) => {
      const { id: agentId, issueId, startedAt } = agent

      // If this agent hasn't been seen since server start, emit agent.created so the
      // read model adds it to agentsById (handles agents started after last cache save).
      if (!state.seenAgentIds.has(agentId)) {
        state.seenAgentIds.add(agentId)
        try {
          const createdEvent: Omit<AgentCreatedEvent, 'sequence'> = {
            type: 'agent.created',
            timestamp: new Date().toISOString(),
            payload: {
              agentId,
              issueId: issueId ?? agentId,
              agent: {
                id: agentId,
                issueId: issueId ?? agentId,
                workspace: agent.workspace || undefined,
                runtime: agent.runtime || undefined,
                model: agent.model || undefined,
                status: toAgentStatus(agent.tmuxActive && agent.status === 'stopped' ? 'running' : agent.status),
                startedAt: agent.startedAt || undefined,
                lastActivity: agent.lastActivity || undefined,
                branch: agent.branch || undefined,
                costSoFar: agent.costSoFar,
                sessionId: agent.sessionId || undefined,
                phase: toAgentPhase(agent.phase),
                agentPhase: undefined,
                hasPendingQuestion: undefined,
                pendingQuestionCount: undefined,
                resolution: toAgentResolution(agent.resolution),
                resolutionCount: undefined,
              },
            },
          }
          await eventStore.appendAsync(createdEvent as never)
        } catch {
          // Non-fatal — event store may not be ready at startup
        }
      }

      // Reconcile stale status: if tmux is active but state.json says stopped,
      // emit a status_changed event so the read model corrects to 'running'.
      if (agent.tmuxActive && agent.status === 'stopped' && !state.reconciledAgentIds.has(agentId)) {
        state.reconciledAgentIds.add(agentId)
        try {
          const statusEvent: Omit<AgentStatusChangedEvent, 'sequence'> = {
            type: 'agent.status_changed',
            timestamp: new Date().toISOString(),
            payload: {
              agentId,
              status: 'running',
              previousStatus: 'stopped',
            },
          }
          await eventStore.appendAsync(statusEvent as never)
        } catch {
          // Non-fatal
        }
      }

      // Determine if the agent's issue has an active specialist
      let hasActiveSpecialist = false
      if (issueId) {
        const reviewStatus = getReviewStatus(issueId)
        hasActiveSpecialist =
          reviewStatus?.reviewStatus === 'reviewing' ||
          reviewStatus?.testStatus === 'testing' ||
          reviewStatus?.mergeStatus === 'merging'
      }

      // Skip JSONL scan if file mtime is unchanged (avoids I/O on static sessions)
      const currentMtime = await getAgentJsonlMtime(agentId)
      const prevMtime = state.lastMtime.get(agentId)
      const jsonlUnchanged = prevMtime !== undefined && currentMtime === prevMtime
      state.lastMtime.set(agentId, currentMtime)

      let enrichment: AgentEnrichment
      try {
        // If JSONL hasn't changed, only re-check runtime state (resolution/phase)
        // by passing a flag that skips the expensive JSONL scan.
        enrichment = await computeAgentEnrichment(agentId, startedAt, hasActiveSpecialist, jsonlUnchanged)
      } catch {
        return
      }

      if (!enrichmentChanged(state.lastEnrichment.get(agentId), enrichment)) {
        return
      }

      state.lastEnrichment.set(agentId, enrichment)

      // Emit event — event store assigns the sequence number
      const event: Omit<AgentEnrichmentChangedEvent, 'sequence'> = {
        type: 'agent.enrichment_changed',
        timestamp: new Date().toISOString(),
        payload: {
          agentId,
          agentPhase: enrichment.agentPhase,
          hasPendingQuestion: enrichment.hasPendingQuestion,
          pendingQuestionCount: enrichment.pendingQuestionCount,
          resolution: enrichment.resolution as AgentEnrichmentChangedEvent['payload']['resolution'],
          resolutionCount: enrichment.resolutionCount,
        },
      }

      try {
        await eventStore.appendAsync(event as never)
      } catch {
        // Non-fatal — event store may not be initialized yet at startup
      }
    }),
  )

  // Clean up stale entries for agents that have stopped
  const activeIds = new Set(activeAgents.map(a => a.id))
  for (const id of state.lastEnrichment.keys()) {
    if (!activeIds.has(id)) {
      state.lastEnrichment.delete(id)
      state.lastMtime.delete(id)
    }
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/** Poll interval: 10 seconds (was 3s). The enrichment data changes slowly —
 *  pending questions, resolution state, phase — none of these need sub-second
 *  latency. 10s eliminates ~70% of poller I/O without any user-visible lag. */
const POLL_INTERVAL_MS = 10_000

const serviceState: EnrichmentServiceState = {
  timer: null,
  lastEnrichment: new Map(),
  lastMtime: new Map(),
  seenAgentIds: new Set(),
  reconciledAgentIds: new Set(),
}

export function startAgentEnrichmentService(): void {
  if (serviceState.timer !== null) return // Already running

  serviceState.timer = setInterval(() => {
    pollOnce(serviceState).catch(() => {
      // Swallow errors — poller must not crash the server
    })
  }, POLL_INTERVAL_MS)
}

export function stopAgentEnrichmentService(): void {
  if (serviceState.timer !== null) {
    clearInterval(serviceState.timer)
    serviceState.timer = null
  }
  serviceState.lastEnrichment.clear()
  serviceState.lastMtime.clear()
}
