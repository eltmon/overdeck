/**
 * Agent Output Service (PAN-1221 F3)
 *
 * Captures pane output only for agents with an active output subscriber. Panes
 * come from the selected terminal backend's live inventory (Herdr or tmux,
 * #4109); an agent the inventory does not list falls back to a tmux capture.
 * Explicit agent subscriptions and the public all-output SSE feed share one
 * reference-counted poller, so zero interest means zero pane captures.
 */

import { capturePane } from '../../../lib/tmux.js'
import {
  captureLiveAgentPaneText,
  listLiveAgentPanes,
  type LiveAgentPane,
} from '../../../lib/terminal-backends/inventory.js'
import { withConcurrencyLimit } from '../../../lib/concurrency.js'
import { getEventStore } from '../event-store.js'
import type { AgentOutputReceivedEvent } from '@overdeck/contracts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface AgentOutputServiceState {
  timer: ReturnType<typeof setInterval> | null
  lastOutput: Map<string, string>
  interestCounts: Map<string, number>
  allInterestCount: number
  inFlight: Set<string>
  polling: boolean
  started: boolean
}

export function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

/**
 * Find new lines by looking for the longest suffix of `previous` that matches
 * a prefix of `current`. The non-overlapping prefix of `current` is returned.
 * If there is no overlap, all of `current` is new (pane was cleared or scrolled
 * past the overlap window).
 */
export function diffLines(previous: string[], current: string[]): string[] {
  if (previous.length === 0) return current

  for (let start = 0; start < previous.length; start++) {
    const suffix = previous.slice(start)
    if (suffix.length > current.length) continue
    if (suffix.every((line, i) => line === current[i])) {
      return current.slice(suffix.length)
    }
  }

  return current
}

function hasAgentInterest(state: AgentOutputServiceState, agentId: string): boolean {
  return state.allInterestCount > 0 || (state.interestCounts.get(agentId) ?? 0) > 0
}

async function captureAgentPane(agentId: string, pane: LiveAgentPane | undefined): Promise<string> {
  if (pane) return (await captureLiveAgentPaneText(pane, 50)) ?? ''
  return capturePane(agentId, 50)
}

async function captureInterestedAgent(
  state: AgentOutputServiceState,
  agentId: string,
  pane?: LiveAgentPane,
): Promise<void> {
  if (!hasAgentInterest(state, agentId) || state.inFlight.has(agentId)) return
  state.inFlight.add(agentId)

  try {
    let stdout: string
    try {
      const remoteStateFile = join(homedir(), '.overdeck', 'agents', agentId, 'remote-state.json')
      const remoteState = await readFile(remoteStateFile, 'utf-8')
        .then((text) => JSON.parse(text) as { location?: string; vmName?: string })
        .catch(() => null)

      if (remoteState?.location === 'remote' && remoteState?.vmName) {
        const { getRemoteAgentOutput } = await import('../../../lib/remote/remote-agents.js')
        stdout = await getRemoteAgentOutput(agentId, remoteState.vmName, 50)
      } else {
        stdout = await captureAgentPane(agentId, pane)
      }
    } catch {
      stdout = await captureAgentPane(agentId, pane).catch(() => '')
    }

    if (!hasAgentInterest(state, agentId)) return
    if (!stdout || stdout.trim() === '' || stdout.trim() === 'Session not found') return

    const previousOutput = state.lastOutput.get(agentId) ?? ''
    if (stdout === previousOutput) return

    const newLines = diffLines(splitLines(previousOutput), splitLines(stdout))
    state.lastOutput.set(agentId, stdout)
    if (newLines.length === 0) return

    const event: Omit<AgentOutputReceivedEvent, 'sequence'> = {
      type: 'agent.output_received',
      timestamp: new Date().toISOString(),
      payload: { agentId, lines: newLines },
    }

    // Terminal output is reconstructable from tmux, so it stays in memory and
    // never enters the persistent event table.
    getEventStore().emitOnly(event as never)
  } finally {
    state.inFlight.delete(agentId)
  }
}

export async function pollOnce(state: AgentOutputServiceState): Promise<void> {
  if (state.polling) return
  state.polling = true
  try {
    const interestedIds = new Set(state.interestCounts.keys())
    if (interestedIds.size === 0 && state.allInterestCount === 0) return

    // Fleet discovery reads the selected backend's live inventory (#4109), not
    // the tmux-only tmuxActive flag, which is false for every Herdr agent. An
    // unreadable inventory (null) discovers nothing; explicit subscriptions
    // still capture.
    const panes = await listLiveAgentPanes().catch(() => null)
    const paneById = new Map((panes ?? []).map((pane) => [pane.agentId, pane]))
    if (state.allInterestCount > 0) {
      for (const agentId of paneById.keys()) interestedIds.add(agentId)
    }

    if (interestedIds.size === 0) return
    await withConcurrencyLimit(
      [...interestedIds].map((agentId) => () => captureInterestedAgent(state, agentId, paneById.get(agentId))),
      4,
    )
  } finally {
    state.polling = false
  }
}

const POLL_INTERVAL_MS = 3_000

const serviceState: AgentOutputServiceState = {
  timer: null,
  lastOutput: new Map(),
  interestCounts: new Map(),
  allInterestCount: 0,
  inFlight: new Set(),
  polling: false,
  started: false,
}

function hasAnyInterest(state: AgentOutputServiceState): boolean {
  return state.allInterestCount > 0 || state.interestCounts.size > 0
}

function ensurePolling(): void {
  if (!serviceState.started || serviceState.timer !== null || !hasAnyInterest(serviceState)) return
  serviceState.timer = setInterval(() => {
    void pollOnce(serviceState).catch(() => undefined)
  }, POLL_INTERVAL_MS)
}

function stopPollingIfIdle(): void {
  if (hasAnyInterest(serviceState) || serviceState.timer === null) return
  clearInterval(serviceState.timer)
  serviceState.timer = null
}

export function retainAgentOutputInterest(agentId: string): () => void {
  const previousCount = serviceState.interestCounts.get(agentId) ?? 0
  serviceState.interestCounts.set(agentId, previousCount + 1)
  ensurePolling()
  if (serviceState.started && previousCount === 0) {
    void listLiveAgentPanes()
      .catch(() => null)
      .then((panes) => captureInterestedAgent(serviceState, agentId, panes?.find((pane) => pane.agentId === agentId)))
      .catch(() => undefined)
  }

  let released = false
  return () => {
    if (released) return
    released = true
    const count = serviceState.interestCounts.get(agentId) ?? 0
    if (count <= 1) serviceState.interestCounts.delete(agentId)
    else serviceState.interestCounts.set(agentId, count - 1)
    stopPollingIfIdle()
  }
}

/** Preserve the public SSE feed's existing all-agent output surface on demand. */
export function retainAllAgentOutputInterest(): () => void {
  serviceState.allInterestCount += 1
  ensurePolling()
  if (serviceState.started && serviceState.allInterestCount === 1) {
    void pollOnce(serviceState).catch(() => undefined)
  }

  let released = false
  return () => {
    if (released) return
    released = true
    serviceState.allInterestCount = Math.max(0, serviceState.allInterestCount - 1)
    stopPollingIfIdle()
  }
}

export function startAgentOutputService(): void {
  if (serviceState.started) return
  serviceState.started = true
  ensurePolling()
  if (hasAnyInterest(serviceState)) void pollOnce(serviceState).catch(() => undefined)
}

export function stopAgentOutputService(): void {
  serviceState.started = false
  if (serviceState.timer !== null) clearInterval(serviceState.timer)
  serviceState.timer = null
  serviceState.lastOutput.clear()
  serviceState.interestCounts.clear()
  serviceState.allInterestCount = 0
  serviceState.inFlight.clear()
  serviceState.polling = false
}
