/**
 * PAN-800 — in-process mirror of AgentStateService's canonical ref.
 *
 * The dashboard server writes into this mirror on every event fold so lib code
 * running in the same process can read the latest AgentRuntimeSnapshot
 * synchronously. CLI/out-of-process callers should prefer the async HTTP path
 * in agent-runtime.ts.
 *
 * This module intentionally has zero server-side imports so both the CLI
 * and the dashboard can pull it in without dragging in SQLite / Effect
 * layer code.
 */

import type { AgentRuntimeSnapshot } from '@panopticon/contracts';

let mirror: Record<string, AgentRuntimeSnapshot> = {};

/**
 * Set to true by AgentStateServiceLive's layer construction. When true, the
 * async HTTP adapter in agent-runtime.ts short-circuits to the sync mirror
 * instead of making a localhost HTTP call — we're running IN the dashboard,
 * so fetching our own HTTP server would deadlock if it's still bootstrapping.
 */
let inProcessService = false;

export function markAgentStateServiceInProcess(): void {
  inProcessService = true;
}

export function isAgentStateServiceInProcess(): boolean {
  return inProcessService;
}

export function setAgentRuntimeMirror(next: Record<string, AgentRuntimeSnapshot>): void {
  mirror = next;
}

export function getRuntimeSnapshotSync(agentId: string): AgentRuntimeSnapshot | null {
  return mirror[agentId] ?? null;
}
