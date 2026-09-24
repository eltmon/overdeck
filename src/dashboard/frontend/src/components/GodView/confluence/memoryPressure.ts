import type { GodViewSystemHealth } from '../../../hooks/useGodViewSocket';

/**
 * The God View's memory-distress signal (PAN-3540): Linux PSI and swap
 * activity, never swap occupancy. A full swap of cold pages is historical
 * residue, not pressure — the system-health producer itself files it as an
 * `info` diagnostic — so swap % can never raise this signal.
 *
 * The bands mirror `LINUX_MEMORY_PRESSURE_DEFAULTS` in
 * src/lib/system-health/linux.ts (server-side, not importable here).
 */
export const PSI_SOME_WARNING_AVG10 = 5;
export const PSI_FULL_CRITICAL_AVG10 = 1;
export const SWAP_ACTIVITY_WARNING_BYTES_PER_MINUTE = 64 * 1024 ** 2;
export const SWAP_ACTIVITY_CRITICAL_BYTES_PER_MINUTE = 256 * 1024 ** 2;

export type MemoryPressureLevel = 'calm' | 'warning' | 'critical' | 'unknown';

export interface MemoryPressureReading {
  /** PSI `some` avg10 — share of the last 10 s any task stalled on memory. */
  someAvg10: number | null;
  /** PSI `full` avg10 — share of the last 10 s every task stalled on memory. */
  fullAvg10: number | null;
  /** Swap-in + swap-out traffic, bytes per minute. */
  swapActivityBytesPerMinute: number | null;
  /** Occupancy, shown as detail only. */
  swapUsedPercent: number | null;
  level: MemoryPressureLevel;
}

export function readMemoryPressure(system: GodViewSystemHealth | null | undefined): MemoryPressureReading {
  const metrics = system?.host?.metrics;
  const someAvg10 = metrics?.memoryPressureSomeAvg10 ?? null;
  const fullAvg10 = metrics?.memoryPressureFullAvg10 ?? null;
  const swapActivityBytesPerMinute = metrics?.swapActivityBytesPerMinute ?? null;
  const swapUsedPercent = metrics?.swapUsedPercent ?? system?.summary?.swapUsedPercent ?? null;

  let level: MemoryPressureLevel;
  if (
    (fullAvg10 != null && fullAvg10 >= PSI_FULL_CRITICAL_AVG10)
    || (swapActivityBytesPerMinute != null && swapActivityBytesPerMinute >= SWAP_ACTIVITY_CRITICAL_BYTES_PER_MINUTE)
  ) {
    level = 'critical';
  } else if (
    (someAvg10 != null && someAvg10 >= PSI_SOME_WARNING_AVG10)
    || (swapActivityBytesPerMinute != null && swapActivityBytesPerMinute >= SWAP_ACTIVITY_WARNING_BYTES_PER_MINUTE)
  ) {
    level = 'warning';
  } else if (someAvg10 == null && fullAvg10 == null && swapActivityBytesPerMinute == null) {
    level = 'unknown';
  } else {
    level = 'calm';
  }

  return { someAvg10, fullAvg10, swapActivityBytesPerMinute, swapUsedPercent, level };
}

function formatRate(bytesPerMinute: number): string {
  const mb = bytesPerMinute / 1024 ** 2;
  return mb >= 1 ? `${mb.toFixed(1)} MB/min` : `${Math.round(bytesPerMinute / 1024)} KB/min`;
}

/** The hover detail: every pressure input plus swap occupancy, labeled as context. */
export function describeMemoryPressure(reading: MemoryPressureReading): string {
  const fmt = (value: number | null, suffix = '') => (value == null ? '—' : `${value.toFixed(2)}${suffix}`);
  return [
    `memory PSI some avg10 ${fmt(reading.someAvg10, '%')} · full avg10 ${fmt(reading.fullAvg10, '%')}`,
    `swap in/out ${reading.swapActivityBytesPerMinute == null ? '—' : formatRate(reading.swapActivityBytesPerMinute)}`,
    `swap occupancy ${reading.swapUsedPercent == null ? '—' : `${Math.round(reading.swapUsedPercent)}%`} (context, not pressure)`,
  ].join('\n');
}
