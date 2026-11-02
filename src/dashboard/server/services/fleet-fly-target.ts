/**
 * The Fly target door (PAN-4743 WI-1, FR-2, FR-3, FR-4).
 *
 * `startFlyTarget()` is what `resolveTargetMachine('fly', …)` calls when a
 * fleet route passes a spawn context (`fleet-target.ts`): it refuses before
 * creating anything (no admin credential, no project, a project with no git
 * origin or not on GitHub, a `needs` tag a Fly machine cannot have), then
 * calls `addFlyMachine` and turns its result into a `FleetTarget` whose
 * `discard()` unlinks and destroys the machine it just made.
 */
import type { MachineLink } from '../../../lib/anywhere/link-store.js';
import { listLinks } from '../../../lib/anywhere/link-store.js';
import { FLY_MACHINE_ERROR_STATUS, FlyMachineError } from '../../../lib/anywhere/fly/provision.js';
import { emitActivityEntry } from '../../../lib/activity-logger.js';
import { ERROR_STATUS, handleMachinesUnlink, notifyLinksChanged } from '../routes/machines.js';
import { addFlyMachine, type AddFlyMachineInput, type AddFlyMachineResult } from './fly-machine-service.js';
import { MachineLinkError } from './machine-link-service.js';

/**
 * A structural subtype of `fleet-target.ts`'s `FleetTarget` (the `self: false`
 * and refusal variants only). Defined here rather than imported, so this
 * module does not import `fleet-target.ts`: that file imports this one for
 * `startFly`, and an import in both directions would be a new circular
 * dependency (`npm run lint:circular`).
 */
type FlyFleetTarget =
  | { ok: true; self: false; link: MachineLink; environmentId: string; label: string; reason: string; discard: () => Promise<void> }
  | { ok: false; status: number; body: Record<string, unknown> };

/** What a fleet route knows about a spawn that may run on a new Fly machine (PAN-4743). */
export interface FlySpawn {
  projectKey: string | null;
  harness?: string;
  model?: string;
  /** The caller holds an admin credential (D-4743-4). */
  mayCreate: boolean;
}

export interface FlyTargetRequest extends FlySpawn {
  gitOrigin: string | null;
  needs: readonly string[];
}

/** The tags a new Fly machine can have (D-4743-5). */
export const FLY_MACHINE_TAGS: readonly string[] = ['linux', 'docker'];

export interface FlyTargetDeps {
  addFly: (input: AddFlyMachineInput) => Promise<AddFlyMachineResult>;
  links: () => Promise<MachineLink[]>;
  unlink: (linkId: string) => Promise<void>;
  activity: (message: string, details: Record<string, unknown>) => void;
  warn: (message: string) => void;
}

const defaultFlyTargetDeps = (): FlyTargetDeps => ({
  addFly: (input) => addFlyMachine(input, { notifyLinksChanged }),
  links: listLinks,
  unlink: async (id) => {
    await handleMachinesUnlink(id);
  },
  activity: (message, details) => emitActivityEntry({ source: 'dashboard', level: 'info', message, details: JSON.stringify(details) }),
  warn: (message) => console.warn(`[fleet-fly] ${message}`),
});

const refuse = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): FlyFleetTarget =>
  ({ ok: false, status, body: { code, error, ...extra } });

export async function startFlyTarget(request: FlyTargetRequest, deps: FlyTargetDeps = defaultFlyTargetDeps()): Promise<FlyFleetTarget> {
  if (!request.mayCreate) return refuse(403, 'fly-needs-admin', 'Starting a Fly machine needs an admin credential.');
  if (!request.projectKey) return refuse(400, 'fly-needs-project', 'Fly (new VM) needs a project: the new machine clones it.');
  if (request.gitOrigin === null) return refuse(409, 'project-has-no-origin', `Only GitHub projects can run on a Fly machine; ${request.projectKey} has no github_repo.`);
  if (!request.gitOrigin.startsWith('github.com/')) return refuse(409, 'project-not-on-github', `Only GitHub projects can run on a Fly machine; ${request.projectKey} has no github_repo.`);
  const missing = request.needs.filter((tag) => !FLY_MACHINE_TAGS.includes(tag));
  if (missing.length > 0) return refuse(409, 'needs-unmet', `A Fly machine has no ${missing.join(', ')}`, { missing });

  let result: AddFlyMachineResult;
  try {
    result = await deps.addFly({
      projectKey: request.projectKey,
      ...(request.harness ? { harness: request.harness } : {}),
      ...(request.model ? { model: request.model } : {}),
    });
  } catch (error) {
    if (error instanceof FlyMachineError) {
      return refuse(FLY_MACHINE_ERROR_STATUS[error.code], error.code, error.message);
    }
    if (error instanceof MachineLinkError) {
      return refuse(ERROR_STATUS[error.code], error.code, error.message);
    }
    return refuse(500, 'fly-failed', (error as Error).message);
  }

  const link = (await deps.links()).find((candidate) => candidate.id === result.link.id);
  if (!link) return refuse(500, 'fly-failed', 'The new Fly machine link disappeared');

  const discard = async (): Promise<void> => {
    try {
      await deps.unlink(link.id);
    } catch (error) {
      deps.warn(`could not discard ${result.record.label}: ${(error as Error).message}`);
    }
  };

  if (request.needs.includes('docker') && !result.record.docker) {
    await discard();
    return refuse(409, 'needs-unmet', `${result.record.label} has no docker`, { missing: ['docker'] });
  }

  deps.activity(`Added Fly machine "${result.record.label}" (${result.record.appName}, ${result.record.region})`, {
    linkId: link.id,
    environmentId: link.environmentId,
    machineId: result.record.machineId,
    projectKey: result.record.projectKey,
    docker: result.record.docker,
  });

  return {
    ok: true,
    self: false,
    link,
    environmentId: link.environmentId,
    label: result.record.label,
    reason: `Fly (new VM) → ${result.record.label} (${result.record.region})`,
    discard,
  };
}
