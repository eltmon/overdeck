/**
 * Picks which reasoning effort actually reaches a launch (PAN-4257). A
 * caller-supplied effort that is explicit (or carries no source — the
 * pre-tiering convention, same default as {@link spawnEffortFields}) always
 * wins, matching resolveEffort's own explicit-outranks-everything rule.
 * Otherwise the staffed value (which already resolved tier precedence)
 * replaces the caller's non-explicit default; an empty staffed value leaves
 * the caller untouched.
 */
import type { EffortLevel, EffortSource } from '@overdeck/contracts';

export interface LaunchEffort {
  effort?: EffortLevel;
  effortSource?: EffortSource;
}

export function pickLaunchEffort(caller: LaunchEffort, staffed: LaunchEffort): LaunchEffort {
  const callerIsExplicit = caller.effort !== undefined && (caller.effortSource === undefined || caller.effortSource === 'explicit');
  if (callerIsExplicit) return caller;
  if (staffed.effort === undefined) return caller;
  return { effort: staffed.effort, effortSource: staffed.effortSource };
}
