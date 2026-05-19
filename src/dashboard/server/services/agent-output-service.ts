/**
 * Agent Output Service (PAN-1221 F3)
 *
 * Background poller that captures tmux pane output for each running agent
 * every ~3 seconds and emits `agent.output_received` domain events when
 * new lines appear.
 *
 * This restores the event-driven output pipeline that DrawerActiveAgent
 * expects — the reducer and WebSocket subscription already exist, but no
 * server code was emitting the events.
 */

import { listRunningAgentsAsync } from '../../../lib/agents.js'
import { capturePaneAsync } from '../../../lib/tmux.js'
import { withConcurrencyLimit } from '../../../lib/concurrency.js'
import { getEventStore } from '../event-store.js'
import type { AgentOutputReceivedEvent } from '@panctl/contracts'
import { readFile } from 'node:fs/promises'
import { join, homedir } from 'node:path'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentOutputServiceState {
  timer: ReturnType<typeof setInterval> | null
  /** Last captured pane output per agent ID */
  lastOutput: Map<string, string>
}

// ─── Diff helpers ─────────────────────────────────────────────────────────────

export function splitLines(text: string): string[] {
  return text.split('\n')
}

/**
 * Find new lines by looking for the longest suffix of `previous` that matches
 * a prefix of `current`. The non-overlapping prefix of `current` is returned.
 * If there is no overlap, all of `current` is new (pane was cleared or scrolled
 * past the overlap window).
 */
export function diffLines(previous: string[], current: string[]): string[] {
  if (previous.length === 0) return current

  // Try progressively shorter suffixes of previous
  for (let start = 0; start < previous.length; start++) {
    const suffix = previous.slice(start)
    if (suffix.length > current.length) continue

    const isMatch = suffix.every((line, i) => line === current[i])
    if (isMatch) {
      return current.slice(suffix.length)
    }
  }

  // No overlap found — pane was cleared or scrolled too far
  return current
}

// ─── Poller ───────────────────────────────────────────────────────────────────

export async function pollOnce(state: AgentOutputServiceState): Promise<void> {
  let runningAgents: Awaited<ReturnType<typeof listRunningAgentsAsync>>
  try {
    runningAgents = await listRunningAgentsAsync()
  } catch {
    return
  }

  const eventStore = getEventStore()
  const activeAgents = runningAgents.filter((a) => a.tmuxActive)

  await withConcurrencyLimit(
    activeAgents.map((agent) => async () => {
      const { id: agentId } = agent

      // Check for remote agent
      let stdout: string
      try {
        const remoteStateFile = join(homedir(), '.panopticon', 'agents', agentId, 'remote-state.json')
        const remoteState = await readFile(remoteStateFile, 'utf-8')
          .then((text) => JSON.parse(text) as { location?: string; vmName?: string })
          .catch(() => null)

        if (remoteState?.location === 'remote' && remoteState?.vmName) {
          const { getRemoteAgentOutput } = await import('../../../lib/remote/remote-agents.js')
          stdout = await getRemoteAgentOutput(agentId, remoteState.vmName, 50)
        } else {
          stdout = await capturePaneAsync(agentId, 50)
        }
      } catch {
        stdout = await capturePaneAsync(agentId, 50).catch(() => '')
      }

      if (!stdout || stdout.trim() === '' || stdout.trim() === 'Session not found') {
        return
      }

      const previousOutput = state.lastOutput.get(agentId) ?? ''
      if (stdout === previousOutput) {
        return
      }

      const previousLines = splitLines(previousOutput)
      const currentLines = splitLines(stdout)
      const newLines = diffLines(previousLines, currentLines)

      state.lastOutput.set(agentId, stdout)

      if (newLines.length === 0) {
        return
      }

      const event: Omit<AgentOutputReceivedEvent, 'sequence'> = {
        type: 'agent.output_received',
        timestamp: new Date().toISOString(),
        payload: {
          agentId,
          lines: newLines,
        },
      }

      try {
        await eventStore.appendAsync(event as never)
      } catch {
        // Non-fatal — event store may not be initialized yet at startup
      }
    }),
    4,
  )

  // Clean up stale entries for agents that have stopped
  const activeIds = new Set(activeAgents.map((a) => a.id))
  for (const id of state.lastOutput.keys()) {
    if (!activeIds.has(id)) {
      state.lastOutput.delete(id)
    }
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

/** Poll interval: 3 seconds. Output is high-frequency and latency-sensitive. */
const POLL_INTERVAL_MS = 3_000

const serviceState: AgentOutputServiceState = {
  timer: null,
  lastOutput: new Map(),
}

export function startAgentOutputService(): void {
  if (serviceState.timer !== null) return // Already running

  serviceState.timer = setInterval(() => {
    pollOnce(serviceState).catch(() => {
      // Swallow errors — poller must not crash the server
    })
  }, POLL_INTERVAL_MS)
}

export function stopAgentOutputService(): void {
  if (serviceState.timer !== null) {
    clearInterval(serviceState.timer)
    serviceState.timer = null
  }
  serviceState.lastOutput.clear()
}
