/**
 * Effort for a relaunch of an existing agent (PAN-4253). A persisted
 * state.effort wins whatever its source (the pin rule) and is re-clamped to
 * the relaunch model/harness; legacy state without one resolves through the
 * role → project → default chain. Callers write the result back onto the
 * state so it always describes the most recent launch.
 */
import { isEffortLevel, type EffortLevel, type EffortSource } from '@overdeck/contracts';
import type { AgentState } from './agent-state-read.js';
import type { RuntimeName } from '../runtimes/types.js';
import { resolveEffort, type EffortConfigSlice } from './resolve-effort.js';

export interface RelaunchEffort {
  effort: EffortLevel;
  source: EffortSource;
  warning?: string;
}

export type RelaunchEffortState = Pick<AgentState, 'effort' | 'effortSource' | 'role' | 'reviewSubRole' | 'issueId' | 'model' | 'harness'>;

export function resolveRelaunchEffort(
  state: RelaunchEffortState,
  launch: { model?: string; harness?: RuntimeName; config?: EffortConfigSlice } = {},
): RelaunchEffort {
  const model = launch.model ?? state.model;
  const harness = launch.harness ?? state.harness;
  if (isEffortLevel(state.effort)) {
    const pinned = resolveEffort({ explicit: state.effort, model, harness });
    return { effort: pinned.effort, source: state.effortSource ?? 'explicit', warning: pinned.warning };
  }
  const legacy = resolveEffort({
    role: state.role,
    subRole: state.reviewSubRole,
    issueId: state.issueId,
    model,
    harness,
    config: launch.config,
  });
  return { effort: legacy.effort, source: legacy.source, warning: legacy.warning };
}

/** AgentState fields for a spawn that was given an effort; empty when it was not (D5). */
export function spawnEffortFields(
  effort: EffortLevel | undefined,
  source: EffortSource | undefined,
): Pick<AgentState, 'effort' | 'effortSource'> {
  return effort === undefined ? {} : { effort, effortSource: source ?? 'explicit' };
}
