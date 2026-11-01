/**
 * Fly machines (PAN-4652 WI-8, FR-8, FR-12, FR-13).
 *
 * `addFlyMachine()` is the one door that starts a Fly VM as a linked machine:
 * the CLI and `POST /api/machines/fly` call it today, and the Machine field and
 * `--machine fly` (#4651) will call it too. It refuses early (remote disabled,
 * no Fly token, a harness other than Claude Code, the spend cap) before any VM
 * exists, provisions the VM (`provisionFlyMachine`), writes a provisional
 * record, links home → VM one way over the public route (D-2, D-3), then
 * patches the record with the link.
 *
 * The record is written the moment the VM exists, before any step that can fail
 * after it. Any failure destroys the VM, removes the link if one was made and
 * deletes the record before rethrowing: a machine left behind costs money and is
 * a bug. When the destroy itself fails, the record stays, so the deacon's sweep
 * destroys the VM later ("provisioning never linked it").
 *
 * `notifyLinksChanged` is a required argument, not a default: the link
 * supervisor must pick the new link up before anything sends a request through
 * it, and its notifier lives in `routes/machines.ts`, which imports this module
 * for the unlink hook.
 *
 * With `projectKey` it clones that project onto the VM (`ensureFlyProject`,
 * FR-9); with `message` it then starts a Claude Code conversation there through
 * the link (`startFlyConversation`, FR-10) and returns its `/conv/@<env>/<name>`
 * path. The clone runs after linking, so by the time the conversation request
 * goes out the supervisor has long had the link online.
 *
 * `removeFlyMachineForLink()` is the unlink hook: it destroys the VM unless
 * `keepServer` and always deletes the record (D-9: destroy, never stop).
 */
import { randomUUID } from 'node:crypto';

import { getHarnessBehavior, type MachineLinkView, normalizeHarnessName } from '@overdeck/contracts';

import { linkFetch } from '../../../lib/anywhere/link-client.js';
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { removeLink } from '../../../lib/anywhere/link-store.js';
import {
  countFlyMachines,
  type FlyMachineRecord,
  getFlyMachineByLinkId,
  removeFlyMachine,
  updateFlyMachine,
  upsertFlyMachine,
} from '../../../lib/anywhere/fly/machine-store.js';
import { ensureFlyProject } from '../../../lib/anywhere/fly/project.js';
import { destroyFlyVm, type FlyCreatedMachine, FlyMachineError, type FlyProvisionResult, provisionFlyMachine } from '../../../lib/anywhere/fly/provision.js';
import { loadConfig, type RemoteConfig } from '../../../lib/config.js';
import { createFlyApiClient } from '../../../lib/remote/fly-api.js';
import { checkRemoteSpendCap } from '../../../lib/remote/remote-agents.js';
import { createMachineLink, MachineLinkError } from './machine-link-service.js';

export interface AddFlyMachineInput {
  projectKey?: string;
  message?: string;
  harness?: string;
  model?: string;
  effort?: string;
  region?: string;
  image?: string;
}

export interface FlyConversation {
  environmentId: string;
  name: string;
  path: string;
}

export interface AddFlyMachineResult {
  link: MachineLinkView;
  record: FlyMachineRecord;
  conversation?: FlyConversation;
}

export interface FlyRemoval {
  destroyed: boolean;
}

export interface FlyMachineServiceDeps {
  loadConfig: () => Promise<{ remote?: RemoteConfig }>;
  hasFlyToken: (remote: RemoteConfig | undefined) => boolean;
  /** The spend cap, counting `pending` adds that passed it but have no record yet. */
  checkCap: (config: { remote?: RemoteConfig }, pending: number) => { allowed: boolean; message?: string };
  /** `onCreated` runs as soon as the VM exists, before any step that can fail after it. */
  provision: (input: { region?: string; image?: string }, onCreated: (machine: FlyCreatedMachine) => Promise<void>) => Promise<FlyProvisionResult>;
  destroy: (appName: string, machineId: string) => Promise<void>;
  createMachineLink: (input: Parameters<typeof createMachineLink>[0]) => Promise<{ link: MachineLink; view: MachineLinkView }>;
  removeLink: (id: string) => Promise<unknown>;
  getRecordByLinkId: (linkId: string) => Promise<FlyMachineRecord | null>;
  upsertRecord: (record: FlyMachineRecord) => Promise<unknown>;
  updateRecord: (id: string, patch: Partial<Omit<FlyMachineRecord, 'id'>>) => Promise<FlyMachineRecord | null>;
  removeRecord: (id: string) => Promise<unknown>;
  ensureProject: (machine: { appName: string; machineId: string }, projectKey: string) => Promise<void>;
  linkFetch: (environmentId: string, path: string, init: { method: string; actor: 'operator'; body: unknown }) => Promise<{ status: number; json: unknown }>;
  /** Wake the link supervisor so it opens the new link now (see the header). */
  notifyLinksChanged: () => void;
  newId: () => string;
  now: () => string;
  log: (message: string) => void;
}

const defaultDeps: Omit<FlyMachineServiceDeps, 'notifyLinksChanged'> = {
  loadConfig,
  hasFlyToken: (remote) => {
    try {
      createFlyApiClient(process.env[remote?.fly?.api_token_env ?? 'FLY_API_TOKEN']);
      return true;
    } catch {
      return false;
    }
  },
  checkCap: (config, pending) => checkRemoteSpendCap(config, { countFlyMachines: () => countFlyMachines() + pending }),
  provision: (input, onCreated) => provisionFlyMachine(input, {}, { onCreated }),
  destroy: (appName, machineId) => destroyFlyVm(appName, machineId),
  createMachineLink: (input) => createMachineLink(input),
  removeLink,
  getRecordByLinkId: getFlyMachineByLinkId,
  upsertRecord: upsertFlyMachine,
  updateRecord: updateFlyMachine,
  removeRecord: removeFlyMachine,
  ensureProject: (machine, projectKey) => ensureFlyProject(machine, projectKey),
  linkFetch: (environmentId, path, init) => linkFetch(environmentId, path, init),
  newId: randomUUID,
  now: () => new Date().toISOString(),
  log: (message) => console.warn(`[fly-machines] ${message}`),
};

/**
 * Adds that passed the spend cap and have no record yet. Provisioning takes
 * minutes before the record exists, so without this two concurrent adds would
 * both pass a cap with one free slot. The check and the increment run in one
 * synchronous step, so no other add can pass in between.
 */
let pendingProvisions = 0;

/** D-10: the Machines API cannot allocate the app's public IPs; the operator does it once. */
function publicIpHint(appName: string): string {
  return `Home could not reach the Fly machine at ${appName}.fly.dev. If this app has no public IPs yet, run once: fly ips allocate-v4 --shared -a ${appName} && fly ips allocate-v6 -a ${appName}`;
}

/** The early refusals: nothing is created when any of these fires. */
async function refuseEarly(input: AddFlyMachineInput, deps: FlyMachineServiceDeps): Promise<void> {
  const config = await deps.loadConfig();
  if (config.remote?.enabled !== true) {
    throw new FlyMachineError('remote-disabled', 'Fly machines need remote.enabled: true in the Overdeck config.');
  }
  if (!deps.hasFlyToken(config.remote)) {
    throw new FlyMachineError('no-fly-token', 'No Fly API token: run `fly auth login`, or set FLY_API_TOKEN (or the variable remote.fly.api_token_env names).');
  }
  const harness = input.harness === undefined ? undefined : normalizeHarnessName(input.harness);
  if (harness === null || (harness !== undefined && !getHarnessBehavior(harness).capabilities.runsOnFlyMachine)) {
    throw new FlyMachineError('harness-unsupported', `Fly machines run Claude Code only; ${input.harness} is not supported yet (#4296).`, { harness: input.harness });
  }
  if (input.message !== undefined && !input.projectKey) {
    throw new FlyMachineError('bad-request', 'A message needs a project: pass projectKey (--project) with it.');
  }
  const cap = deps.checkCap(config, pendingProvisions);
  if (!cap.allowed) throw new FlyMachineError('cap-reached', cap.message ?? 'The remote spend cap is reached.');
  pendingProvisions += 1;
}

export async function addFlyMachine(
  input: AddFlyMachineInput,
  overrides: Partial<FlyMachineServiceDeps> & Pick<FlyMachineServiceDeps, 'notifyLinksChanged'>,
): Promise<AddFlyMachineResult> {
  const deps: FlyMachineServiceDeps = { ...defaultDeps, ...overrides };
  await refuseEarly(input, deps);
  // The reserved cap slot is released once the record exists (it counts from then on) or on failure.
  let reserved = true;
  const release = (): void => {
    if (reserved) pendingProvisions -= 1;
    reserved = false;
  };
  try {
    return await provisionAndLink(input, deps, release);
  } finally {
    release();
  }
}

async function provisionAndLink(input: AddFlyMachineInput, deps: FlyMachineServiceDeps, release: () => void): Promise<AddFlyMachineResult> {
  const recordId = deps.newId();
  let machine: FlyCreatedMachine | null = null;
  let vm: FlyProvisionResult;
  try {
    vm = await deps.provision({ region: input.region, image: input.image }, async (createdMachine) => {
      machine = createdMachine;
      await deps.upsertRecord({
        id: recordId,
        linkId: null,
        environmentId: null,
        machineId: createdMachine.machineId,
        machineName: createdMachine.machineName,
        appName: createdMachine.appName,
        region: createdMachine.region,
        label: `fly-${createdMachine.machineId}`,
        projectKey: input.projectKey ?? null,
        docker: false,
        createdAt: deps.now(),
      });
      release(); // the record counts toward the cap from here on
    });
  } catch (error) {
    // Provisioning already tried to destroy its VM; this destroy settles whether the record may go.
    if (machine) await rollback(deps, machine, recordId, null);
    throw error;
  }

  let linkId: string | null = null;
  try {
    let created: { link: MachineLink; view: MachineLinkView };
    try {
      created = await deps.createMachineLink({
        transport: { url: vm.routeUrl, kind: 'public', pairingCode: vm.pairingCode },
        bothWays: false,
        access: 'operator',
      });
    } catch (error) {
      if (error instanceof MachineLinkError && error.code === 'unreachable') {
        throw new FlyMachineError('unreachable', `${error.message}. ${publicIpHint(vm.appName)}`, { appName: vm.appName });
      }
      throw error;
    }
    linkId = created.link.id;

    const record = await deps.updateRecord(recordId, { linkId, environmentId: created.link.environmentId, docker: vm.docker });
    if (!record) throw new Error(`The Fly machine record ${recordId} disappeared while linking`);
    deps.notifyLinksChanged();

    if (!input.projectKey) return { link: created.view, record };
    await deps.ensureProject({ appName: vm.appName, machineId: vm.machineId }, input.projectKey);
    if (input.message === undefined) return { link: created.view, record };
    const conversation = await startFlyConversation(created.link, {
      message: input.message,
      projectKey: input.projectKey,
      model: input.model,
      effort: input.effort,
    }, deps);
    return { link: created.view, record, conversation };
  } catch (error) {
    await rollback(deps, vm, recordId, linkId);
    throw error;
  }
}

/** Start a Claude Code conversation on the linked VM, acting as the operator (FR-10). */
export async function startFlyConversation(
  link: Pick<MachineLink, 'environmentId'>,
  input: { message: string; projectKey: string; model?: string; effort?: string },
  deps: Pick<FlyMachineServiceDeps, 'linkFetch'> = defaultDeps,
): Promise<FlyConversation> {
  const body = { message: input.message, projectKey: input.projectKey, harness: 'claude-code', model: input.model, effort: input.effort };
  let response: { status: number; json: unknown };
  try {
    response = await deps.linkFetch(link.environmentId, '/api/conversations', { method: 'POST', actor: 'operator', body });
  } catch (error) {
    throw new FlyMachineError('conversation-failed', `Could not reach the Fly machine to start the conversation: ${(error as Error).message}`);
  }
  const name = (response.json as { name?: unknown } | null)?.name;
  if (response.status !== 201 || typeof name !== 'string' || !name) {
    throw new FlyMachineError('conversation-failed', `The Fly machine refused the conversation (status ${response.status}).`, { status: response.status, body: response.json });
  }
  return { environmentId: link.environmentId, name, path: `/conv/@${link.environmentId}/${name}` };
}

/**
 * Undo everything addFlyMachine made. Each step logs its own failure and the next
 * still runs. The record is deleted only when the destroy succeeded; otherwise it
 * stays so the sweep destroys the VM later.
 */
async function rollback(deps: FlyMachineServiceDeps, vm: Pick<FlyCreatedMachine, 'appName' | 'machineId'>, recordId: string, linkId: string | null): Promise<void> {
  const attempt = async (what: string, step: () => Promise<unknown>): Promise<boolean> =>
    step().then(() => true, (error: unknown) => {
      deps.log(`Rollback could not ${what}: ${(error as Error).message}`);
      return false;
    });
  const destroyed = await attempt(`destroy Fly machine ${vm.machineId}`, () => deps.destroy(vm.appName, vm.machineId));
  if (linkId !== null) {
    await attempt(`remove link ${linkId}`, () => deps.removeLink(linkId));
    deps.notifyLinksChanged();
  }
  if (destroyed) await attempt(`delete record ${recordId}`, () => deps.removeRecord(recordId));
  else deps.log(`Kept the record of Fly machine ${vm.machineId} so the sweep destroys it later`);
}

/**
 * The unlink hook: null when the link is not a Fly machine. Unless
 * `keepServer`, destroys the VM (a 404 counts as gone); a failed destroy
 * throws and leaves the record so the unlink can be retried.
 */
export async function removeFlyMachineForLink(
  link: Pick<MachineLink, 'id'>,
  options: { keepServer: boolean },
  overrides: Partial<FlyMachineServiceDeps> = {},
): Promise<FlyRemoval | null> {
  const deps = { ...defaultDeps, ...overrides };
  const record = await deps.getRecordByLinkId(link.id);
  if (!record) return null;
  if (!options.keepServer) {
    try {
      await deps.destroy(record.appName, record.machineId);
    } catch (error) {
      throw new FlyMachineError('unreachable', `Could not destroy Fly machine ${record.machineId}: ${(error as Error).message}`, { machineId: record.machineId });
    }
  }
  await deps.removeRecord(record.id);
  return { destroyed: !options.keepServer };
}

/** Test seam: no production caller; tests use it to clear cap reservations left by a test. */
export function _resetFlyMachineServiceForTests(): void {
  pendingProvisions = 0;
}
