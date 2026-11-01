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
 * Any failure after the VM exists destroys it, removes the link if one was
 * made and deletes the record before rethrowing: a machine left behind costs
 * money and is a bug.
 *
 * `notifyLinksChanged` is a required argument, not a default: the link
 * supervisor must pick the new link up before anything sends a request through
 * it, and its notifier lives in `routes/machines.ts`, which imports this module
 * for the unlink hook.
 *
 * `removeFlyMachineForLink()` is the unlink hook: it destroys the VM unless
 * `keepServer` and always deletes the record (D-9: destroy, never stop).
 */
import { randomUUID } from 'node:crypto';

import type { MachineLinkView } from '@overdeck/contracts';

import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { removeLink } from '../../../lib/anywhere/link-store.js';
import {
  type FlyMachineRecord,
  getFlyMachineByLinkId,
  removeFlyMachine,
  updateFlyMachine,
  upsertFlyMachine,
} from '../../../lib/anywhere/fly/machine-store.js';
import { destroyFlyVm, FlyMachineError, type FlyProvisionResult, provisionFlyMachine } from '../../../lib/anywhere/fly/provision.js';
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

export interface AddFlyMachineResult {
  link: MachineLinkView;
  record: FlyMachineRecord;
}

export interface FlyRemoval {
  destroyed: boolean;
}

export interface FlyMachineServiceDeps {
  loadConfig: () => Promise<{ remote?: RemoteConfig }>;
  hasFlyToken: (remote: RemoteConfig | undefined) => boolean;
  checkCap: (config: { remote?: RemoteConfig }) => { allowed: boolean; message?: string };
  provision: (input: { region?: string; image?: string }) => Promise<FlyProvisionResult>;
  destroy: (appName: string, machineId: string) => Promise<void>;
  createMachineLink: (input: Parameters<typeof createMachineLink>[0]) => Promise<{ link: MachineLink; view: MachineLinkView }>;
  removeLink: (id: string) => Promise<unknown>;
  getRecordByLinkId: (linkId: string) => Promise<FlyMachineRecord | null>;
  upsertRecord: (record: FlyMachineRecord) => Promise<unknown>;
  updateRecord: (id: string, patch: Partial<Omit<FlyMachineRecord, 'id'>>) => Promise<FlyMachineRecord | null>;
  removeRecord: (id: string) => Promise<unknown>;
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
  checkCap: (config) => checkRemoteSpendCap(config),
  provision: (input) => provisionFlyMachine(input),
  destroy: (appName, machineId) => destroyFlyVm(appName, machineId),
  createMachineLink: (input) => createMachineLink(input),
  removeLink,
  getRecordByLinkId: getFlyMachineByLinkId,
  upsertRecord: upsertFlyMachine,
  updateRecord: updateFlyMachine,
  removeRecord: removeFlyMachine,
  newId: randomUUID,
  now: () => new Date().toISOString(),
  log: (message) => console.warn(`[fly-machines] ${message}`),
};

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
  if (input.harness !== undefined && input.harness !== 'claude-code') {
    throw new FlyMachineError('harness-unsupported', `Fly machines run Claude Code only; ${input.harness} is not supported yet (#4296).`, { harness: input.harness });
  }
  if (input.message !== undefined && !input.projectKey) {
    throw new FlyMachineError('bad-request', 'A message needs a project: pass projectKey (--project) with it.');
  }
  const cap = deps.checkCap(config);
  if (!cap.allowed) throw new FlyMachineError('cap-reached', cap.message ?? 'The remote spend cap is reached.');
}

export async function addFlyMachine(
  input: AddFlyMachineInput,
  overrides: Partial<FlyMachineServiceDeps> & Pick<FlyMachineServiceDeps, 'notifyLinksChanged'>,
): Promise<AddFlyMachineResult> {
  const deps: FlyMachineServiceDeps = { ...defaultDeps, ...overrides };
  await refuseEarly(input, deps);

  // Provisioning destroys its own VM when it fails, so rollback starts after it.
  const vm = await deps.provision({ region: input.region, image: input.image });
  const recordId = deps.newId();
  let linkId: string | null = null;
  try {
    await deps.upsertRecord({
      id: recordId,
      linkId: null,
      environmentId: null,
      machineId: vm.machineId,
      machineName: vm.machineName,
      appName: vm.appName,
      region: vm.region,
      label: vm.label,
      projectKey: input.projectKey ?? null,
      docker: vm.docker,
      createdAt: deps.now(),
    });

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

    const record = await deps.updateRecord(recordId, { linkId, environmentId: created.link.environmentId });
    if (!record) throw new Error(`The Fly machine record ${recordId} disappeared while linking`);
    deps.notifyLinksChanged();
    return { link: created.view, record };
  } catch (error) {
    await rollback(deps, vm, recordId, linkId);
    throw error;
  }
}

/** Undo everything addFlyMachine made after provisioning. Each step logs its own failure and the next still runs. */
async function rollback(deps: FlyMachineServiceDeps, vm: FlyProvisionResult, recordId: string, linkId: string | null): Promise<void> {
  const attempt = async (what: string, step: () => Promise<unknown>): Promise<void> => {
    await step().catch((error: unknown) => deps.log(`Rollback could not ${what}: ${(error as Error).message}`));
  };
  await attempt(`destroy Fly machine ${vm.machineId}`, () => deps.destroy(vm.appName, vm.machineId));
  if (linkId !== null) {
    await attempt(`remove link ${linkId}`, () => deps.removeLink(linkId));
    deps.notifyLinksChanged();
  }
  await attempt(`delete record ${recordId}`, () => deps.removeRecord(recordId));
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
