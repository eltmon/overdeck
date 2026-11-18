/**
 * Known skill packs (PAN-5540): which KNOWN_PACKS ids and pack groups exist, which are added,
 * which the dashboard may add with one click, and the CLI command that adds each.
 *
 * `pan skills pack list` prints this listing; `GET /api/skills/packs/available` returns it.
 *
 * Server-reachable: every fs call is async.
 * Nothing here imports `src/lib/skill-overrides/`; callers pass reserved skill ids in.
 */
import { KNOWN_PACKS, type PackAdapterId } from './adapters.js';
import { listPackGroups } from './groups.js';
import { buildsOx, listPacks } from './sources.js';

export type NotAddableReason = 'needs-ref' | 'runs-build';

export interface AvailablePack {
  id: string;
  url: string | null;
  ref: string | null;
  adapter: PackAdapterId | null;
  disclosure: string | null;
  /** The pack has a registry entry. */
  added: boolean;
  dashboardAddable: boolean;
  /** Null when dashboardAddable. */
  reason: NotAddableReason | null;
  addCommand: string;
  /** Names of the groups that list this id, sorted. */
  groups: string[];
}

export interface AvailableGroup {
  name: string;
  packs: string[];
  source: 'built-in' | 'config';
  /** Members with no registry entry, in group order. */
  missing: string[];
  /** Missing members that are not KNOWN_PACKS ids. */
  unknown: string[];
  /** Some member is missing, and every missing member is a dashboard-addable known pack. */
  dashboardAddable: boolean;
  addCommand: string;
}

export interface AvailablePackListing {
  packs: AvailablePack[];
  groups: AvailableGroup[];
}

/**
 * D-1: why the dashboard cannot add a known pack, or null when it can. A pack without a default url
 * or ref needs the operator to choose one (`needs-ref`, which wins); a pack whose add runs a build
 * (gstack's runtime, sageox's `go build`) is `runs-build`. An unknown id is `needs-ref`.
 */
export function notAddableReason(id: string): NotAddableReason | null {
  const known = KNOWN_PACKS[id];
  if (!known?.url || !known.ref) return 'needs-ref';
  if (known.adapter === 'gstack-runtime' || buildsOx(id)) return 'runs-build';
  return null;
}

/** `pan skills pack add <id>` when the known pack has a default ref, else `pan skills pack add <id> --ref <ref>`. */
export function packAddCommand(id: string): string {
  return KNOWN_PACKS[id]?.ref ? `pan skills pack add ${id}` : `pan skills pack add ${id} --ref <ref>`;
}

/** Every known pack (sorted by id) and every pack group (in listPackGroups order), with what is added. */
export async function listAvailablePacks(): Promise<AvailablePackListing> {
  const [registered, packGroups] = await Promise.all([listPacks(), listPackGroups()]);
  const added = new Set(registered.map((entry) => entry.id));

  const packs = Object.keys(KNOWN_PACKS)
    .sort((a, b) => a.localeCompare(b))
    .map((id): AvailablePack => {
      const known = KNOWN_PACKS[id]!;
      const reason = notAddableReason(id);
      return {
        id,
        url: known.url ?? null,
        ref: known.ref ?? null,
        adapter: known.adapter ?? null,
        disclosure: known.disclosure ?? null,
        added: added.has(id),
        dashboardAddable: reason === null,
        reason,
        addCommand: packAddCommand(id),
        groups: packGroups
          .filter((group) => group.packs.includes(id))
          .map((group) => group.name)
          .sort((a, b) => a.localeCompare(b)),
      };
    });

  const groups = packGroups.map((group): AvailableGroup => {
    const missing = group.packs.filter((id) => !added.has(id));
    const unknown = missing.filter((id) => !KNOWN_PACKS[id]);
    return {
      name: group.name,
      packs: [...group.packs],
      source: group.source,
      missing,
      unknown,
      dashboardAddable:
        missing.length > 0 && unknown.length === 0 && missing.every((id) => notAddableReason(id) === null),
      addCommand: `pan skills pack add --group ${group.name}`,
    };
  });

  return { packs, groups };
}

/** Text lines for `pan skills pack list`, no ANSI color: the known packs not added, then the groups. */
export function formatAvailablePackLines(listing: AvailablePackListing): string[] {
  const lines: string[] = [];
  const notAdded = listing.packs.filter((pack) => !pack.added);
  if (notAdded.length > 0) {
    const width = Math.max(...notAdded.map((pack) => pack.id.length));
    lines.push(`Known packs not added (${notAdded.length})`);
    for (const pack of notAdded) lines.push(`${pack.id.padEnd(width)}  ${pack.addCommand}`);
  }
  if (listing.groups.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('Groups');
    for (const group of listing.groups) {
      lines.push(`${group.name}  ${group.packs.join(', ')}  (${group.source})`);
      if (group.missing.length > 0) lines.push(`  not added: ${group.missing.join(', ')}; run ${group.addCommand}`);
      if (group.unknown.length > 0) {
        lines.push(`  not known packs: ${group.unknown.join(', ')}; add each with pan skills pack add <id> <url> --ref <ref>`);
      }
    }
  }
  return lines;
}
