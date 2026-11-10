/**
 * Harness CLI auto-update policy (PAN-5108).
 *
 * `isHarnessAutoUpdateEnabled` reads the machine-wide `harnesses.auto_update`
 * switch (D13, D14). `runLaunchUpdate` is the update-on-refusal step the
 * Claude Code launch check calls (D3, D9, D11): it runs the upgrade command
 * once through the process-wide update queue, skips it when the binary already
 * satisfies the model, and remembers a failure for 15 minutes so later
 * launches do not rerun a broken update.
 */
import type { ConfigLoadResult } from '../config-yaml/schema.js';
import {
  type QueuedUpdateResult,
  runExclusiveUpdate,
  runHarnessUpdateCommand,
  type RunUpdateCommandOptions,
  type UpdateCommandResult,
} from './harness-update-runner.js';

/** Update on refusal gives the command this long (D11). */
export const LAUNCH_UPDATE_TIMEOUT_MS = 180_000;
/** After a failed update on refusal, launches do not rerun the same command for this long (D11). */
export const LAUNCH_UPDATE_RETRY_MS = 900_000;
/** The refusal note keeps this much of the update output. */
const NOTE_OUTPUT_CHARS = 300;

export interface AutoUpdateEnabledDeps {
  loadGlobal?: () => Promise<ConfigLoadResult>;
  env?: NodeJS.ProcessEnv;
}

let warnedReadFailure = false;

/**
 * D13, D14: global config only; false under Vitest (so no test reaches a real
 * `npm install -g`); false, with one warning, when the config cannot be read.
 */
export async function isHarnessAutoUpdateEnabled(deps: AutoUpdateEnabledDeps = {}): Promise<boolean> {
  const env = deps.env ?? process.env;
  if (env.VITEST) return false;
  try {
    // Dynamic import keeps the config loader out of this module's static graph (lint:circular).
    const loadGlobal = deps.loadGlobal ?? (await import('../config-yaml/load.js')).loadGlobalConfigNoMigration;
    const { config } = await loadGlobal();
    return config.harnesses?.autoUpdate !== false;
  } catch (error) {
    if (!warnedReadFailure) {
      warnedReadFailure = true;
      console.warn(`[harness-auto-update] could not read harnesses.auto_update, treating it as off: ${error instanceof Error ? error.message : String(error)}`);
    }
    return false;
  }
}

export type LaunchUpdateOutcome =
  | { kind: 'already-current' }
  | { kind: 'ran'; code: number; output: string }
  | { kind: 'cooldown'; error: string; failedAt: number };

export interface LaunchUpdateDeps {
  run?: (argv: string[], opts: RunUpdateCommandOptions) => Promise<UpdateCommandResult>;
  now?: () => number;
}

const failures = new Map<string, { error: string; failedAt: number }>();

/**
 * Runs `argv` once through the update queue unless `isSatisfied()` already
 * holds or a failure for the same command is inside the cooldown.
 *
 * The queue may hand back a run another path started (the background updater,
 * "Update all", or another launch with a different minimum). Its result is a
 * plain command result or null, never this launch's outcome, so this function
 * builds the outcome itself. When the joined run ran no command and this
 * launch is still not satisfied, it queues its own run once. The caller always
 * re-checks its own minimum before it continues.
 */
export async function runLaunchUpdate(
  argv: string[],
  pathDir: string,
  isSatisfied: () => Promise<boolean>,
  deps: LaunchUpdateDeps = {},
): Promise<LaunchUpdateOutcome> {
  const run = deps.run ?? runHarnessUpdateCommand;
  const now = deps.now ?? Date.now;
  const key = argv.join(' ');
  const failed = failures.get(key);
  if (failed && now() - failed.failedAt < LAUNCH_UPDATE_RETRY_MS) {
    return { kind: 'cooldown', error: failed.error, failedAt: failed.failedAt };
  }
  const job = async (): Promise<QueuedUpdateResult> =>
    (await isSatisfied()) ? null : run(argv, { timeoutMs: LAUNCH_UPDATE_TIMEOUT_MS, pathDir });
  let result = await runExclusiveUpdate(key, job);
  if (result === null && !(await isSatisfied())) result = await runExclusiveUpdate(key, job);
  const outcome: LaunchUpdateOutcome = result === null ? { kind: 'already-current' } : { kind: 'ran', ...result };
  if (outcome.kind === 'ran' && outcome.code !== 0) {
    failures.set(key, { error: outcome.output || `exited with code ${outcome.code}`, failedAt: now() });
  } else {
    failures.delete(key);
  }
  return outcome;
}

export function _resetLaunchUpdateStateForTests(): void {
  failures.clear();
  warnedReadFailure = false;
}

function noteTail(text: string): string {
  return text.trim().slice(-NOTE_OUTPUT_CHARS).trim().replace(/\.+$/, '');
}

function minutesAgo(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
}

/** The sentence the Claude Code refusal appends after an update on refusal did not make the launch pass. */
export function launchUpdateNote(outcome: LaunchUpdateOutcome, now: number = Date.now()): string {
  if (outcome.kind === 'already-current') {
    return 'Overdeck found no Claude Code update to run, but the launch binary still reports an older version.';
  }
  if (outcome.kind === 'cooldown') {
    return `Overdeck's automatic update failed ${minutesAgo(now - outcome.failedAt)} and retries after 15 minutes: ${noteTail(outcome.error)}.`;
  }
  if (outcome.code === 0) {
    return 'Overdeck updated Claude Code automatically, but the launch binary still reports an older version.';
  }
  const detail = noteTail(outcome.output) || `exited with code ${outcome.code}`;
  return `Overdeck tried to update Claude Code automatically and it failed: ${detail}.`;
}
