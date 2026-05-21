/**
 * PAN-800 — in-process mirror of AgentStateService's canonical ref.
 *
 * The dashboard server writes into this mirror on every event fold so lib code
 * running in the same process can read the latest AgentRuntimeSnapshot.
 * CLI/out-of-process callers should prefer the async HTTP path in agent-runtime.ts.
 *
 * All exports are Effect-native (PAN-1249 wave-1 migration).
 */

import { Effect } from 'effect';
import type { AgentRuntimeSnapshot } from '@panctl/contracts';

let mirror: Record<string, AgentRuntimeSnapshot> = {};

/**
 * Set to true by AgentStateServiceLive's layer construction. When true, the
 * async HTTP adapter in agent-runtime.ts short-circuits to the sync mirror
 * instead of making a localhost HTTP call — we're running IN the dashboard,
 * so fetching our own HTTP server would deadlock if it's still bootstrapping.
 */
let inProcessService = false;

export function markAgentStateServiceInProcess(): Effect.Effect<void, never> {
  return Effect.sync(() => {
    inProcessService = true;
  });
}

export function isAgentStateServiceInProcess(): Effect.Effect<boolean, never> {
  return Effect.sync(() => inProcessService);
}

export function setAgentRuntimeMirror(next: Record<string, AgentRuntimeSnapshot>): Effect.Effect<void, never> {
  return Effect.sync(() => {
    mirror = next;
  });
}

export function getRuntimeSnapshot(agentId: string): Effect.Effect<AgentRuntimeSnapshot | null, never> {
  return Effect.sync(() => mirror[agentId] ?? null);
}
