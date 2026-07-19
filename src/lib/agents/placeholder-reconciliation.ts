import { Effect } from 'effect';

import { logAgentLifecycleSync, logDeaconEventSync } from '../persistent-logger.js';
import type { AgentState } from './agent-state.js';
import { markAgentRunningState, saveAgentState } from './agent-state.js';
import { readPinnedAgentLaunchSync, type PinnedAgentLaunch } from './pinned-launch.js';

interface PlaceholderReconciliationDeps {
  readPinnedLaunch: (agentId: string) => PinnedAgentLaunch | null;
  markRunning: (state: AgentState) => AgentState;
  saveState: (state: AgentState) => Promise<void>;
  logDeacon: (message: string) => void;
  logAgent: (agentId: string, message: string) => void;
}

function defaultPlaceholderReconciliationDeps(): PlaceholderReconciliationDeps {
  return {
    readPinnedLaunch: readPinnedAgentLaunchSync,
    markRunning: markAgentRunningState,
    saveState: (state) => Effect.runPromise(saveAgentState(state)),
    logDeacon: logDeaconEventSync,
    logAgent: logAgentLifecycleSync,
  };
}

export async function reconcileLiveWorkSpawnPlaceholder(
  state: AgentState,
  notifyStatusChanged: (
    state: AgentState,
    previousStatus?: AgentState['status'],
    hasLiveTmuxSession?: boolean,
  ) => void,
  deps?: PlaceholderReconciliationDeps,
): Promise<string | null> {
  if (state.model !== 'pending-work-spawn') return null;
  const resolvedDeps = deps ?? defaultPlaceholderReconciliationDeps();
  const pinnedLaunch = resolvedDeps.readPinnedLaunch(state.id);
  if (!pinnedLaunch) return null;

  const previousStatus = state.status;
  state.model = pinnedLaunch.model;
  state.harness = pinnedLaunch.harness;
  state.sessionId = pinnedLaunch.sessionId;
  resolvedDeps.markRunning(state);
  await resolvedDeps.saveState(state);
  notifyStatusChanged(state, previousStatus, true);

  const message = `Reconciled ${state.id} placeholder to running (${pinnedLaunch.harness}/${pinnedLaunch.model})`;
  resolvedDeps.logDeacon(`handleAgentHeartbeatDeadEvent: ${message}`);
  resolvedDeps.logAgent(state.id, message);
  return message;
}
