/**
 * Known skill packs (PAN-5540): which KNOWN_PACKS ids and pack groups exist, which are added,
 * which the dashboard may add with one click, and the CLI command that adds each.
 *
 * `pan skills pack list` prints this listing; `GET /api/skills/packs/available` returns it. The
 * dashboard previews and adds a dashboard-addable known pack through `previewKnownPack` and
 * `addKnownPack`, which call `addPack` (the CLI's registration path) with the known url and ref.
 *
 * Server-reachable: every fs call is async.
 * Nothing here imports `src/lib/skill-overrides/`; callers pass reserved skill ids in.
 */
import { KNOWN_PACKS, notAppliedLabels, type PackAdapterId } from './adapters.js';
import { listPackGroups } from './groups.js';
import { addPack, buildsOx, listPacks, PACK_ID_PATTERN, type PackPreview } from './sources.js';

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

export type KnownPackErrorCode = 'bad-request' | 'unknown-pack' | 'not-addable' | 'busy' | 'commit-changed';

export class KnownPackError extends Error {
  constructor(
    readonly code: KnownPackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'KnownPackError';
  }
}

/** NFR-2: the url and ref a pack add uses; explicit values win over the known-pack defaults. */
export function knownPackSource(id: string, explicit: { url?: string; ref?: string } = {}): { url: string; ref: string } {
  const known = KNOWN_PACKS[id];
  const url = explicit.url ?? known?.url;
  const ref = explicit.ref ?? known?.ref;
  if (!url) throw new KnownPackError('bad-request', `pack ${id} has no default url; pass one: pan skills pack add ${id} <url> --ref <ref>`);
  if (!ref) throw new KnownPackError('bad-request', `pack ${id} has no default ref; pass --ref <tag-or-branch>`);
  return { url, ref };
}

// D-11: one git operation per pack id in this process. A second preview shares the running preview;
// any overlap that involves an add is refused with `busy`.
const inFlight = new Map<string, { kind: 'preview' | 'add'; promise: Promise<PackPreview> }>();

function runExclusive(id: string, kind: 'preview' | 'add', run: () => Promise<PackPreview>): Promise<PackPreview> {
  const current = inFlight.get(id);
  if (current?.kind === 'preview' && kind === 'preview') return current.promise;
  if (current) {
    return Promise.reject(new KnownPackError('busy', `pack ${id} is already being fetched or added; try again when it finishes`));
  }
  const promise = run().finally(() => inFlight.delete(id));
  inFlight.set(id, { kind, promise });
  return promise;
}

function requireDashboardAddable(id: string): { url: string; ref: string } {
  if (!PACK_ID_PATTERN.test(id) || !KNOWN_PACKS[id]) throw new KnownPackError('unknown-pack', `unknown pack: ${id}`);
  const reason = notAddableReason(id);
  if (reason) {
    throw new KnownPackError('not-addable', `pack ${id} cannot be added from the dashboard (${reason}); run ${packAddCommand(id)}`);
  }
  return knownPackSource(id);
}

/** FR-4: fetch and extract a dashboard-addable known pack; never writes the registry. Throws PackSourceError('exists') when registered. */
export async function previewKnownPack(id: string, reservedIds: readonly string[]): Promise<PackPreview> {
  const { url, ref } = requireDashboardAddable(id);
  return runExclusive(id, 'preview', async () => (await addPack({ id, url, ref, reservedIds }, async () => false)).preview);
}

/** FR-5 / D-2: register a dashboard-addable known pack only when its ref still resolves to the previewed commit. */
export async function addKnownPack(id: string, expectedCommit: string, reservedIds: readonly string[]): Promise<PackPreview> {
  const { url, ref } = requireDashboardAddable(id);
  return runExclusive(id, 'add', async () => {
    const result = await addPack({ id, url, ref, reservedIds }, async (preview) => preview.commit === expectedCommit);
    if (!result.written) {
      throw new KnownPackError(
        'commit-changed',
        `pack ${id} now resolves ${ref} to ${result.preview.commit.slice(0, 7)}, not the previewed ${expectedCommit.slice(0, 7)}; preview again`,
      );
    }
    return result.preview;
  });
}

/** The preview the dashboard's add dialog shows (D-14): the rows `pan skills pack add` prints. */
export interface PackPreviewDto {
  id: string;
  url: string;
  ref: string;
  commit: string;
  adapter: PackAdapterId;
  pluginRoot: string | null;
  license: string | null;
  skills: Array<{ name: string; description: string; optIn: boolean }>;
  excluded: Array<{ name: string; reason: string }>;
  notApplied: string[];
  executables: string[];
  mcpServers: Array<{ name: string; url: string }>;
  disclosure: string | null;
}

export function serializePackPreview(preview: PackPreview): PackPreviewDto {
  const { manifest } = preview;
  return {
    id: preview.id,
    url: preview.url,
    ref: preview.ref,
    commit: preview.commit,
    adapter: preview.adapter,
    pluginRoot: preview.pluginRoot ?? null,
    license: manifest.license,
    skills: manifest.skills.map((skill) => ({ name: skill.name, description: skill.description, optIn: skill.optIn })),
    excluded: manifest.excluded ? manifest.excluded.map((entry) => ({ name: entry.name, reason: entry.reason })) : [],
    notApplied: notAppliedLabels(manifest.capabilities),
    executables: [...manifest.capabilities.executables],
    mcpServers: Object.entries(manifest.mcpServers ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, server]) => ({ name, url: server.url })),
    disclosure: KNOWN_PACKS[preview.id]?.disclosure ?? null,
  };
}
