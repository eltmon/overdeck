import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getMergeSetSync } from '../merge-set.js';
import { findProjectByPathSync, getProjectSync, type ReleaseComponentConfig } from '../projects.js';
import { setReviewStatusSync } from '../review-status.js';
import {
  type ReleaseCheckStatus,
  type ReleaseComponentState,
  type ReleaseSet,
  type ReleaseSetStatus,
  upsertReleaseSetSync,
  withComponentStateSync,
} from '../release-set.js';
import { resolveReleasePlan, type ReleaseComponentPlanEntry } from './release-plan.js';

const execAsync = promisify(exec);

export interface ReleaseEngineOptions {
  commandTimeoutMs?: number;
  healthTimeoutMs?: number;
  healthPollIntervalMs?: number;
  runCommand?: (command: string, timeoutMs: number) => Promise<void>;
  fetchHealth?: (url: string, timeoutMs: number) => Promise<{ ok: boolean; status?: number }>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

interface ComponentFailure {
  componentKey: string;
  rollbackRan: boolean;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 120_000;
const DEFAULT_HEALTH_POLL_INTERVAL_MS = 2_000;

export async function runRelease(
  issueId: string,
  projectPath: string,
  options: ReleaseEngineOptions = {},
): Promise<ReleaseSet | null> {
  const mergeSet = getMergeSetSync(issueId);
  if (!mergeSet) {
    throw new Error(`Cannot run release for ${issueId}: merge set not found`);
  }

  const project = getProjectSync(mergeSet.projectKey) ?? findProjectByPathSync(projectPath);
  if (!project?.release) {
    setReviewStatusSync(issueId, {
      releaseStatus: 'skipped',
      releaseNotes: 'No release config found for project.',
    });
    return null;
  }

  const now = options.now ?? (() => new Date());
  const plan = resolveReleasePlan(project.release);
  let releaseSet = buildReleaseSet(issueId, mergeSet, plan, now().toISOString());
  upsertReleaseSetSync(releaseSet);
  setReviewStatusSync(issueId, { releaseStatus: 'releasing' });

  let failure: ComponentFailure | null = null;
  for (const entry of plan) {
    if (entry.config.trigger === 'manual') {
      releaseSet = persistComponentPatch(releaseSet, entry.component, {
        status: 'blocked',
        notes: 'Awaiting manual release.',
      });
      continue;
    }

    releaseSet = persistComponentPatch(releaseSet, entry.component, {
      status: 'releasing',
      notes: entry.notes.join(' ') || undefined,
    });

    const result = await runAutoComponent(entry.component, entry.config, options);
    releaseSet = persistComponentPatch(releaseSet, entry.component, result.patch);

    if (!result.passed) {
      let rollbackRan = false;
      if (entry.config.rollback) {
        rollbackRan = await runConfiguredCommand(entry.config.rollback, options);
        releaseSet = persistComponentPatch(releaseSet, entry.component, {
          status: rollbackRan ? 'rolled_back' : 'failed',
          rollbackStatus: rollbackRan ? 'rolled_back' : 'failed',
          notes: appendNote(result.patch.notes, rollbackRan ? 'Rollback completed.' : 'Rollback failed.'),
        });
      }
      failure = { componentKey: entry.component, rollbackRan };
      break;
    }
  }

  if (failure) {
    releaseSet = haltRemainingComponents(releaseSet, failure.componentKey);
    const releaseStatus = finalFailureStatus(releaseSet, failure.rollbackRan);
    releaseSet = persistReleaseSetStatus(releaseSet, releaseStatus);
    setReviewStatusSync(issueId, {
      releaseStatus,
      releaseNotes: `Release halted at ${failure.componentKey}.`,
    });
    return releaseSet;
  }

  const blockedComponents = releaseSet.components.filter(
    (component) => component.status === 'blocked',
  );
  if (blockedComponents.length > 0) {
    const blockedKeys = blockedComponents.map((component) => component.componentKey).join(', ');
    releaseSet = persistReleaseSetStatus(releaseSet, 'partial');
    setReviewStatusSync(issueId, {
      releaseStatus: 'partial',
      releaseNotes: `Release awaiting manual step(s): ${blockedKeys}.`,
    });
    return releaseSet;
  }

  releaseSet = persistReleaseSetStatus(releaseSet, 'passed');
  setReviewStatusSync(issueId, { releaseStatus: 'passed' });
  return releaseSet;
}

function buildReleaseSet(
  issueId: string,
  mergeSet: NonNullable<ReturnType<typeof getMergeSetSync>>,
  plan: ReleaseComponentPlanEntry[],
  timestamp: string,
): ReleaseSet {
  return {
    issueId,
    projectKey: mergeSet.projectKey,
    projectPath: mergeSet.projectPath,
    workspaceType: mergeSet.workspaceType,
    status: 'releasing',
    createdAt: timestamp,
    updatedAt: timestamp,
    components: plan.map((entry): ReleaseComponentState => ({
      componentKey: entry.component,
      provider: entry.config.provider,
      trigger: entry.config.trigger,
      releaseOrder: entry.releaseOrder,
      required: true,
      status: 'pending',
      healthStatus: entry.config.health_url ? 'pending' : 'skipped',
      versionStatus: entry.config.version_check ? 'pending' : 'skipped',
      smokeStatus: entry.config.smoke_test ? 'pending' : 'skipped',
      rollbackStatus: entry.config.rollback ? 'pending' : 'skipped',
      notes: entry.notes.join(' ') || undefined,
    })),
  };
}

async function runAutoComponent(
  componentKey: string,
  config: ReleaseComponentConfig,
  options: ReleaseEngineOptions,
): Promise<{ passed: boolean; patch: Partial<ReleaseComponentState> }> {
  if (config.health_url) {
    const healthy = await waitForHealth(config.health_url, options);
    if (!healthy) {
      return {
        passed: false,
        patch: {
          status: 'failed',
          healthStatus: 'failed',
          notes: `Health check failed for ${componentKey}.`,
        },
      };
    }
  }

  if (config.version_check) {
    const passed = await runConfiguredCommand(config.version_check, options);
    if (!passed) {
      return {
        passed: false,
        patch: {
          status: 'failed',
          healthStatus: config.health_url ? 'passed' : 'skipped',
          versionStatus: 'failed',
          notes: `Version check failed for ${componentKey}.`,
        },
      };
    }
  }

  if (config.smoke_test) {
    const passed = await runConfiguredCommand(config.smoke_test, options);
    if (!passed) {
      return {
        passed: false,
        patch: {
          status: 'failed',
          healthStatus: config.health_url ? 'passed' : 'skipped',
          versionStatus: config.version_check ? 'passed' : 'skipped',
          smokeStatus: 'failed',
          notes: `Smoke test failed for ${componentKey}.`,
        },
      };
    }
  }

  return {
    passed: true,
    patch: {
      status: 'passed',
      healthStatus: config.health_url ? 'passed' : 'skipped',
      versionStatus: config.version_check ? 'passed' : 'skipped',
      smokeStatus: config.smoke_test ? 'passed' : 'skipped',
    },
  };
}

async function waitForHealth(url: string, options: ReleaseEngineOptions): Promise<boolean> {
  const timeoutMs = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const intervalMs = options.healthPollIntervalMs ?? DEFAULT_HEALTH_POLL_INTERVAL_MS;
  const fetchHealth = options.fetchHealth ?? defaultFetchHealth;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      const response = await fetchHealth(url, options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
      if (response.ok) return true;
    } catch {
      // Keep polling until the bounded health deadline expires.
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await sleep(Math.min(intervalMs, remaining));
  }
}

async function runConfiguredCommand(command: string, options: ReleaseEngineOptions): Promise<boolean> {
  const timeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const runCommand = options.runCommand ?? defaultRunCommand;
  try {
    await runCommand(command, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

async function defaultRunCommand(command: string, timeoutMs: number): Promise<void> {
  await execAsync(command, { timeout: timeoutMs });
}

async function defaultFetchHealth(url: string, timeoutMs: number): Promise<{ ok: boolean; status?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function persistComponentPatch(
  releaseSet: ReleaseSet,
  componentKey: string,
  patch: Partial<ReleaseComponentState>,
): ReleaseSet {
  const updated = withComponentStateSync(releaseSet, componentKey, patch);
  upsertReleaseSetSync(updated);
  return updated;
}

function persistReleaseSetStatus(releaseSet: ReleaseSet, status: ReleaseSetStatus): ReleaseSet {
  const updated = {
    ...releaseSet,
    status,
    updatedAt: new Date().toISOString(),
  };
  upsertReleaseSetSync(updated);
  return updated;
}

function haltRemainingComponents(releaseSet: ReleaseSet, failedComponentKey: string): ReleaseSet {
  const failed = releaseSet.components.find(component => component.componentKey === failedComponentKey);
  if (!failed) return releaseSet;

  let updated = releaseSet;
  for (const component of releaseSet.components) {
    if (component.releaseOrder <= failed.releaseOrder || component.status !== 'pending') continue;
    updated = withComponentStateSync(updated, component.componentKey, {
      status: 'skipped',
      notes: 'Release halted before this component ran.',
    });
  }
  upsertReleaseSetSync(updated);
  return updated;
}

function finalFailureStatus(releaseSet: ReleaseSet, rollbackRan: boolean): ReleaseSetStatus {
  if (rollbackRan) return 'rolled_back';
  return releaseSet.components.some(component => component.required && component.status === 'passed')
    ? 'partial'
    : 'failed';
}

function appendNote(existing: string | undefined, note: string): string {
  return existing ? `${existing} ${note}` : note;
}
