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
 *
 * A peer dashboard (PAN-3931) shares the primary's event log, and the primary
 * runs this same poller. The peer fans its events out to its own subscribers
 * with `emitOnly`, so its UI stays live, and appends nothing durable and
 * announces nothing: the primary's log and activity feed get each fact once.
 */

import { Effect } from 'effect'
import { listRunningAgents, type AgentState } from '../../../lib/agents.js'
import { computeAgentEnrichment, getAgentJsonlMtime, type AgentEnrichment, type PendingInputsScan } from '../../../lib/agent-enrichment.js'
import { getBackendPanes } from './backend-inventory.js'
import { withConcurrencyLimitPromise } from '../../../lib/concurrency.js'
import { getRuntimeCensus, type RuntimeCensus } from '../../../lib/runtime-census.js'
import { getEventStore, type EventStore } from '../event-store.js'
import { saveAgentStateAndEmitEvent } from './agent-projection.js'
import { emitActivityEntry, emitActivityTts } from '../../../lib/activity-logger.js'
import type { AgentEnrichmentChangedEvent, AgentCreatedEvent } from '@overdeck/contracts'
import { toAgentStatus, toRole, toAgentResolution } from '../read-model.js'
import { isPeerDashboardProcess } from '../../../lib/boot-gates.js'

// ─── Types ────────────────────────────────────────────────────────────────────

type RunningAgent = AgentState & { tmuxActive: boolean }

interface EnrichmentServiceState {
  timer: ReturnType<typeof setInterval> | null
  lastEnrichment: Map<string, AgentEnrichment>
  /**
   * Last JSONL scan per agent, keyed by the mtime it was taken at. While the
   * mtime is unchanged the file's contents are unchanged, so the scan is
   * replayed instead of re-read. Caching the scan (rather than passing a
   * "skip the scan" flag) is what keeps a static session cheap without ever
   * asserting "nothing is pending" from a scan that never ran.
   */
  lastScan: Map<string, { mtime: number; scan: PendingInputsScan }>
  /** Agent IDs for which we've already emitted agent.created this server lifetime */
  seenAgentIds: Set<string>
  /** Peer dashboard (PAN-3931): emit to live subscribers only, never append or announce. */
  peer: boolean
}

/** Append an enrichment event, or in a peer dashboard fan it out in memory only. */
async function publishEnrichmentEvent(
  state: Pick<EnrichmentServiceState, 'peer'>,
  eventStore: Pick<EventStore, 'appendAsync' | 'emitOnly'>,
  event: Parameters<EventStore['emitOnly']>[0],
): Promise<void> {
  if (state.peer) {
    eventStore.emitOnly(event)
    return
  }
  await eventStore.appendAsync(event)
}

// ─── Diff helpers ─────────────────────────────────────────────────────────────

function enrichmentChanged(prev: AgentEnrichment | undefined, next: AgentEnrichment): boolean {
  if (!prev) return true
  return (
    prev.role !== next.role ||
    prev.hasPendingQuestion !== next.hasPendingQuestion ||
    prev.pendingQuestionCount !== next.pendingQuestionCount ||
    prev.pendingQuestionPrompt !== next.pendingQuestionPrompt ||
    prev.pendingQuestionReason !== next.pendingQuestionReason ||
    prev.pendingInputCount !== next.pendingInputCount ||
    prev.pendingInputKinds.join(',') !== next.pendingInputKinds.join(',') ||
    prev.pendingAskUserQuestion?.toolUseId !== next.pendingAskUserQuestion?.toolUseId ||
    prev.pendingProposedPlan?.toolUseId !== next.pendingProposedPlan?.toolUseId ||
    prev.resolution !== next.resolution ||
    prev.resolutionCount !== next.resolutionCount
  )
}

// PAN-1834 — detect the first moment an agent becomes blocked on input and
// build human-readable activity / TTS messages.
export function isAwaitingInputRisingEdge(
  previous: AgentEnrichment | undefined,
  current: AgentEnrichment,
): boolean {
  const previousCount = previous?.pendingInputCount ?? 0
  return previousCount === 0 && current.pendingInputCount > 0
}

// PAN-2633 — force re-emission for idle-alive waiting agents. A stop-shaped
// status_changed event can wipe the read model's pending payload, and the
// private lastEnrichment cache cannot see that wipe. While the agent's tmux
// session is still alive and a pending payload exists, bypass the dedup so the
// read model converges within one ~10s poll. previousEnrichment stays intact,
// so the PAN-1834 awaiting-input rising edge (activity + TTS) does not re-fire.
export function shouldForceReemitPendingInput(
  agentStatus: string,
  enrichment: AgentEnrichment,
): boolean {
  if (agentStatus === 'running' || agentStatus === 'starting') return false
  return (
    enrichment.pendingInputCount > 0 ||
    enrichment.pendingAskUserQuestion != null ||
    enrichment.pendingProposedPlan != null
  )
}

export function buildAwaitingInputActivityMessage(
  agentId: string,
  issueId: string | undefined,
  kinds: readonly string[],
): string {
  const kindList = kinds.length > 0 ? kinds.join(', ') : 'input'
  return issueId
    ? `${agentId} on ${issueId} is waiting for ${kindList}`
    : `${agentId} is waiting for ${kindList}`
}

// PAN-3055 — no census evidence means no liveness claims: without it the
// backend inventory's tmux fallback cannot tell a live pane from a dead one,
// and the poller would resurrect dead questions with TTS.
export function shouldSkipEnrichmentCycle(census: Pick<RuntimeCensus, 'tmuxAvailable'>): boolean {
  return !census.tmuxAvailable
}

export function hasReapablePendingInput(enrichment: AgentEnrichment): boolean {
  return (
    enrichment.pendingInputCount > 0 ||
    enrichment.pendingAskUserQuestion != null ||
    enrichment.pendingProposedPlan != null
  )
}

export function buildPendingReapEvent(
  agentId: string,
  previous: AgentEnrichment,
  issueId?: string,
): Omit<AgentEnrichmentChangedEvent, 'sequence'> {
  return {
    type: 'agent.enrichment_changed',
    timestamp: new Date().toISOString(),
    payload: {
      agentId,
      issueId,
      role: previous.role,
      hasPendingQuestion: false,
      pendingQuestionCount: 0,
      pendingQuestionPrompt: undefined,
      pendingQuestionReason: undefined,
      pendingInputCount: 0,
      pendingInputKinds: [],
      pendingAskUserQuestion: undefined,
      pendingProposedPlan: undefined,
      resolution: previous.resolution as AgentEnrichmentChangedEvent['payload']['resolution'],
      resolutionCount: previous.resolutionCount,
    },
  }
}

export function buildExpiredQuestionActivityMessage(agentId: string, issueId: string | undefined): string {
  const subject = issueId ? `${agentId} on ${issueId}` : agentId
  return `${subject} stopped with its question unanswered — the question has expired and is no longer actionable`
}

// ─── Poller ───────────────────────────────────────────────────────────────────

async function pollOnce(state: EnrichmentServiceState): Promise<void> {
  let census: RuntimeCensus
  try {
    census = await getRuntimeCensus()
  } catch {
    return
  }
  if (shouldSkipEnrichmentCycle(census)) return

  let runningAgents: RunningAgent[]
  try {
    runningAgents = await Effect.runPromise(listRunningAgents())
  } catch {
    return
  }

  const eventStore = getEventStore()

  // PAN-3917 (FR-12): the terminal backend answers liveness, not a persisted
  // mirror. `listRunningAgents` still supplies the permanent facts (workspace,
  // role, model, branch) the enrichment event payload carries.
  const panes = await getBackendPanes()
  const livePaneIds = new Set(
    panes.filter((pane) => pane.state !== 'exited').map((pane) => pane.terminalId ?? pane.id),
  )
  const specialistIssues = new Set(
    panes
      .filter((pane) => pane.state !== 'exited' && (pane.role === 'review' || pane.role === 'test' || pane.role === 'uat'))
      .map((pane) => pane.issue)
      .filter((issue): issue is string => Boolean(issue)),
  )

  // Only enrich agents the backend reports as live. A pane that exited has no
  // changing state — its enrichment is static.
  const activeAgents = runningAgents.filter(a => livePaneIds.has(a.id))

  await withConcurrencyLimitPromise(
    activeAgents.map((agent) => async () => {
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
                runtime: undefined,
                model: agent.model || undefined,
                status: toAgentStatus('running'),
                startedAt: agent.startedAt || undefined,
                lastActivity: agent.lastActivity || undefined,
                branch: agent.branch || undefined,
                costSoFar: agent.costSoFar,
                sessionId: agent.sessionId || undefined,
                role: toRole(agent.role) ?? 'work',
                hasLiveTmuxSession: true,
                hasPendingQuestion: undefined,
                pendingQuestionCount: undefined,
                pendingQuestionPrompt: undefined,
                pendingQuestionReason: undefined,
                resolution: toAgentResolution((agent as { resolution?: unknown }).resolution),
                resolutionCount: undefined,
              },
            },
          }
          if (state.peer) eventStore.emitOnly(createdEvent as never)
          else saveAgentStateAndEmitEvent(agent, createdEvent)
        } catch {
          // Non-fatal — event store may not be ready at startup
        }
      }

      // An active specialist is a live review, test, or uat pane in this
      // issue's workspace — the backend's answer, not a stored status row.
      const hasActiveSpecialist = issueId ? specialistIssues.has(issueId) : false

      // Replay the previous JSONL scan while the file's mtime is unchanged
      // (avoids I/O on static sessions).
      const currentMtime = await getAgentJsonlMtime(agentId)
      const previousEnrichment = state.lastEnrichment.get(agentId)
      const previousScan = state.lastScan.get(agentId)
      const cachedScan =
        currentMtime !== null && previousScan?.mtime === currentMtime ? previousScan.scan : null

      let enrichment: AgentEnrichment
      try {
        // computeAgentEnrichment is a plain async function (PAN-3958 CH-3). It
        // used to return an Effect, and awaiting that non-thenable value yielded
        // the Effect object, so every enrichment field came back undefined
        // (PAN-1395).
        enrichment = await computeAgentEnrichment(agentId, startedAt, hasActiveSpecialist, cachedScan)
      } catch {
        return
      }

      if (currentMtime !== null && enrichment.jsonlScan) {
        state.lastScan.set(agentId, { mtime: currentMtime, scan: enrichment.jsonlScan })
      } else if (currentMtime === null) {
        state.lastScan.delete(agentId)
      }

      // PAN-1834 — on the rising edge of an agent becoming blocked on input,
      // emit an activity entry + TTS so the operator is notified loudly.
      if (!state.peer && isAwaitingInputRisingEdge(previousEnrichment, enrichment)) {
        const message = buildAwaitingInputActivityMessage(agentId, issueId, enrichment.pendingInputKinds)
        const source = toRole(agent.role) ?? 'work'
        emitActivityEntry({ source, level: 'warn', message, issueId })
        emitActivityTts({ utterance: message, priority: 1, issueId, source, eventType: 'awaiting_input' })
      }

      // PAN-2633 — a stop-shaped status_changed event may have wiped the read
      // model's pending payload while the tmux session is still alive. Bypass
      // the dedup for idle-alive waiting agents so the read model converges
      // within one poll; keep lastEnrichment intact so the rising-edge above
      // does not re-fire every poll.
      if (!enrichmentChanged(previousEnrichment, enrichment) && !shouldForceReemitPendingInput(agent.status, enrichment)) {
        return
      }

      state.lastEnrichment.set(agentId, enrichment)

      // Emit event — event store assigns the sequence number
      const event: Omit<AgentEnrichmentChangedEvent, 'sequence'> = {
        type: 'agent.enrichment_changed',
        timestamp: new Date().toISOString(),
        payload: {
          agentId,
          issueId,
          role: toRole(agent.role) ?? 'work',
          hasPendingQuestion: enrichment.hasPendingQuestion,
          pendingQuestionCount: enrichment.pendingQuestionCount,
          pendingQuestionPrompt: enrichment.pendingQuestionPrompt,
          pendingQuestionReason: enrichment.pendingQuestionReason,
          pendingInputCount: enrichment.pendingInputCount,
          pendingInputKinds: enrichment.pendingInputKinds,
          pendingAskUserQuestion: enrichment.pendingAskUserQuestion,
          pendingProposedPlan: enrichment.pendingProposedPlan,
          resolution: enrichment.resolution as AgentEnrichmentChangedEvent['payload']['resolution'],
          resolutionCount: enrichment.resolutionCount,
        },
      }

      try {
        await publishEnrichmentEvent(state, eventStore, event as never)
      } catch {
        // Non-fatal — event store may not be initialized yet at startup
      }
    }),
    4,
  )

  // Clean up stale entries for agents that have stopped
  const activeIds = new Set(activeAgents.map(a => a.id))
  for (const [id, previousEnrichment] of state.lastEnrichment) {
    if (!activeIds.has(id)) {
      if (hasReapablePendingInput(previousEnrichment)) {
        const agentRecord = runningAgents.find(agent => agent.id === id)
        const reapIssueId = agentRecord?.issueId
        try {
          await publishEnrichmentEvent(state, eventStore, buildPendingReapEvent(id, previousEnrichment, reapIssueId) as never)
        } catch {
          // Non-fatal — event store may not be initialized yet at startup
        }

        const issueId = reapIssueId
        if (!state.peer) {
          emitActivityEntry({
            source: toRole(agentRecord?.role) ?? 'work',
            level: 'info',
            message: buildExpiredQuestionActivityMessage(id, issueId),
            issueId,
          })
        }
      }

      state.lastEnrichment.delete(id)
      state.lastScan.delete(id)
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
  lastScan: new Map(),
  seenAgentIds: new Set(),
  peer: false,
}

export function startAgentEnrichmentService(): void {
  if (serviceState.timer !== null) return // Already running
  serviceState.peer = isPeerDashboardProcess()

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
  serviceState.lastScan.clear()
}
