/**
 * PAN-4311 CPU contention keys, split out of schema.ts (a god file that must
 * not grow). `resources` in config.yaml and the resolved config extend these.
 */

/** config.yaml `resources.*` CPU keys (snake_case). */
export interface CpuResourcesYamlConfig {
  /** systemd CPUWeight (1-10000) for the dashboard and supervisor units */
  dashboard_cpu_weight?: number;
  /** systemd CPUWeight (1-10000) for verification-worker scopes */
  verification_cpu_weight?: number;
  /** nice level (0-19) for batch agents (work, review, test, plan, worker, strike, uat) */
  agent_nice?: number;
  /** nice level (0-19) for gauntlet lane conversations */
  lane_nice?: number;
  /** hold at or above this CPU PSI `some avg60` percentage */
  governor_cpu_psi_hold_avg60?: number;
  /** stay held while CPU PSI `some avg60` is at or above this; must be lower than hold */
  governor_cpu_psi_recovery_avg60?: number;
  /** hold Flywheel-started agent spawns while CPU pressure is saturated (default off) */
  governor_cpu_hold_dispatch?: boolean;
}

/** Resolved CPU resource settings (always defined). */
export interface CpuResourcesConfig {
  dashboardCpuWeight: number;
  verificationCpuWeight: number;
  agentNice: number;
  laneNice: number;
  governorCpuPsiHoldAvg60: number;
  governorCpuPsiRecoveryAvg60: number;
  governorCpuHoldDispatch: boolean;
}
