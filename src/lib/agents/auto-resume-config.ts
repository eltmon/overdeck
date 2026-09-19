import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';

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

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validBackoffSchedule(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0);
}

export function normalizeAutoResumeConfig(
  override: Partial<AutoResumeConfig> | undefined,
  source: string,
): AutoResumeConfig {
  if (override === undefined) return DEFAULT_AUTO_RESUME_CONFIG;

  const config: AutoResumeConfig = { ...DEFAULT_AUTO_RESUME_CONFIG };
  if (override.maxConsecutiveFailures !== undefined) {
    if (positiveNumber(override.maxConsecutiveFailures)) {
      config.maxConsecutiveFailures = override.maxConsecutiveFailures;
    } else {
      console.warn(`[auto-resume] Invalid ${source}.maxConsecutiveFailures; using default ${DEFAULT_AUTO_RESUME_CONFIG.maxConsecutiveFailures}`);
    }
  }

  if (override.troubledWindowMs !== undefined) {
    if (positiveNumber(override.troubledWindowMs)) {
      config.troubledWindowMs = override.troubledWindowMs;
    } else {
      console.warn(`[auto-resume] Invalid ${source}.troubledWindowMs; using default ${DEFAULT_AUTO_RESUME_CONFIG.troubledWindowMs}`);
    }
  }

  if (override.failureBackoffSchedule !== undefined) {
    if (validBackoffSchedule(override.failureBackoffSchedule)) {
      config.failureBackoffSchedule = override.failureBackoffSchedule;
    } else {
      console.warn(`[auto-resume] Invalid ${source}.failureBackoffSchedule; using default ${DEFAULT_AUTO_RESUME_CONFIG.failureBackoffSchedule.join(',')}`);
    }
  }

  return config;
}

export function resolveAutoResumeConfigForIssue(issueId: string | undefined): AutoResumeConfig {
  if (!issueId) return DEFAULT_AUTO_RESUME_CONFIG;

  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return DEFAULT_AUTO_RESUME_CONFIG;

  const project = getProjectSync(resolved.projectKey);
  return normalizeAutoResumeConfig(project?.autoResume, `projects.${resolved.projectKey}.autoResume`);
}
