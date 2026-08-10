/**
 * Unified role primitive (PAN-1048) as a dependency leaf. Low-level doors
 * (activity-logger, pan-dir/agents) import the type from here so the
 * agent-state module graph never cycles back into them (lint:circular).
 */
export type Role = 'plan' | 'work' | 'review' | 'test' | 'ship' | 'flywheel' | 'strike' | 'sequencer' | 'knowledge';

export function isRole(value: unknown): value is Role {
  return value === 'plan' || value === 'work' || value === 'review' || value === 'test' || value === 'ship' || value === 'flywheel' || value === 'strike' || value === 'sequencer' || value === 'knowledge';
}
