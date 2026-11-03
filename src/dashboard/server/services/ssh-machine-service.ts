/**
 * SSH machine service (PAN-4404 WI-7, FR-1, FR-2, FR-5, FR-6, FR-8, FR-9).
 *
 * Orchestrates SSH machines on the linking server:
 *
 *  - `addSshMachine` runs the add flow of D-4404-3: validate the destination
 *    and take the local host lock; probe `pan --version` on the host (it must
 *    equal ours); run `ssh-helper start` there (adopt or `pan up`, plus a pairing
 *    credential); write a provisional record (`linkId: null`); start the port
 *    forward; link over `tcp://127.0.0.1:<lp>` with `kind: 'ssh'`; then set the
 *    record's link id and drop any older record for the same machine. A failure
 *    after the provisional record stops the forward, deletes the record and, when
 *    the helper started the host's server, stops it again.
 *  - `testSshHost` runs only the version probe (FR-9).
 *  - `removeSshMachineForLink` stops the host's server only for a `managed`
 *    record when the operator did not ask to keep it (FR-5), then stops the
 *    forward and deletes the record; the caller removes the link itself.
 *  - `reconnectSshMachine` restarts the forward and re-runs start-or-adopt
 *    without pairing (FR-8).
 *
 * The local host lock is in-process and keyed by the normalized destination: a
 * second operation for the same host while one runs fails at once with `busy`.
 * The forward supervisor runs only on the primary dashboard and registers here
 * at boot (`setSshForwardSupervisor`). Every dependency is injectable.
 */
import { randomUUID } from 'node:crypto';

import { type LinkAccess, type MachineLinkView, overdeckInstallCommand, type SshLinkInfo, type SshMachineErrorCode, type SshTestResult } from '@overdeck/contracts';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import {
  getSshMachineByLinkId,
  listSshMachines,
  removeSshMachine,
  type SshMachinePatch,
  type SshMachineRecord,
  updateSshMachine,
  upsertSshMachine,
} from '../../../lib/anywhere/ssh/machine-store.js';
import { pickFreeLoopbackPort, runSshCommand, type SshRunOptions, type SshRunResult } from '../../../lib/anywhere/ssh/run.js';
import {
  classifySshFailure,
  type HelperFailure,
  type HelperStartResult,
  type HelperStopReason,
  parseHelperResult,
  parseVersionOutput,
  remoteCommand,
  type RemoteOp,
  SshMachineError,
  sshLockKey,
  validatePanPath,
  validateSshDestination,
} from '../../../lib/anywhere/ssh/target.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { getOverdeckVersion } from '../routes/misc/shared.js';
import { createMachineLink } from './machine-link-service.js';
import type { SshForwardSupervisor } from './ssh-forward-supervisor.js';

/** HTTP status of each SSH machine error (D-4404-9). */
export const SSH_MACHINE_ERROR_STATUS: Record<SshMachineErrorCode, number> = {
  'bad-destination': 400,
  'busy': 409,
  'unresolvable': 502,
  'unreachable': 502,
  'host-key': 409,
  'auth-failed': 401,
  'pan-missing': 424,
  'version-mismatch': 409,
  'helper-failed': 502,
  'start-failed': 502,
  'forward-failed': 502,
  'self-link': 409,
  'not-found': 404,
};

export const VERSION_PROBE_TIMEOUT_MS = 20_000;
export const HELPER_START_TIMEOUT_MS = 150_000;
// D-4861-6: lock wait 30 s + supervisor stop and probe + dashboard grace 10 s.
export const HELPER_STOP_TIMEOUT_MS = 60_000;

/** The parts of the forward supervisor the service uses. */
export type SshForwards = Pick<SshForwardSupervisor, 'ensure' | 'stopForward' | 'status'>;

export interface SshMachineServiceDeps {
  runSsh: (dest: string, remoteCmd: string, options: SshRunOptions) => Promise<SshRunResult>;
  createMachineLink: (input: Parameters<typeof createMachineLink>[0]) => Promise<{ link: MachineLink; view: MachineLinkView }>;
  listRecords: () => Promise<SshMachineRecord[]>;
  getRecordByLinkId: (linkId: string) => Promise<SshMachineRecord | null>;
  upsertRecord: (record: SshMachineRecord) => Promise<unknown>;
  updateRecord: (id: string, patch: SshMachinePatch) => Promise<SshMachineRecord | null>;
  removeRecord: (id: string) => Promise<unknown>;
  pickPort: () => Promise<number>;
  supervisor: () => SshForwards | null;
  localIdentity: () => Promise<{ environmentId: string; label: string }>;
  localVersion: () => Promise<string>;
  newId: () => string;
  now: () => string;
  log: (message: string) => void;
}

let registeredSupervisor: SshForwards | null = null;

/** Boot registers the primary dashboard's forward supervisor here (null on shutdown). */
export function setSshForwardSupervisor(supervisor: SshForwards | null): void {
  registeredSupervisor = supervisor;
}

const defaultDeps: SshMachineServiceDeps = {
  runSsh: (dest, remoteCmd, options) => runSshCommand(dest, remoteCmd, options),
  createMachineLink: (input) => createMachineLink(input),
  listRecords: listSshMachines,
  getRecordByLinkId: getSshMachineByLinkId,
  upsertRecord: upsertSshMachine,
  updateRecord: updateSshMachine,
  removeRecord: removeSshMachine,
  pickPort: pickFreeLoopbackPort,
  supervisor: () => registeredSupervisor,
  localIdentity: async () => {
    const identity = await ensureEnvironmentIdentity();
    return { environmentId: identity.environmentId, label: identity.label };
  },
  localVersion: getOverdeckVersion,
  newId: randomUUID,
  now: () => new Date().toISOString(),
  log: (message) => console.warn(`[ssh-machines] ${message}`),
};

// ── Local host lock ───────────────────────────────────────────────────────

const hostLocks = new Set<string>();

async function withHostLock<T>(dest: string, run: () => Promise<T>): Promise<T> {
  const key = sshLockKey(dest);
  if (hostLocks.has(key)) {
    throw new SshMachineError('busy', `Another add, remove or reconnect for ${dest} is running; try again when it finishes.`, { destination: dest });
  }
  hostLocks.add(key);
  try {
    return await run();
  } finally {
    hostLocks.delete(key);
  }
}

// ── SSH steps ─────────────────────────────────────────────────────────────

function requireSupervisor(deps: SshMachineServiceDeps): SshForwards {
  const supervisor = deps.supervisor();
  if (!supervisor) {
    throw new SshMachineError('forward-failed', 'SSH machines are run by the primary dashboard (pan up); this server does not keep SSH forwards.');
  }
  return supervisor;
}

function versionMismatch(dest: string, remote: string, local: string): SshMachineError {
  return new SshMachineError(
    'version-mismatch',
    `${dest} has pan ${remote} and this machine has ${local}. Install the same version there with: ${overdeckInstallCommand(local)}`,
    { destination: dest, remoteVersion: remote, localVersion: local },
  );
}

/** Run `pan --version` on the host. Throws the classified failure; returns the version. */
async function probeVersion(deps: SshMachineServiceDeps, dest: string, panPath: string | null, localVersion: string): Promise<string> {
  const result = await deps.runSsh(dest, remoteCommand({ pan: panPath, op: 'version' }), { timeoutMs: VERSION_PROBE_TIMEOUT_MS });
  if (result.exitCode !== 0) throw classifySshFailure(result.exitCode, result.stderr, { destination: dest, localVersion });
  const version = parseVersionOutput(result.stdout);
  if (version === null) {
    throw new SshMachineError('helper-failed', `pan --version on ${dest} printed no version.`, { destination: dest, stdout: result.stdout.slice(-500) });
  }
  return version;
}

function helperFailure(dest: string, failure: HelperFailure): SshMachineError {
  const code: SshMachineErrorCode = failure.error === 'busy' || failure.error === 'start-failed' ? failure.error : 'helper-failed';
  return new SshMachineError(code, `${dest}: ${failure.message}`, { destination: dest, helperError: failure.error });
}

/** Run `pan machines ssh-helper <op>` on the host and return its parsed result line. */
async function runHelper(
  deps: SshMachineServiceDeps,
  dest: string,
  panPath: string | null,
  op: Exclude<RemoteOp, 'version'>,
  linker: string,
  localVersion: string,
): Promise<ReturnType<typeof parseHelperResult>> {
  const timeoutMs = op === 'stop' ? HELPER_STOP_TIMEOUT_MS : HELPER_START_TIMEOUT_MS;
  const result = await deps.runSsh(dest, remoteCommand({ pan: panPath, op, linker }), { timeoutMs });
  const parsed = parseHelperResult(result.stdout);
  if (parsed === null) {
    if (result.exitCode !== 0) throw classifySshFailure(result.exitCode, result.stderr, { destination: dest, localVersion });
    throw new SshMachineError('helper-failed', `The SSH helper on ${dest} printed no result.`, { destination: dest });
  }
  return parsed;
}

async function runHelperStart(
  deps: SshMachineServiceDeps,
  dest: string,
  panPath: string | null,
  linker: string,
  localVersion: string,
  pair: boolean,
): Promise<HelperStartResult> {
  const result = await runHelper(deps, dest, panPath, pair ? 'start' : 'start-no-pair', linker, localVersion);
  if (result === null) throw new SshMachineError('helper-failed', `The SSH helper on ${dest} printed no result.`);
  if (!result.ok) throw helperFailure(dest, result);
  if (result.op !== 'start') throw new SshMachineError('helper-failed', `The SSH helper on ${dest} answered a ${result.op} result to start.`);
  return result;
}

export interface SshRemoval {
  stopped: boolean;
  /** The helper's stop reason; `kept` when the operator kept the server; `stop-failed` when the stop could not run. */
  reason: HelperStopReason | 'kept' | 'stop-failed';
}

/** Run `ssh-helper stop` (best effort): never throws. */
async function stopRemoteServer(
  deps: SshMachineServiceDeps,
  record: Pick<SshMachineRecord, 'destination' | 'panPath'>,
  linker: string,
  localVersion: string,
): Promise<SshRemoval> {
  try {
    const result = await runHelper(deps, record.destination, record.panPath, 'stop', linker, localVersion);
    if (result?.ok && result.op === 'stop') return { stopped: result.stopped, reason: result.reason };
    deps.log(`ssh-helper stop on ${record.destination} failed: ${result && !result.ok ? result.message : 'unexpected result'}`);
  } catch (error) {
    deps.log(`ssh-helper stop on ${record.destination} failed: ${(error as Error).message}`);
  }
  return { stopped: false, reason: 'stop-failed' };
}

function forwardInfo(deps: SshMachineServiceDeps, record: SshMachineRecord): SshLinkInfo {
  const status = deps.supervisor()?.status(record.id) ?? { forward: 'down' as const, detail: null };
  return {
    destination: record.destination,
    launch: record.launch,
    forward: status.forward,
    forwardDetail: status.detail,
    localPort: record.localPort,
    remotePort: record.remotePort,
  };
}

// ── Public operations ─────────────────────────────────────────────────────

export interface AddSshMachineInput {
  host: string;
  panPath?: string | null;
  bothWays?: boolean;
  access?: LinkAccess;
}

/** D-4404-3: link the machine at `host` over SSH. Returns the new link and its view with an `ssh` block. */
export async function addSshMachine(
  input: AddSshMachineInput,
  overrides: Partial<SshMachineServiceDeps> = {},
): Promise<{ link: MachineLink; view: MachineLinkView; record: SshMachineRecord }> {
  const deps = { ...defaultDeps, ...overrides };
  const dest = validateSshDestination(input.host);
  const panPath = input.panPath ? validatePanPath(input.panPath) : null;
  return withHostLock(dest, async () => {
    const supervisor = requireSupervisor(deps);
    const localVersion = await deps.localVersion();
    const remoteVersion = await probeVersion(deps, dest, panPath, localVersion);
    if (remoteVersion !== localVersion) throw versionMismatch(dest, remoteVersion, localVersion);

    const ours = await deps.localIdentity();
    const helper = await runHelperStart(deps, dest, panPath, ours.environmentId, localVersion, true);
    if (helper.environmentId === ours.environmentId) {
      if (helper.launch === 'managed') await stopRemoteServer(deps, { destination: dest, panPath }, ours.environmentId, localVersion);
      throw new SshMachineError('self-link', `${dest} is this machine (same environment id); a machine cannot link to itself.`, { destination: dest });
    }
    if (!helper.pairing) throw new SshMachineError('helper-failed', `The SSH helper on ${dest} returned no pairing credential.`);

    const provisional: SshMachineRecord = {
      id: deps.newId(),
      destination: dest,
      linkId: null,
      environmentId: helper.environmentId,
      localPort: await deps.pickPort(),
      remotePort: helper.apiPort,
      launch: helper.launch,
      panPath,
      forwardPid: null,
      addedAt: deps.now(),
    };
    await deps.upsertRecord(provisional);

    let link: MachineLink;
    let view: MachineLinkView;
    let record: SshMachineRecord;
    try {
      await supervisor.ensure(provisional.id);
      // A port collision during the first start may have moved the forward.
      const current = (await deps.listRecords()).find((r) => r.id === provisional.id) ?? provisional;
      ({ link, view } = await deps.createMachineLink({
        transport: { url: `tcp://127.0.0.1:${current.localPort}`, kind: 'ssh', pairingCode: helper.pairing.credential },
        bothWays: input.bothWays ?? true,
        access: input.access ?? 'operator',
      }));
      record = (await deps.updateRecord(provisional.id, { linkId: link.id, environmentId: link.environmentId })) ?? {
        ...current,
        linkId: link.id,
      };
    } catch (error) {
      await supervisor.stopForward(provisional.id).catch(() => undefined);
      await Promise.resolve(deps.removeRecord(provisional.id)).catch(() => undefined);
      if (helper.launch === 'managed') await stopRemoteServer(deps, { destination: dest, panPath }, ours.environmentId, localVersion);
      throw error;
    }

    // Re-adding a machine replaces it (D-4645-18): drop older records for it; never stop their server.
    for (const older of await deps.listRecords()) {
      if (older.id === record.id || older.environmentId !== record.environmentId) continue;
      await supervisor.stopForward(older.id).catch(() => undefined);
      await deps.removeRecord(older.id);
    }

    return { link, view: { ...view, ssh: forwardInfo(deps, record) }, record };
  });
}

/** FR-9: reach the host and compare its pan version. Never starts, stops or pairs anything. */
export async function testSshHost(
  input: { host: string; panPath?: string | null },
  overrides: Partial<SshMachineServiceDeps> = {},
): Promise<SshTestResult> {
  const deps = { ...defaultDeps, ...overrides };
  const dest = validateSshDestination(input.host);
  const panPath = input.panPath ? validatePanPath(input.panPath) : null;
  return withHostLock(dest, async () => {
    const localVersion = await deps.localVersion();
    try {
      const panVersion = await probeVersion(deps, dest, panPath, localVersion);
      if (panVersion !== localVersion) {
        const mismatch = versionMismatch(dest, panVersion, localVersion);
        return { reachable: true, panVersion, localVersion, versionMatches: false, error: mismatch.code, message: mismatch.message };
      }
      return { reachable: true, panVersion, localVersion, versionMatches: true, error: null, message: null };
    } catch (error) {
      if (!(error instanceof SshMachineError)) throw error;
      const unreached: SshMachineErrorCode[] = ['host-key', 'auth-failed', 'unresolvable', 'unreachable'];
      return {
        reachable: !unreached.includes(error.code),
        panVersion: null,
        localVersion,
        versionMatches: false,
        error: error.code,
        message: error.message,
      };
    }
  });
}

/**
 * FR-5: tear down the SSH side of `link` before the caller removes the link.
 * Null when the link is not SSH-backed.
 */
export async function removeSshMachineForLink(
  link: Pick<MachineLink, 'id'>,
  options: { keepServer: boolean },
  overrides: Partial<SshMachineServiceDeps> = {},
): Promise<SshRemoval | null> {
  const deps = { ...defaultDeps, ...overrides };
  const record = await deps.getRecordByLinkId(link.id);
  if (!record) return null;
  return withHostLock(record.destination, async () => {
    let removal: SshRemoval;
    if (record.launch === 'managed' && !options.keepServer) {
      const ours = await deps.localIdentity();
      removal = await stopRemoteServer(deps, record, ours.environmentId, await deps.localVersion());
    } else {
      removal = { stopped: false, reason: options.keepServer ? 'kept' : 'external' };
    }
    await deps.supervisor()?.stopForward(record.id);
    await deps.removeRecord(record.id);
    return removal;
  });
}

/** FR-8: restart the forward and re-run start-or-adopt without pairing. Null when the link is not SSH-backed. */
export async function reconnectSshMachine(
  link: Pick<MachineLink, 'id'>,
  overrides: Partial<SshMachineServiceDeps> = {},
): Promise<SshLinkInfo | null> {
  const deps = { ...defaultDeps, ...overrides };
  const record = await deps.getRecordByLinkId(link.id);
  if (!record) return null;
  return withHostLock(record.destination, async () => {
    const supervisor = requireSupervisor(deps);
    await supervisor.ensure(record.id);
    const ours = await deps.localIdentity();
    const helper = await runHelperStart(deps, record.destination, record.panPath, ours.environmentId, await deps.localVersion(), false);
    const updated = helper.launch === record.launch ? record : ((await deps.updateRecord(record.id, { launch: helper.launch })) ?? record);
    const current = (await deps.listRecords()).find((r) => r.id === record.id) ?? updated;
    return forwardInfo(deps, current);
  });
}

/** FR-11: the `ssh` block of a link view, or undefined when the link is not SSH-backed. */
export async function sshInfoForLink(linkId: string, overrides: Partial<SshMachineServiceDeps> = {}): Promise<SshLinkInfo | undefined> {
  const deps = { ...defaultDeps, ...overrides };
  const record = await deps.getRecordByLinkId(linkId);
  return record ? forwardInfo(deps, record) : undefined;
}
