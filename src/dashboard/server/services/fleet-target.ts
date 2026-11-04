/**
 * Which machine a fleet spawn runs on (PAN-4651 D-4651-10).
 *
 * `resolveTargetMachine(machine, gitOrigin, needs)` is shared by every fleet
 * spawn route and `POST /api/fleet/placement`:
 * - `undefined`, this machine's label or environment id ⇒ this machine;
 * - `auto` ⇒ `choosePlacement` over this machine (a fresh load sample, its tags,
 *   placement mode and project slugs) and every non-hidden, non-revoked link
 *   (the supervisor's cached heartbeat facts and the linked-projects cache);
 * - a link's label or environment id ⇒ that link, which must be online (else
 *   503 `machine-offline`); an explicit label is honored even when the machine
 *   is reserved or saturated, but `needs` is still checked (409 `needs-unmet`);
 * - `fly` ⇒ a route that passes a spawn context (PAN-4743) calls the Fly
 *   target door; without one, 400 `fly-unavailable`;
 * - `auto` with nothing that fits, a spawn context, a non-null `gitOrigin`,
 *   `needs` within what a Fly machine can have and `remote.auto_fly` on ⇒
 *   the Fly target door too (PAN-4743);
 * - anything else ⇒ 404 `unknown-machine`.
 */
import type { LoadSample, PlacementAnswer } from '@overdeck/contracts';

import { listLinks, type MachineLink } from '../../../lib/anywhere/link-store.js';
import { currentMachineProfile, type MachineProfile } from '../../../lib/anywhere/machine-capabilities.js';
import { choosePlacement, noMachineFits, type PlacementCandidate } from '../../../lib/anywhere/placement.js';
import { listMachineProjects } from '../../../lib/anywhere/project-origin.js';
import { loadConfig } from '../../../lib/config.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { currentLinkSupervisor } from './anywhere-boot.js';
import { FLY_MACHINE_TAGS, startFlyTarget } from './fleet-fly-target.js';
import type { FlySpawn, FlyTargetRequest } from './fleet-fly-target.js';
import { currentLinkedProjects } from './linked-projects-sync.js';
import { connectingStatusSource, type LinkStatusSource } from './machine-link-service.js';
import { sampleMachineLoad } from './machine-load.js';

/** PAN-4743 D-4743-6: the server sentence when `fly` is asked for outside a conversation spawn. */
export const FLY_CONVERSATIONS_ONLY = 'Fly (new VM) starts conversations only. To run this elsewhere, link a Fly machine with pan machines add-fly --project <key> and name it with --machine fly-<id>.';

export interface FleetTargetDeps {
  self: () => Promise<{ environmentId: string; label: string }>;
  links: () => Promise<MachineLink[]>;
  status: LinkStatusSource['status'];
  selfLoad: () => Promise<LoadSample>;
  selfProfile: () => MachineProfile | null;
  selfProjectOrigins: () => Promise<string[]>;
  linkProjectOrigins: (environmentId: string) => string[];
  /** The Fly target door (PAN-4743): starts a new Fly machine for a spawn. */
  startFly: (request: FlyTargetRequest) => Promise<FleetTarget>;
  /** `remote.auto_fly` (PAN-4743): Auto may create a Fly machine when nothing else fits. */
  autoFly: () => Promise<boolean>;
}

export const defaultFleetTargetDeps = (): FleetTargetDeps => ({
  self: async () => {
    const identity = await ensureEnvironmentIdentity();
    return { environmentId: identity.environmentId, label: identity.label };
  },
  links: listLinks,
  status: (linkId) => (currentLinkSupervisor() ?? connectingStatusSource).status(linkId),
  selfLoad: () => sampleMachineLoad(),
  selfProfile: currentMachineProfile,
  selfProjectOrigins: async () => (await listMachineProjects()).flatMap((project) => (project.gitOrigin ? [project.gitOrigin] : [])),
  linkProjectOrigins: (environmentId) =>
    (currentLinkedProjects()?.projectsFor(environmentId) ?? []).flatMap((project) => (project.gitOrigin ? [project.gitOrigin] : [])),
  startFly: (request) => startFlyTarget(request),
  autoFly: async () => (await loadConfig()).remote?.auto_fly === true,
});

export type FleetTarget =
  | { ok: true; self: true; environmentId: string; label: string; reason: string | null }
  | {
      ok: true;
      self: false;
      link: MachineLink;
      environmentId: string;
      label: string;
      reason: string | null;
      /** Unlinks and destroys a Fly machine this spawn just created (PAN-4743). */
      discard?: () => Promise<void>;
    }
  | { ok: false; status: number; body: Record<string, unknown> };

/** This machine first, then every non-hidden, non-revoked link in store order. */
export async function placementCandidates(deps: FleetTargetDeps): Promise<{ candidates: PlacementCandidate[]; links: MachineLink[] }> {
  const [self, links, load, origins] = await Promise.all([deps.self(), deps.links(), deps.selfLoad(), deps.selfProjectOrigins()]);
  const profile = deps.selfProfile();
  const selfCandidate: PlacementCandidate = {
    ...self, self: true, state: 'online', load, tags: profile?.tags ?? [], placement: profile?.placement ?? 'auto', projectOrigins: origins,
  };
  const visible = links.filter((link) => !link.revokedAt && link.hidden !== true);
  const linkCandidates = visible.map((link): PlacementCandidate => {
    const live = deps.status(link.id);
    return {
      environmentId: link.environmentId, label: link.label, self: false, state: live.state,
      load: live.load ?? null, tags: live.tags ?? [], placement: live.placement ?? 'auto',
      projectOrigins: deps.linkProjectOrigins(link.environmentId),
    };
  });
  return { candidates: [selfCandidate, ...linkCandidates], links: visible };
}

/** `POST /api/fleet/placement`. */
export async function placeAuto(gitOrigin: string | null, needs: readonly string[], deps: FleetTargetDeps): Promise<PlacementAnswer> {
  const { candidates } = await placementCandidates(deps);
  return choosePlacement({ candidates, gitOrigin, needs });
}

const refuse = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): FleetTarget =>
  ({ ok: false, status, body: { code, error, ...extra } });

function missingNeeds(tags: readonly string[], needs: readonly string[]): string[] {
  return needs.filter((tag) => !tags.includes(tag));
}

export async function resolveTargetMachine(
  machine: string | undefined,
  gitOrigin: string | null,
  needs: readonly string[],
  deps: FleetTargetDeps = defaultFleetTargetDeps(),
  spawn?: FlySpawn,
): Promise<FleetTarget> {
  const wanted = machine?.trim() ?? '';
  if (wanted.toLowerCase() === 'fly') {
    if (!spawn) return refuse(400, 'fly-unavailable', FLY_CONVERSATIONS_ONLY);
    return deps.startFly({ ...spawn, gitOrigin, needs });
  }
  if (wanted.toLowerCase() === 'auto') {
    const { candidates, links } = await placementCandidates(deps);
    const answer = choosePlacement({ candidates, gitOrigin, needs });
    if (!answer.ok) {
      const flyFits = spawn !== undefined && gitOrigin !== null && needs.every((tag) => FLY_MACHINE_TAGS.includes(tag));
      if (flyFits && (await deps.autoFly())) {
        const fly = await deps.startFly({ ...spawn, gitOrigin, needs });
        return fly.ok ? { ...fly, reason: `Auto → ${fly.label} (new Fly machine). ${noMachineFits(answer.rejections)}` } : fly;
      }
      return refuse(409, 'no-machine-fits', noMachineFits(answer.rejections), { rejections: answer.rejections });
    }
    if (answer.self) return { ok: true, self: true, environmentId: answer.environmentId, label: answer.label, reason: answer.reason };
    const link = links.find((candidate) => candidate.environmentId === answer.environmentId)!;
    return { ok: true, self: false, link, environmentId: link.environmentId, label: link.label, reason: answer.reason };
  }
  const self = await deps.self();
  if (wanted === '' || wanted === self.environmentId || wanted.toLowerCase() === self.label.toLowerCase()) {
    const missing = missingNeeds(deps.selfProfile()?.tags ?? [], needs);
    if (missing.length > 0) return refuse(409, 'needs-unmet', `${self.label} has no ${missing.join(', ')}`, { missing });
    return { ok: true, self: true, ...self, reason: null };
  }
  const links = (await deps.links()).filter((link) => !link.revokedAt);
  const link = links.find((candidate) => candidate.environmentId === wanted || candidate.label === wanted)
    ?? links.find((candidate) => candidate.label.toLowerCase() === wanted.toLowerCase());
  if (!link) return refuse(404, 'unknown-machine', `No linked machine is called ${wanted}`);
  const live = deps.status(link.id);
  if (live.state !== 'online') return refuse(503, 'machine-offline', `${link.label} is ${live.state}`);
  const missing = missingNeeds(live.tags ?? [], needs);
  if (missing.length > 0) return refuse(409, 'needs-unmet', `${link.label} has no ${missing.join(', ')}`, { missing });
  return { ok: true, self: false, link, environmentId: link.environmentId, label: link.label, reason: null };
}
