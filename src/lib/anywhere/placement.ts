/**
 * Auto placement (PAN-4651 FR-6, FR-7, D-4651-9; epic D-19). Pure and
 * deterministic: the same input always picks the same machine.
 *
 * 1. Candidates: this machine plus each link the caller passes (the caller
 *    leaves out hidden and revoked links).
 * 2. Rejections, in this order, each with a reason: `offline` / `unsupported`;
 *    `no project` (a non-null `gitOrigin` none of the machine's project slugs
 *    match); `no <tag>` (the first missing `needs` tag); `CPU saturated`;
 *    `reserved` (placement `on-request`). A reserved machine stays a candidate
 *    when tags were asked for and every non-reserved machine was rejected for
 *    `no <tag>` — it is the only machine with the required tag.
 * 3. Score: lowest CPU PSI avg10 (unknown after any number), then most
 *    available memory (unknown last), then fewest working agents, then this
 *    machine, then label ascending.
 * Fly is never a candidate here: a Fly (new VM) fallback runs separately,
 * after this answers no-fit, only for a conversation spawn with
 * `remote.auto_fly` on (PAN-4743, `fleet-target.ts`'s auto branch).
 */
import type { LinkState, LoadSample, MachinePlacementMode, PlacementAnswer, PlacementRejection } from '@overdeck/contracts';

import { sameGitOrigin } from './project-origin.js';

export interface PlacementCandidate {
  environmentId: string;
  label: string;
  self: boolean;
  state: LinkState;
  load: LoadSample | null;
  tags: readonly string[];
  placement: MachinePlacementMode;
  projectOrigins: readonly string[];
}

export interface PlacementInput {
  candidates: readonly PlacementCandidate[];
  gitOrigin: string | null;
  needs: readonly string[];
}

const GIB = 2 ** 30;

/** The rejection before the reserved rule; null when the machine fits so far. */
function hardRejection(candidate: PlacementCandidate, gitOrigin: string | null, needs: readonly string[]): string | null {
  if (candidate.state !== 'online' && !candidate.self) return candidate.state === 'unsupported' ? 'unsupported' : 'offline';
  if (gitOrigin !== null && !candidate.projectOrigins.some((origin) => sameGitOrigin(origin, gitOrigin))) return 'no project';
  const missing = needs.find((tag) => !candidate.tags.includes(tag));
  if (missing !== undefined) return `no ${missing}`;
  if (candidate.load?.cpuSaturated) return 'CPU saturated';
  return null;
}

const isTagRejection = (reason: string | null): boolean => reason !== null && reason !== 'no project' && reason.startsWith('no ');

/** Ascending; null sorts after every number. */
function compareNullable(a: number | null, b: number | null): number {
  if (a === null || b === null) return a === null ? (b === null ? 0 : 1) : -1;
  return a - b;
}

function compareCandidates(a: PlacementCandidate, b: PlacementCandidate): number {
  return compareNullable(a.load?.cpuPsiSomeAvg10 ?? null, b.load?.cpuPsiSomeAvg10 ?? null)
    || compareNullable(negate(a.load?.memAvailableBytes ?? null), negate(b.load?.memAvailableBytes ?? null))
    || compareNullable(a.load?.workingAgents ?? null, b.load?.workingAgents ?? null)
    || Number(b.self) - Number(a.self)
    || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
}

const negate = (value: number | null): number | null => (value === null ? null : -value);

/** `Auto → desk (CPU pressure 3%, 41 GB free, 2 agents)`; unknown values print `n/a`. */
export function placementReason(candidate: PlacementCandidate): string {
  const load = candidate.load;
  const cpu = load?.cpuPsiSomeAvg10 == null ? 'n/a' : `${Math.round(load.cpuPsiSomeAvg10)}%`;
  const memory = load?.memAvailableBytes == null ? 'n/a' : `${Math.floor(load.memAvailableBytes / GIB)}`;
  const agents = load ? `${load.workingAgents}` : 'n/a';
  return `Auto → ${candidate.label} (CPU pressure ${cpu}, ${memory} GB free, ${agents} agents)`;
}

/** `No machine fits: laptop: no docker; desk: offline`. */
export function noMachineFits(rejections: readonly PlacementRejection[]): string {
  return `No machine fits: ${rejections.map((rejection) => `${rejection.label}: ${rejection.reason}`).join('; ')}`;
}

export function choosePlacement(input: PlacementInput): PlacementAnswer {
  const needs = [...new Set(input.needs)];
  const hard = new Map(input.candidates.map((candidate) => [candidate, hardRejection(candidate, input.gitOrigin, needs)]));
  const nonReserved = input.candidates.filter((candidate) => candidate.placement !== 'on-request');
  const onlyTagHolder = needs.length > 0 && nonReserved.every((candidate) => isTagRejection(hard.get(candidate) ?? null));
  const rejections: PlacementRejection[] = [];
  const eligible: PlacementCandidate[] = [];
  for (const candidate of input.candidates) {
    const reason = hard.get(candidate) ?? (candidate.placement === 'on-request' && !onlyTagHolder ? 'reserved' : null);
    if (reason === null) eligible.push(candidate);
    else rejections.push({ environmentId: candidate.environmentId, label: candidate.label, reason });
  }
  const chosen = [...eligible].sort(compareCandidates)[0];
  if (!chosen) return { ok: false, rejections };
  return { ok: true, environmentId: chosen.environmentId, label: chosen.label, self: chosen.self, reason: placementReason(chosen), rejections };
}
