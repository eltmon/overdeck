export interface AutoResumeConfig {
  maxConsecutiveFailures: number;
  troubledWindowMs: number;
  failureBackoffSchedule: number[];
}

export const DEFAULT_AUTO_RESUME_CONFIG: AutoResumeConfig = {
  maxConsecutiveFailures: 3,
  troubledWindowMs: 10 * 60 * 1000,
  failureBackoffSchedule: [5, 30, 120],
};
