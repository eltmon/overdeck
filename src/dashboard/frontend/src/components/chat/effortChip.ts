/**
 * Effort chip (PAN-4255): the level a running session uses and where it came
 * from. `resolved` is what Overdeck launched or stored (with its EffortSource
 * layer); `observed` is the level read from the session transcript. When the
 * two differ, someone ran `/effort` in the native terminal and the chip says
 * `terminal`.
 */
import { isEffortLevel, type EffortLevel, type EffortSource } from '@overdeck/contracts';

export type EffortChipSource = EffortSource | 'terminal';

export interface EffortChip {
  level: EffortLevel;
  source: EffortChipSource | null;
  /** True when the level was read from the session transcript. */
  observed: boolean;
}

export const EFFORT_SOURCE_LABELS: Record<EffortChipSource, string> = {
  explicit: 'set',
  item: 'item',
  plan: 'plan',
  tier: 'tier',
  'sub-role': 'sub-role',
  role: 'role',
  project: 'project',
  default: 'default',
  terminal: 'terminal',
};

export function resolveEffortChip(input: {
  resolved: { effort: string; source: EffortSource } | null;
  observed: string | null | undefined;
}): EffortChip | null {
  const resolvedLevel = isEffortLevel(input.resolved?.effort) ? input.resolved.effort : null;
  const observedLevel = isEffortLevel(input.observed) ? input.observed : null;
  if (resolvedLevel && observedLevel && observedLevel !== resolvedLevel) {
    return { level: observedLevel, source: 'terminal', observed: true };
  }
  if (resolvedLevel && input.resolved) {
    return { level: resolvedLevel, source: input.resolved.source, observed: observedLevel === resolvedLevel };
  }
  if (observedLevel) return { level: observedLevel, source: null, observed: true };
  return null;
}

export function effortChipTitle(
  chip: EffortChip,
  options: { liveChangeEnabled: boolean; harness: string | null | undefined },
): string {
  let title: string;
  if (chip.source === 'terminal') {
    title = 'Changed in the native terminal; observed in the session transcript.';
  } else if (chip.observed) {
    title = 'Observed in the session transcript.';
  } else {
    const label = chip.source ? EFFORT_SOURCE_LABELS[chip.source] : 'unknown';
    title = `Launch value (${label}); not yet observed in the session transcript.`;
  }
  if (options.liveChangeEnabled && options.harness === 'claude-code') {
    title += ' Picking a level sends /effort to the session. Claude Code also saves low–xhigh as your default for new sessions of this model.';
  }
  return title;
}
