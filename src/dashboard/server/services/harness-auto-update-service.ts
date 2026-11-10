/**
 * PAN-5108: the background harness CLI updater. Two minutes after the primary
 * dashboard starts, and then 24 hours after each pass ends, it checks every
 * installed harness CLI one at a time and updates an npm-based one when npm
 * has a newer version (D2, D6). A CLI with no runnable plan or a non-npm plan
 * is skipped and logged with the command to run by hand.
 *
 * Each outcome writes exactly one log line (FR-10). A failure is a warning
 * activity entry and a Needs-you item until a later pass ends that CLI as
 * updated, current or skipped (D15). Running sessions keep their binary. Runs
 * in the primary dashboard only (main.ts).
 */

import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { HarnessAutoUpdateFailure, HarnessAutoUpdateOutcomeKind, HarnessAutoUpdateSnapshot } from '@overdeck/contracts';
import { emitActivityEntry, type EmitActivityOptions } from '../../../lib/activity-logger.js';
import { isHarnessAutoUpdateEnabled } from '../../../lib/fleet/harness-auto-update.js';
import {
  runExclusiveUpdate,
  runHarnessUpdateCommand,
  UPDATE_OUTPUT_TAIL_CHARS,
  type UpdateCommandResult,
} from '../../../lib/fleet/harness-update-runner.js';
import { detectHarnessClis, type InstalledHarnessCli, parseCliVersion, readCliVersion } from '../../../lib/fleet/harness-versions.js';
import { compareSemver } from '../../../lib/herdr-setup/binary.js';
import { UPDATE_TIMEOUT_MS } from './fleet-update-service.js';

const execFileAsync = promisify(execFile);

/** The first pass runs this long after the service starts (D2). */
export const HARNESS_AUTO_UPDATE_BOOT_DELAY_MS = 2 * 60_000;
/** The next pass runs this long after a pass ends (D2). */
export const HARNESS_AUTO_UPDATE_INTERVAL_MS = 24 * 60 * 60_000;
/** `npm view <pkg> version` gets this long (D12). */
export const NPM_VIEW_TIMEOUT_MS = 60_000;

const LOG_PREFIX = '[harness-auto-update]';

export interface HarnessAutoUpdateServiceDeps {
  isEnabled: () => Promise<boolean>;
  detectClis: () => Promise<InstalledHarnessCli[]>;
  /** npm's latest version of `pkg`; throws when npm cannot answer. */
  latestVersion: (npmBin: string, pkg: string, pathDir: string) => Promise<string>;
  runUpdate: (argv: string[], pathDir: string) => Promise<UpdateCommandResult>;
  /** A fresh `--version` read after an update (cache bypassed). */
  readVersion: (binaryPath: string) => Promise<string | null>;
  log: (line: string) => void;
  emit: (entry: EmitActivityOptions) => void;
  now: () => number;
}

async function defaultLatestVersion(npmBin: string, pkg: string, pathDir: string): Promise<string> {
  const { stdout } = await execFileAsync(npmBin, ['view', pkg, 'version'], {
    timeout: NPM_VIEW_TIMEOUT_MS,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${pathDir}:${process.env.PATH ?? ''}` },
  });
  const version = parseCliVersion(stdout);
  if (version === null) throw new Error(`npm view ${pkg} version printed no version`);
  return version;
}

function resolveDeps(deps: Partial<HarnessAutoUpdateServiceDeps>): HarnessAutoUpdateServiceDeps {
  return {
    isEnabled: deps.isEnabled ?? (() => isHarnessAutoUpdateEnabled()),
    detectClis: deps.detectClis ?? (() => detectHarnessClis({ refresh: true })),
    latestVersion: deps.latestVersion ?? defaultLatestVersion,
    runUpdate: deps.runUpdate ?? ((argv, pathDir) =>
      runExclusiveUpdate(argv.join(' '), () => runHarnessUpdateCommand(argv, { timeoutMs: UPDATE_TIMEOUT_MS, pathDir }))),
    readVersion: deps.readVersion ?? ((binaryPath) => readCliVersion(binaryPath, { refresh: true })),
    log: deps.log ?? ((line) => console.log(line)),
    emit: deps.emit ?? emitActivityEntry,
    now: deps.now ?? Date.now,
  };
}

interface ServiceState {
  deps: HarnessAutoUpdateServiceDeps;
  enabled: boolean | null;
  running: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  failures: HarnessAutoUpdateFailure[];
  timer: ReturnType<typeof setTimeout> | null;
}

let state: ServiceState | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tail(text: string): string {
  return text.length > UPDATE_OUTPUT_TAIL_CHARS ? text.slice(-UPDATE_OUTPUT_TAIL_CHARS) : text;
}

function manualHint(display: string): string {
  return display ? ` Update it yourself: ${display}` : '';
}

/** Checks one CLI and returns its outcome. Writes exactly one log line. Never throws. */
async function checkCli(
  s: ServiceState,
  cli: InstalledHarnessCli,
  failures: HarnessAutoUpdateFailure[],
): Promise<HarnessAutoUpdateOutcomeKind> {
  const { deps } = s;
  const { label, plan, version, binaryPath } = cli;
  const fail = (error: string): HarnessAutoUpdateOutcomeKind => {
    const firstLine = error.trim().slice(0, 200);
    const message = `${LOG_PREFIX} ${label}: update failed: ${firstLine}. Overdeck retries at the next daily check.`;
    deps.log(message);
    deps.emit({ source: 'dashboard', level: 'warn', message });
    failures.push({
      binary: cli.binary,
      label,
      error: tail(error),
      command: plan.display,
      failedAt: new Date(deps.now()).toISOString(),
    });
    return 'failed';
  };

  if (plan.argv === null) {
    deps.log(`${LOG_PREFIX} ${label}: skipped, Overdeck has no update it can run (${plan.reason ?? 'no update plan'}).${manualHint(plan.display)}`);
    return 'skipped';
  }
  if (plan.npmPackage === null) {
    deps.log(`${LOG_PREFIX} ${label}: skipped, its update is not npm-based.${manualHint(plan.display)}`);
    return 'skipped';
  }
  if (version === null) {
    deps.log(`${LOG_PREFIX} ${label}: skipped, its installed version could not be read.`);
    return 'skipped';
  }

  const pathDir = dirname(binaryPath);
  let latest: string;
  try {
    latest = await deps.latestVersion(plan.argv[0]!, plan.npmPackage, pathDir);
  } catch (error) {
    return fail(`could not read the latest version from npm: ${errorMessage(error)}`);
  }

  if (compareSemver(version, latest) >= 0) {
    deps.log(`${LOG_PREFIX} ${label}: ${version} is current.`);
    return 'current';
  }

  const result = await deps.runUpdate(plan.argv, pathDir);
  const after = await deps.readVersion(binaryPath).catch(() => null);
  if (after !== null && (compareSemver(after, latest) >= 0 || (result.code === 0 && after !== version))) {
    const message =
      `${LOG_PREFIX} ${label}: updated ${version} -> ${after}. ` +
      `New launches use ${after}; running sessions keep ${version} until they restart.`;
    deps.log(message);
    deps.emit({ source: 'dashboard', level: 'info', message });
    return 'updated';
  }
  if (result.code !== 0) return fail(result.output.trim() || `exited with code ${result.code}`);
  return fail(`the update finished, but ${label} still reports ${after ?? 'no readable version'} (npm latest is ${latest})`);
}

function schedule(s: ServiceState, delayMs: number): void {
  if (s.timer !== null) clearTimeout(s.timer);
  s.nextRunAt = new Date(s.deps.now() + delayMs).toISOString();
  s.timer = setTimeout(() => {
    s.timer = null;
    void runPass(s);
  }, delayMs);
  s.timer.unref?.();
}

/** One pass over every installed CLI, one at a time (FR-8, FR-9). Never throws. */
async function runPass(s: ServiceState): Promise<void> {
  if (s.running) return;
  s.running = true;
  try {
    const enabled = await s.deps.isEnabled();
    s.enabled = enabled;
    if (!enabled) {
      s.failures = [];
      s.deps.log(`${LOG_PREFIX} skipped: harnesses.auto_update is off`);
      return;
    }
    const failures: HarnessAutoUpdateFailure[] = [];
    const clis = await s.deps.detectClis();
    for (const cli of clis) {
      await checkCli(s, cli, failures);
    }
    s.failures = failures;
  } catch (error) {
    s.deps.log(`${LOG_PREFIX} pass failed unexpectedly: ${errorMessage(error)}`);
  } finally {
    s.running = false;
    s.lastRunAt = new Date(s.deps.now()).toISOString();
    if (state === s) schedule(s, HARNESS_AUTO_UPDATE_INTERVAL_MS);
  }
}

/** Idempotent. Schedules the first pass `HARNESS_AUTO_UPDATE_BOOT_DELAY_MS` after start. */
export function startHarnessAutoUpdateService(deps: Partial<HarnessAutoUpdateServiceDeps> = {}): void {
  if (state !== null) return;
  state = {
    deps: resolveDeps(deps),
    enabled: null,
    running: false,
    lastRunAt: null,
    nextRunAt: null,
    failures: [],
    timer: null,
  };
  schedule(state, HARNESS_AUTO_UPDATE_BOOT_DELAY_MS);
}

export function stopHarnessAutoUpdateService(): void {
  if (state?.timer) clearTimeout(state.timer);
  state = null;
}

/** `enabled: null` and no failures when not started (a peer dashboard never starts the service). */
export function getHarnessAutoUpdateSnapshot(): HarnessAutoUpdateSnapshot {
  if (!state) return { enabled: null, running: false, lastRunAt: null, nextRunAt: null, failures: [] };
  return {
    enabled: state.enabled,
    running: state.running,
    lastRunAt: state.lastRunAt,
    nextRunAt: state.nextRunAt,
    failures: [...state.failures],
  };
}

/** Exported for tests: run one pass outside the schedule. No-op when not started. */
export async function runHarnessAutoUpdatePassOnce(): Promise<void> {
  if (!state) return;
  await runPass(state);
}
