/**
 * The per-machine update job behind Update all (PAN-4654 FR-6..FR-9, D-3..D-5,
 * D-8, D-13).
 *
 * Each machine runs its own job: wait until no turn is working (when-idle) or
 * start at once (now), update each harness CLI with its own update plan, then
 * update Overdeck through the dashboard's `UpdateManager` and restart the
 * dashboard when a new version was installed. The viewing machine keeps no
 * fleet state; it reads each machine's job from that machine's report.
 *
 * The job file `${OVERDECK_HOME}/fleet-update.json` is the one stored piece. It
 * is written (temp file + rename) at every change because the Overdeck step
 * restarts this process and the before/after versions must survive that.
 * `boot()` finishes a job left in `restarting` and fails one a crash or a
 * restart interrupted.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Option, Schema } from 'effect';
import {
  type FleetComponent,
  type FleetInstallMode,
  type FleetUpdateJob,
  FleetUpdateJobSchema,
  type FleetUpdateMode,
  type UpdateSnapshot,
} from '@overdeck/contracts';

import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { detectHarnessClis, type InstalledHarnessCli, readCliVersion } from '../../../lib/fleet/harness-versions.js';
import { getOverdeckHome } from '../../../lib/paths.js';
import { getOverdeckVersion } from '../routes/misc/shared.js';
import { currentInstallMode, getUpdateManager } from '../routes/misc/updates.js';
import { restartDashboardDetached } from './dashboard-restart.js';
import { countWorkingTurns } from './machine-load.js';

/** A waiting job re-counts working turns this often (FR-8). */
export const TURN_POLL_MS = 5_000;
/** The Overdeck install is polled this often while npm runs (D-8). */
export const INSTALL_POLL_MS = 1_000;
/** Each update command and the Overdeck install get this long (NFR-4). */
export const UPDATE_TIMEOUT_MS = 10 * 60_000;
/** A failed component keeps this much of the command output (NFR-4). */
export const OUTPUT_TAIL_CHARS = 2_000;

const ACTIVE_PHASES: ReadonlySet<FleetUpdateJob['phase']> = new Set(['waiting', 'updating', 'restarting']);
const OVERDECK = 'overdeck';

/** The slice of `UpdateManager` the job uses. */
export interface OverdeckUpdater {
  check(): Promise<UpdateSnapshot>;
  install(): UpdateSnapshot;
  getSnapshot(): UpdateSnapshot;
}

export interface FleetUpdateDeps {
  jobPath: string;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  detectClis: (opts: { refresh: boolean }) => Promise<InstalledHarnessCli[]>;
  /** A fresh `--version` read after an update (cache bypassed). */
  readVersion: (binaryPath: string) => Promise<string | null>;
  runCommand: (argv: string[]) => Promise<{ code: number; output: string }>;
  countWorkingTurns: () => Promise<number>;
  overdeck: {
    installMode: () => FleetInstallMode;
    version: () => Promise<string>;
    manager: () => Promise<OverdeckUpdater>;
  };
  restart: (requester: string) => Promise<{ ok: true; pid: number | null } | { ok: false; error: string }>;
  emit: (message: string, details: Record<string, unknown>) => void;
  now: () => number;
  randomId: () => string;
}

export type FleetStartOutcome = 'started' | 'escalated' | 'in-progress';

const decodeJob = Schema.decodeUnknownOption(FleetUpdateJobSchema);

function tail(text: string): string {
  return text.length > OUTPUT_TAIL_CHARS ? text.slice(-OUTPUT_TAIL_CHARS) : text;
}

/** Runs one update argv with stdin closed and a 10-minute cap; keeps only the output tail (NFR-4). */
export function runUpdateCommand(argv: string[], timeoutMs = UPDATE_TIMEOUT_MS): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const finish = (code: number, extra = ''): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, output: tail(output + extra) });
    };
    const child = spawn(argv[0]!, argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = (chunk: Buffer): void => { output = tail(output + chunk.toString('utf8')); };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(-1, `\ntimed out after ${Math.round(timeoutMs / 60_000)} minutes`);
    }, timeoutMs);
    child.on('error', (error) => finish(-1, `\n${error.message}`));
    child.on('close', (code) => finish(code ?? -1));
  });
}

export class FleetUpdateService {
  private job: FleetUpdateJob | null = null;
  /** The argv of each runnable harness component of the current job, by binary. */
  private plans = new Map<string, { argv: string[]; binaryPath: string }>();
  private wake: (() => void) | null = null;
  private starting: Promise<unknown> = Promise.resolve();
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly deps: FleetUpdateDeps) {}

  /** The current or last job. */
  current(): FleetUpdateJob | null {
    return this.job ? structuredClone(this.job) : null;
  }

  /** D-13: a start while a job waits in `now` mode escalates it; any other start while one is active is refused. */
  start(mode: FleetUpdateMode, requestedBy: string): Promise<{ outcome: FleetStartOutcome; job: FleetUpdateJob }> {
    const result = this.starting.then(() => this.startNow(mode, requestedBy));
    this.starting = result.catch(() => undefined);
    return result;
  }

  /** Update now on a waiting job; null when no job waits. */
  async escalate(): Promise<FleetUpdateJob | null> {
    const job = this.job;
    if (!job || job.phase !== 'waiting') return null;
    job.mode = 'now';
    await this.persist();
    this.wake?.();
    return this.current();
  }

  /** Cancel a waiting job; null when no job waits. */
  async cancel(): Promise<FleetUpdateJob | null> {
    const job = this.job;
    if (!job || job.phase !== 'waiting') return null;
    job.phase = 'cancelled';
    job.finishedAt = this.iso();
    for (const component of job.components) {
      if (component.status === 'pending') Object.assign(component, { status: 'skipped', detail: 'cancelled' });
    }
    await this.persist();
    this.announce();
    this.wake?.();
    return this.current();
  }

  /** Load the job file; finish a job the Overdeck restart left behind and fail one a restart interrupted (D-4). */
  async boot(): Promise<void> {
    let raw: string;
    try {
      raw = await this.deps.readFile(this.deps.jobPath);
    } catch {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const decoded = decodeJob(parsed);
    if (Option.isNone(decoded)) return;
    const job = structuredClone(decoded.value) as FleetUpdateJob;
    this.job = job;
    if (job.phase === 'restarting') {
      const overdeck = job.components.find((component) => component.name === OVERDECK);
      const version = await this.deps.overdeck.version();
      if (overdeck) {
        overdeck.after = version;
        if (version !== overdeck.before) Object.assign(overdeck, { status: 'updated', detail: null });
        else Object.assign(overdeck, { status: 'failed', detail: `the restarted dashboard still runs ${version}` });
      }
      this.finish();
    } else if (job.phase === 'waiting' || job.phase === 'updating') {
      for (const component of job.components) {
        if (component.status === 'running') Object.assign(component, { status: 'failed', detail: 'interrupted by a dashboard restart' });
        else if (component.status === 'pending') Object.assign(component, { status: 'skipped', detail: 'interrupted by a dashboard restart' });
      }
      job.phase = 'failed';
      job.finishedAt = this.iso();
    } else {
      return;
    }
    await this.persist();
    this.announce();
  }

  /** Resolves once every pending job-file write has landed (tests). */
  async settled(): Promise<void> {
    await this.writing;
  }

  private async startNow(mode: FleetUpdateMode, requestedBy: string): Promise<{ outcome: FleetStartOutcome; job: FleetUpdateJob }> {
    const active = this.job && ACTIVE_PHASES.has(this.job.phase) ? this.job : null;
    if (active) {
      if (active.phase === 'waiting' && mode === 'now') {
        await this.escalate();
        return { outcome: 'escalated', job: this.current()! };
      }
      return { outcome: 'in-progress', job: this.current()! };
    }

    const [clis, overdeckVersion] = await Promise.all([this.deps.detectClis({ refresh: true }), this.deps.overdeck.version()]);
    const installMode = this.deps.overdeck.installMode();
    this.plans = new Map();
    const components: FleetComponent[] = clis.map((cli) => {
      if (cli.plan.argv) {
        this.plans.set(cli.binary, { argv: cli.plan.argv, binaryPath: cli.binaryPath });
        return { name: cli.binary, label: cli.label, before: cli.version, after: null, status: 'pending', detail: null };
      }
      const detail = [cli.reason, cli.command].filter(Boolean).join(': ') || null;
      return { name: cli.binary, label: cli.label, before: cli.version, after: null, status: 'skipped', detail };
    });
    const overdeckSkip = installMode === 'development'
      ? 'development install: update it from the repository (pan reload)'
      : installMode === 'desktop' ? 'desktop app: update it from the app' : null;
    components.push({
      name: OVERDECK, label: 'Overdeck', before: overdeckVersion, after: null,
      status: overdeckSkip ? 'skipped' : 'pending', detail: overdeckSkip,
    });

    const startedAt = this.iso();
    this.job = {
      id: this.deps.randomId(),
      mode,
      phase: mode === 'now' ? 'updating' : 'waiting',
      requestedBy,
      startedAt,
      waitingTurns: 0,
      waitingSince: mode === 'now' ? null : startedAt,
      finishedAt: null,
      components,
    };
    await this.persist();
    this.announce();
    void this.run(this.job).catch((error: unknown) => this.crash(this.job, error));
    return { outcome: 'started', job: this.current()! };
  }

  private async run(job: FleetUpdateJob): Promise<void> {
    if (job.phase === 'waiting') {
      for (;;) {
        if (this.job !== job || job.phase !== 'waiting') return;
        if (job.mode === 'now') break;
        const turns = await this.deps.countWorkingTurns();
        if (this.job !== job || job.phase !== 'waiting') return;
        if (turns === 0) break;
        if (turns !== job.waitingTurns) {
          job.waitingTurns = turns;
          await this.persist();
        }
        await this.sleep(TURN_POLL_MS);
      }
      job.phase = 'updating';
      job.waitingTurns = 0;
      await this.persist();
      this.announce();
    }

    for (const component of job.components) {
      const plan = this.plans.get(component.name);
      if (component.name === OVERDECK || component.status !== 'pending' || !plan) continue;
      component.status = 'running';
      await this.persist();
      const { code, output } = await this.deps.runCommand(plan.argv);
      component.after = await this.deps.readVersion(plan.binaryPath);
      if (component.after !== component.before) Object.assign(component, { status: 'updated', detail: null });
      else if (code === 0) Object.assign(component, { status: 'current', detail: null });
      else Object.assign(component, { status: 'failed', detail: tail(output) || `exited with code ${code}` });
      await this.persist();
    }

    const overdeck = job.components.find((component) => component.name === OVERDECK);
    if (overdeck?.status === 'pending' && await this.updateOverdeck(job, overdeck)) return;
    this.finish();
    await this.persist();
    this.announce();
  }

  /** D-8: check, install, poll; true when the dashboard restart took over the job. */
  private async updateOverdeck(job: FleetUpdateJob, overdeck: FleetComponent): Promise<boolean> {
    overdeck.status = 'running';
    await this.persist();
    const manager = await this.deps.overdeck.manager();
    const checked = await manager.check();
    if (checked.phase === 'current') {
      Object.assign(overdeck, { status: 'current', after: overdeck.before, detail: null });
      return false;
    }
    if (checked.phase !== 'available') {
      Object.assign(overdeck, { status: 'failed', detail: checked.error ?? `the update check ended in ${checked.phase}` });
      return false;
    }
    let snapshot = manager.install();
    const deadline = this.deps.now() + UPDATE_TIMEOUT_MS;
    while (snapshot.phase === 'installing' && this.deps.now() < deadline) {
      await this.sleep(INSTALL_POLL_MS);
      snapshot = manager.getSnapshot();
    }
    if (snapshot.phase !== 'ready') {
      const detail = snapshot.phase === 'installing'
        ? `the install did not finish within ${UPDATE_TIMEOUT_MS / 60_000} minutes`
        : snapshot.error ?? `the install ended in ${snapshot.phase}`;
      Object.assign(overdeck, { status: 'failed', detail });
      return false;
    }
    overdeck.detail = checked.targetVersion ? `installed ${checked.targetVersion}; restarting the dashboard` : 'restarting the dashboard';
    job.phase = 'restarting';
    await this.persist();
    this.announce();
    const restarted = await this.deps.restart(`fleet-update:${job.id}`);
    if (restarted.ok) return true;
    Object.assign(overdeck, { status: 'failed', detail: `installed, but the dashboard restart failed: ${restarted.error}` });
    return false;
  }

  /** Phase `done`, or `failed` when any component failed. */
  private finish(): void {
    const job = this.job;
    if (!job) return;
    job.phase = job.components.some((component) => component.status === 'failed') ? 'failed' : 'done';
    job.finishedAt = this.iso();
  }

  private crash(job: FleetUpdateJob | null, error: unknown): void {
    if (!job || this.job !== job || !ACTIVE_PHASES.has(job.phase)) return;
    const message = error instanceof Error ? error.message : String(error);
    for (const component of job.components) {
      if (component.status === 'running') Object.assign(component, { status: 'failed', detail: message });
      else if (component.status === 'pending') Object.assign(component, { status: 'skipped', detail: message });
    }
    job.phase = 'failed';
    job.finishedAt = this.iso();
    void this.persist();
    this.announce();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }

  private iso(): string {
    return new Date(this.deps.now()).toISOString();
  }

  private announce(): void {
    const job = this.job;
    if (!job) return;
    this.deps.emit(`Fleet update: ${job.phase}`, {
      jobId: job.id,
      mode: job.mode,
      requestedBy: job.requestedBy,
      components: job.components.map(({ name, before, after, status }) => ({ name, before, after, status })),
    });
  }

  /** Temp file + rename in the same directory, one write at a time, each with the state at call time. */
  private persist(): Promise<void> {
    const body = `${JSON.stringify(this.job, null, 2)}\n`;
    const write = async (): Promise<void> => {
      const temp = `${this.deps.jobPath}.${this.deps.randomId()}.tmp`;
      await this.deps.writeFile(temp, body);
      await this.deps.rename(temp, this.deps.jobPath);
    };
    const next = this.writing.then(write, write);
    this.writing = next.catch((error: unknown) => {
      console.warn('[fleet-update] job file write failed:', error);
    });
    return this.writing;
  }
}

let singleton: FleetUpdateService | null = null;

/** This dashboard's one update job service. */
export function fleetUpdateService(): FleetUpdateService {
  singleton ??= new FleetUpdateService({
    jobPath: join(getOverdeckHome(), 'fleet-update.json'),
    readFile: (path) => readFile(path, 'utf8'),
    writeFile: (path, data) => writeFile(path, data, 'utf8'),
    rename: (from, to) => rename(from, to),
    detectClis: (opts) => detectHarnessClis(opts),
    readVersion: (binaryPath) => readCliVersion(binaryPath, { refresh: true }),
    runCommand: (argv) => runUpdateCommand(argv),
    countWorkingTurns,
    overdeck: { installMode: currentInstallMode, version: getOverdeckVersion, manager: getUpdateManager },
    restart: restartDashboardDetached,
    emit: (message, details) => emitActivityEntry({ source: 'dashboard', level: 'info', message, details: JSON.stringify(details) }),
    now: () => Date.now(),
    randomId: () => randomUUID(),
  });
  return singleton;
}
