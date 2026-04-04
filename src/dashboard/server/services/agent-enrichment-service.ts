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

import { listRunningAgents } from '../../../lib/agents.js'
import { computeAgentEnrichment, getAgentJsonlMtime, type AgentEnrichment } from '../../../lib/agent-enrichment.js'
import { getReviewStatus } from '../../../lib/review-status.js'
import { getEventStore } from '../event-store.js'
import type { AgentEnrichmentChangedEvent } from '@panopticon/contracts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnrichmentServiceState {
  timer: ReturnType<typeof setInterval> | null
  lastEnrichment: Map<string, AgentEnrichment>
  /** Last known JSONL file mtime per agent — skip re-scan if unchanged */
  lastMtime: Map<string, number | null>
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
  let runningAgents: ReturnType<typeof listRunningAgents>
  try {
    runningAgents = listRunningAgents()
  } catch {
    return
  }

  const eventStore = getEventStore()

  await Promise.all(
    runningAgents.map(async (agent) => {
      const { id: agentId, issueId, startedAt } = agent

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
        eventStore.append(event as never)
      } catch {
        // Non-fatal — event store may not be initialized yet at startup
      }
    }),
  )

  // Clean up stale entries for agents that have stopped
  const activeIds = new Set(runningAgents.map(a => a.id))
  for (const id of state.lastEnrichment.keys()) {
    if (!activeIds.has(id)) {
      state.lastEnrichment.delete(id)
      state.lastMtime.delete(id)
    }
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3_000

const serviceState: EnrichmentServiceState = {
  timer: null,
  lastEnrichment: new Map(),
  lastMtime: new Map(),
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
