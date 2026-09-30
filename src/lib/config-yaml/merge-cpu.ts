/**
 * PAN-4311 CPU resource keys: fold one config layer's `resources.*` CPU keys
 * onto the resolved values, split out of merge.ts (a god file that must not
 * grow). An out-of-range value is ignored (the value so far stays) rather than
 * clamped.
 */

import type { CpuResourcesConfig, CpuResourcesYamlConfig } from './schema-cpu.js';

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isPercent(value: unknown, allowZero: boolean): value is number {
  return typeof value === 'number' && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) && value <= 100;
}

// Inverted CPU PSI thresholds fall back to the defaults instead of throwing,
// warned once per distinct pair so repeated config loads stay quiet.
const warnedInvertedCpuPsiThresholds = new Set<string>();
function warnInvertedCpuPsiThresholds(hold: number, recovery: number, defaults: CpuResourcesConfig): void {
  const key = `${hold}:${recovery}`;
  if (warnedInvertedCpuPsiThresholds.has(key)) return;
  warnedInvertedCpuPsiThresholds.add(key);
  console.warn(
    'config.yaml: resources.governor_cpu_psi_recovery_avg60 must be lower than '
    + 'resources.governor_cpu_psi_hold_avg60 — lower CPU pressure is healthier. '
    + `Using the defaults (hold ${defaults.governorCpuPsiHoldAvg60}, `
    + `recovery ${defaults.governorCpuPsiRecoveryAvg60}).`,
  );
}

/** Apply `yaml`'s valid CPU keys to `resolved` in place; reset inverted PSI thresholds to `defaults`. */
export function mergeCpuResources(
  yaml: CpuResourcesYamlConfig,
  resolved: CpuResourcesConfig,
  defaults: CpuResourcesConfig,
): void {
  if (isIntegerInRange(yaml.dashboard_cpu_weight, 1, 10_000)) resolved.dashboardCpuWeight = yaml.dashboard_cpu_weight;
  if (isIntegerInRange(yaml.verification_cpu_weight, 1, 10_000)) resolved.verificationCpuWeight = yaml.verification_cpu_weight;
  if (isIntegerInRange(yaml.agent_nice, 0, 19)) resolved.agentNice = yaml.agent_nice;
  if (isIntegerInRange(yaml.lane_nice, 0, 19)) resolved.laneNice = yaml.lane_nice;
  if (isPercent(yaml.governor_cpu_psi_hold_avg60, false)) resolved.governorCpuPsiHoldAvg60 = yaml.governor_cpu_psi_hold_avg60;
  if (isPercent(yaml.governor_cpu_psi_recovery_avg60, true)) {
    resolved.governorCpuPsiRecoveryAvg60 = yaml.governor_cpu_psi_recovery_avg60;
  }
  if (typeof yaml.governor_cpu_hold_dispatch === 'boolean') resolved.governorCpuHoldDispatch = yaml.governor_cpu_hold_dispatch;
  if (resolved.governorCpuPsiRecoveryAvg60 >= resolved.governorCpuPsiHoldAvg60) {
    warnInvertedCpuPsiThresholds(resolved.governorCpuPsiHoldAvg60, resolved.governorCpuPsiRecoveryAvg60, defaults);
    resolved.governorCpuPsiHoldAvg60 = defaults.governorCpuPsiHoldAvg60;
    resolved.governorCpuPsiRecoveryAvg60 = defaults.governorCpuPsiRecoveryAvg60;
  }
}
