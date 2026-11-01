/**
 * SSH forward supervisor (PAN-4404 WI-5, FR-7, D-4404-10).
 *
 * One instance on the primary dashboard keeps one loopback port forward
 * (`ssh -N -L 127.0.0.1:<lp>:127.0.0.1:<rp> -- <dest>`) running per SSH machine
 * record. The forward carries the machine link's `ssh` route. States:
 *
 *  - `starting`: the forward was spawned and its local port does not accept a
 *    connection yet (15 s budget).
 *  - `up`: the local port accepts connections. After 60 s up, the attempt
 *    counter resets.
 *  - `down`: the forward exited; it is respawned after 1 s doubling to 60 s,
 *    ±20 % jitter.
 *  - `attention`: SSH refused the login or the host key; no retry until the
 *    operator reconnects (`ensure`).
 *
 * A forward that exits because its local port is taken moves to a new free
 * port: the record, the link's `ssh` route (`setLinkRoutes`) and the link
 * supervisor's copy (`updateRoutes`) are updated, and it respawns at once.
 * At start, records without a link (an add that died half-way) are deleted, and
 * a forward left over from a previous dashboard (its recorded pid still runs
 * with `-L 127.0.0.1:<lp>:` on its command line) is sent SIGTERM first.
 *
 * Every dependency is injectable and the loop runs on timers only, so tests
 * drive it with fake timers.
 */
import type { SshForwardState } from '@overdeck/contracts';

import { getLink, type MachineLink, setLinkRoutes } from '../../../lib/anywhere/link-store.js';
import type { LinkRoute } from '../../../lib/anywhere/routes.js';
import {
  listSshMachines,
  removeSshMachine,
  type SshMachinePatch,
  type SshMachineRecord,
  updateSshMachine,
} from '../../../lib/anywhere/ssh/machine-store.js';
import { commandLineOf, pickFreeLoopbackPort, spawnSshForward, waitForLocalPort } from '../../../lib/anywhere/ssh/run.js';
import { classifySshFailure, SshMachineError } from '../../../lib/anywhere/ssh/target.js';

export const FORWARD_READY_TIMEOUT_MS = 15_000;
export const FORWARD_BACKOFF_MIN_MS = 1_000;
export const FORWARD_BACKOFF_CAP_MS = 60_000;
export const FORWARD_BACKOFF_JITTER = 0.2;
export const FORWARD_STABLE_MS = 60_000;
const STDERR_KEEP = 8_192;

/** The parts of a `ChildProcess` the supervisor uses. */
export interface ForwardChild {
  readonly pid?: number;
  readonly stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface SshForwardSupervisorDeps {
  spawnForward: (record: SshMachineRecord) => ForwardChild;
  pickPort: () => Promise<number>;
  waitForPort: (port: number, timeoutMs: number) => Promise<boolean>;
  listRecords: () => Promise<SshMachineRecord[]>;
  removeRecord: (id: string) => Promise<unknown>;
  updateRecord: (id: string, patch: SshMachinePatch) => Promise<SshMachineRecord | null>;
  getLink: (linkId: string) => Promise<MachineLink | null>;
  setLinkRoutes: (linkId: string, routes: LinkRoute[]) => Promise<unknown>;
  /** The link supervisor's `updateRoutes`. */
  updateLinkRoutes: (linkId: string, routes: LinkRoute[]) => void;
  commandLineOf: (pid: number) => Promise<string | null>;
  kill: (pid: number, signal: NodeJS.Signals) => void;
  now: () => number;
  random: () => number;
  log: (message: string) => void;
}

/** Production dependencies; `updateLinkRoutes` is the link supervisor's `updateRoutes`. */
export const defaultSshForwardSupervisorDeps = (
  updateLinkRoutes: (linkId: string, routes: LinkRoute[]) => void,
): SshForwardSupervisorDeps => ({
  spawnForward: (record) => spawnSshForward(record.destination, record.localPort, record.remotePort),
  pickPort: pickFreeLoopbackPort,
  waitForPort: waitForLocalPort,
  listRecords: listSshMachines,
  removeRecord: removeSshMachine,
  updateRecord: updateSshMachine,
  getLink,
  setLinkRoutes,
  updateLinkRoutes,
  commandLineOf,
  kill: (pid, signal) => process.kill(pid, signal),
  now: () => Date.now(),
  random: () => Math.random(),
  log: (message) => console.warn(`[ssh-machines] ${message}`),
});

interface Entry {
  record: SshMachineRecord;
  child: ForwardChild | null;
  state: SshForwardState;
  detail: string | null;
  attempts: number;
  stderr: string;
  retryTimer: ReturnType<typeof setTimeout> | null;
  stableTimer: ReturnType<typeof setTimeout> | null;
  /** Resolves when the current attempt is up (true) or failed (false); a port move follows the next attempt. */
  ready: Promise<boolean>;
  /** The error that put the entry in `attention`. */
  failure: SshMachineError | null;
}

const PORT_TAKEN = /Address already in use|cannot listen to port/;

export class SshForwardSupervisor {
  private readonly entries = new Map<string, Entry>();
  private stopped = false;

  constructor(private readonly deps: SshForwardSupervisorDeps) {}

  /** Drop half-added records, reap orphaned forwards, then start one forward per record. */
  async start(): Promise<void> {
    const records = await this.deps.listRecords();
    for (const record of records) {
      if (record.linkId === null) {
        this.deps.log(`removing the unfinished SSH machine ${record.destination} (its add never completed)`);
        await this.deps.removeRecord(record.id).catch((error: Error) => this.deps.log(`could not remove ${record.destination}: ${error.message}`));
        continue;
      }
      await this.reapOrphan(record);
      if (this.stopped) return;
      this.launch(this.entryFor(record));
    }
  }

  /** Start or restart the forward of `recordId` and wait until its port accepts connections. */
  async ensure(recordId: string): Promise<void> {
    const record = (await this.deps.listRecords()).find((r) => r.id === recordId);
    if (!record) throw new SshMachineError('not-found', `No SSH machine record ${recordId}`);
    const existing = this.entries.get(recordId);
    if (existing) this.halt(existing);
    const entry = this.entryFor(record);
    this.launch(entry);
    // A port collision respawns on a new port; `ready` follows that attempt.
    if (await entry.ready) return;
    if (entry.state === 'attention' && entry.failure) throw entry.failure;
    throw new SshMachineError(
      'forward-failed',
      `The SSH port forward to ${record.destination} did not come up${entry.detail ? `: ${entry.detail}` : '.'}`,
      { destination: record.destination },
    );
  }

  /** Stop the forward of `recordId`; no respawn follows. */
  async stopForward(recordId: string): Promise<void> {
    const entry = this.entries.get(recordId);
    if (!entry) return;
    this.halt(entry);
    this.entries.delete(recordId);
    await this.deps.updateRecord(recordId, { forwardPid: null }).catch(() => null);
  }

  status(recordId: string): { forward: SshForwardState; detail: string | null } {
    const entry = this.entries.get(recordId);
    return entry ? { forward: entry.state, detail: entry.detail } : { forward: 'down', detail: null };
  }

  /** Stop every forward (dashboard shutdown). */
  stop(): void {
    this.stopped = true;
    for (const entry of this.entries.values()) this.halt(entry);
    this.entries.clear();
  }

  private entryFor(record: SshMachineRecord): Entry {
    const entry: Entry = {
      record,
      child: null,
      state: 'starting',
      detail: null,
      attempts: 0,
      stderr: '',
      retryTimer: null,
      stableTimer: null,
      ready: Promise.resolve(false),
      failure: null,
    };
    this.entries.set(record.id, entry);
    return entry;
  }

  private async reapOrphan(record: SshMachineRecord): Promise<void> {
    if (record.forwardPid === null) return;
    const commandLine = await this.deps.commandLineOf(record.forwardPid).catch(() => null);
    if (!commandLine?.includes(`-L 127.0.0.1:${record.localPort}:`)) return;
    try {
      this.deps.kill(record.forwardPid, 'SIGTERM');
      this.deps.log(`stopped the leftover SSH forward ${record.forwardPid} to ${record.destination}`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ESRCH' && code !== 'EPERM') throw error;
    }
  }

  /** Kill the current child and cancel timers without scheduling anything. */
  private halt(entry: Entry): void {
    this.clearTimers(entry);
    const child = entry.child;
    entry.child = null;
    if (child) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }

  private clearTimers(entry: Entry): void {
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    if (entry.stableTimer) clearTimeout(entry.stableTimer);
    entry.retryTimer = null;
    entry.stableTimer = null;
  }

  private launch(entry: Entry): void {
    if (this.stopped || this.entries.get(entry.record.id) !== entry) return;
    this.clearTimers(entry);
    entry.state = 'starting';
    entry.detail = null;
    entry.failure = null;
    entry.stderr = '';
    let resolveReady: (ok: boolean) => void = () => undefined;
    entry.ready = new Promise<boolean>((resolve) => {
      resolveReady = resolve;
    });
    let child: ForwardChild;
    try {
      child = this.deps.spawnForward(entry.record);
    } catch (error) {
      entry.child = null;
      this.handleExit(entry, null, `could not start ssh: ${(error as Error).message}`, resolveReady);
      return;
    }
    entry.child = child;
    let finished = false;
    const onEnd = (code: number | null, problem: string | null): void => {
      if (finished) return;
      finished = true;
      if (entry.child !== child) {
        resolveReady(false);
        return;
      }
      entry.child = null;
      this.handleExit(entry, code, problem, resolveReady);
    };
    child.stderr?.on('data', (chunk) => {
      entry.stderr = `${entry.stderr}${chunk.toString()}`.slice(-STDERR_KEEP);
    });
    child.once('exit', (code) => onEnd(code, null));
    child.once('error', (error) => onEnd(null, `could not start ssh: ${error.message}`));

    if (child.pid !== undefined) {
      const pid = child.pid;
      entry.record = { ...entry.record, forwardPid: pid };
      void this.deps.updateRecord(entry.record.id, { forwardPid: pid }).catch((error: Error) =>
        this.deps.log(`could not record the SSH forward pid for ${entry.record.destination}: ${error.message}`),
      );
    }

    void this.deps.waitForPort(entry.record.localPort, FORWARD_READY_TIMEOUT_MS).then((ok) => {
      if (finished || entry.child !== child) return;
      if (!ok) {
        entry.detail = `the forwarded port ${entry.record.localPort} did not open within ${FORWARD_READY_TIMEOUT_MS / 1000} s`;
        resolveReady(false);
        // The exit handler schedules the retry.
        child.kill('SIGTERM');
        return;
      }
      entry.state = 'up';
      entry.detail = null;
      entry.stableTimer = setTimeout(() => {
        entry.stableTimer = null;
        entry.attempts = 0;
      }, FORWARD_STABLE_MS);
      resolveReady(true);
    });
  }

  private handleExit(entry: Entry, code: number | null, problem: string | null, resolveReady: (ok: boolean) => void): void {
    this.clearTimers(entry);
    if (this.stopped || this.entries.get(entry.record.id) !== entry) {
      resolveReady(false);
      return;
    }
    const stderr = entry.stderr;
    const classified = classifySshFailure(code, stderr, { destination: entry.record.destination });
    if (classified.code === 'auth-failed' || classified.code === 'host-key') {
      entry.state = 'attention';
      entry.detail = classified.message;
      entry.failure = classified;
      this.deps.log(`SSH forward to ${entry.record.destination} needs attention: ${classified.message}`);
      resolveReady(false);
      return;
    }
    if (PORT_TAKEN.test(stderr)) {
      entry.state = 'starting';
      const previous = entry.ready;
      void this.movePort(entry)
        .then(() => (entry.ready === previous ? false : entry.ready))
        .then(resolveReady);
      return;
    }
    resolveReady(false);
    entry.state = 'down';
    const lastLine = stderr.trim().split(/\r?\n/).at(-1);
    entry.detail = problem ?? entry.detail ?? (lastLine ? lastLine : `ssh exited${code === null ? '' : ` with code ${code}`}`);
    const base = Math.min(FORWARD_BACKOFF_MIN_MS * 2 ** entry.attempts, FORWARD_BACKOFF_CAP_MS);
    const jitter = 1 + (this.deps.random() * 2 - 1) * FORWARD_BACKOFF_JITTER;
    const delay = Math.min(Math.round(base * jitter), FORWARD_BACKOFF_CAP_MS);
    entry.attempts += 1;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      this.launch(entry);
    }, delay);
  }

  /** The local port was taken: pick another, persist it everywhere, respawn at once. */
  private async movePort(entry: Entry): Promise<void> {
    const oldPort = entry.record.localPort;
    try {
      const port = await this.deps.pickPort();
      if (this.entries.get(entry.record.id) !== entry) return;
      const fresh = (await this.deps.listRecords()).find((r) => r.id === entry.record.id) ?? entry.record;
      entry.record = { ...fresh, localPort: port };
      await this.deps.updateRecord(entry.record.id, { localPort: port });
      if (entry.record.linkId !== null) {
        const link = await this.deps.getLink(entry.record.linkId);
        if (link) {
          const oldUrl = `tcp://127.0.0.1:${oldPort}`;
          const routes = link.routes.map((route) =>
            route.kind === 'ssh' && route.url === oldUrl ? { ...route, url: `tcp://127.0.0.1:${port}` } : route,
          );
          await this.deps.setLinkRoutes(link.id, routes);
          this.deps.updateLinkRoutes(link.id, routes);
        }
      }
      this.deps.log(`SSH forward to ${entry.record.destination} moved from port ${oldPort} to ${port}`);
    } catch (error) {
      this.deps.log(`could not move the SSH forward to ${entry.record.destination} off port ${oldPort}: ${(error as Error).message}`);
    }
    this.launch(entry);
  }
}
