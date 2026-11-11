/**
 * PAN-5093 disk alert threshold keys: fold one config layer's `resources.*`
 * disk keys onto the resolved values, split out of merge.ts (a god file that
 * must not grow). An out-of-range value is ignored (the value so far stays)
 * rather than clamped.
 */

import type { DiskResourcesConfig, DiskResourcesYamlConfig } from './schema-disk.js';

function isGibThreshold(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1024;
}

// Inverted disk thresholds fall back to the defaults instead of throwing,
// warned once per distinct pair so repeated config loads stay quiet.
const warnedInvertedDiskThresholds = new Set<string>();
function warnInvertedDiskThresholds(warn: number, critical: number, defaults: DiskResourcesConfig): void {
  const key = `${warn}:${critical}`;
  if (warnedInvertedDiskThresholds.has(key)) return;
  warnedInvertedDiskThresholds.add(key);
  console.warn(
    'config.yaml: resources.disk_critical_gb must be lower than '
    + 'resources.disk_warn_gb — critical is the more severe level. '
    + `Using the defaults (warn ${defaults.diskWarnGb}, critical ${defaults.diskCriticalGb}).`,
  );
}

/** Apply `yaml`'s valid disk keys to `resolved` in place; reset an inverted pair to `defaults`. */
export function mergeDiskResources(
  yaml: DiskResourcesYamlConfig,
  resolved: DiskResourcesConfig,
  defaults: DiskResourcesConfig,
): void {
  if (isGibThreshold(yaml.disk_warn_gb)) resolved.diskWarnGb = yaml.disk_warn_gb;
  if (isGibThreshold(yaml.disk_critical_gb)) resolved.diskCriticalGb = yaml.disk_critical_gb;
  if (resolved.diskCriticalGb >= resolved.diskWarnGb) {
    warnInvertedDiskThresholds(resolved.diskWarnGb, resolved.diskCriticalGb, defaults);
    resolved.diskWarnGb = defaults.diskWarnGb;
    resolved.diskCriticalGb = defaults.diskCriticalGb;
  }
}
