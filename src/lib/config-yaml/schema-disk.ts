/**
 * PAN-5093 disk alert keys, split out of schema.ts (a god file that must not
 * grow). `resources` in config.yaml and the resolved config extend these.
 */

/** config.yaml `resources.*` disk alert keys (snake_case). */
export interface DiskResourcesYamlConfig {
  /** Needs-you + phone push when free disk on the Overdeck home's filesystem drops below this (GiB) */
  disk_warn_gb?: number;
  /** Second, blocking alert below this (GiB); must be lower than disk_warn_gb */
  disk_critical_gb?: number;
}

/** Resolved disk alert resource settings (always defined). */
export interface DiskResourcesConfig {
  diskWarnGb: number;
  diskCriticalGb: number;
}
