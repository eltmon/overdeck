/**
 * Overdeck trash for the file explorer (PAN-5187, FR-10, NFR-3, NFR-6).
 *
 * Deleting from the explorer moves entries here instead of removing them,
 * so they can be restored. Layout (D-C6), under `getOverdeckHome()`:
 *
 *   trash/<root-slug>/<stamp>-<n>/
 *     .overdeck-trash.json   { rootId, path, trashedAt }
 *     files/<path>           the moved file or folder
 *
 * - `<root-slug>`: the root id with every character outside [A-Za-z0-9._-]
 *   replaced by `-` (`issue:PAN-1` → `issue-PAN-1`).
 * - `<stamp>`: compact ISO-8601 UTC (`20261113T142711946Z`).
 * - `<n>`: the index of the path within one delete call, incremented past a
 *   directory that already exists. The trash id is `<root-slug>/<stamp>-<n>`.
 *
 * Delete (D-C8) resolves and lstats every path before it moves any, and
 * drops paths nested under another path of the same call. A symlink is
 * trashed as a link. If a move fails part-way, the entries moved so far stay
 * in the trash and the error is thrown.
 *
 * Restore (D-C7) trusts nothing from the client: the id must have the
 * shape above and the request root's slug, the manifest's rootId must be
 * the request root, the manifest path is resolved again for write, and an
 * occupied path is refused.
 *
 * Entries older than 7 days are pruned at the start of every delete. A
 * prune failure is logged and never blocks the delete. Names that are not
 * `<stamp>-<n>` are left alone.
 */
import { lstat, mkdir, readdir, readFile, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ExplorerRestoreResult } from '@overdeck/contracts';
import { getOverdeckHome } from '../../../../lib/paths.js';
import { explorerError } from './errors.js';
import { resolveInsideRoot } from './paths.js';
import type { ExplorerRoot } from './roots.js';
import { moveEntry, resolveEntryInsideRoot } from './write.js';

export const TRASH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const TRASH_MANIFEST = '.overdeck-trash.json';
const PAYLOAD_DIR = 'files';

const ENTRY_NAME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-(\d+)$/;
const TRASH_ID = /^([A-Za-z0-9._-]+)\/(\d{8}T\d{9}Z-\d+)$/;

interface TrashManifest {
  rootId: string;
  path: string;
  trashedAt: string;
}

function trashDir(): string {
  return join(getOverdeckHome(), 'trash');
}

export function rootSlug(rootId: string): string {
  return rootId.replace(/[^A-Za-z0-9._-]/g, '-');
}

export function formatStamp(nowMs: number): string {
  return new Date(nowMs).toISOString().replace(/[-:.]/g, '');
}

/** The time a `<stamp>-<n>` entry name was trashed at, or null when the name is not one. */
export function parseStamp(name: string): number | null {
  const match = ENTRY_NAME.exec(name);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, ms] = match.map(Number) as number[];
  const time = Date.UTC(y!, mo! - 1, d!, h!, mi!, s!, ms!);
  // Rejects out-of-range fields (month 13, hour 25), which Date.UTC rolls over.
  return formatStamp(time) === name.slice(0, name.indexOf('-')) ? time : null;
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function exists(abs: string): Promise<boolean> {
  try {
    await lstat(abs);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** Drop duplicates and paths nested under another path in the list, keeping input order. */
function outermost(rels: readonly string[]): string[] {
  const kept: string[] = [];
  for (const rel of rels) {
    if (kept.includes(rel)) continue;
    if (rels.some((other) => other !== rel && rel.startsWith(`${other}/`))) continue;
    kept.push(rel);
  }
  return kept;
}

/** Create `<slug>/<stamp>-<n>`, incrementing n past an existing directory; returns its name. */
async function makeEntryDir(slugDir: string, stamp: string, start: number): Promise<string> {
  for (let n = start; ; n++) {
    const name = `${stamp}-${n}`;
    try {
      await mkdir(join(slugDir, name));
      return name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** Remove trash entries older than 7 days. */
export async function pruneTrash(now: () => number = Date.now): Promise<void> {
  let slugs;
  try {
    slugs = await readdir(trashDir(), { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  const cutoff = now() - TRASH_MAX_AGE_MS;
  for (const slug of slugs) {
    if (!slug.isDirectory()) continue;
    const slugDir = join(trashDir(), slug.name);
    for (const name of await readdir(slugDir)) {
      const trashedAt = parseStamp(name);
      if (trashedAt !== null && trashedAt < cutoff) {
        await rm(join(slugDir, name), { recursive: true, force: true });
      }
    }
  }
}

/** Move `rels` to the trash and return their trash ids, in input order after dropping nested paths. */
export async function trashPaths(
  root: ExplorerRoot,
  rels: readonly string[],
  now: () => number = Date.now,
): Promise<string[]> {
  await pruneTrash(now).catch((err: unknown) => {
    console.warn('[explorer-trash] prune failed', err);
  });

  const targets: Array<{ rel: string; abs: string }> = [];
  for (const rel of outermost(rels)) {
    const abs = await resolveEntryInsideRoot(root, rel);
    if (!(await exists(abs))) throw explorerError('NOT_FOUND', `${JSON.stringify(rel)} does not exist`);
    targets.push({ rel, abs });
  }

  const slug = rootSlug(root.id);
  const slugDir = join(trashDir(), slug);
  await mkdir(slugDir, { recursive: true });
  const trashedAt = now();
  const stamp = formatStamp(trashedAt);

  const ids: string[] = [];
  for (const [index, { rel, abs }] of targets.entries()) {
    const name = await makeEntryDir(slugDir, stamp, index);
    const entryDir = join(slugDir, name);
    const manifest: TrashManifest = { rootId: root.id, path: rel, trashedAt: new Date(trashedAt).toISOString() };
    await fsWriteFile(join(entryDir, TRASH_MANIFEST), `${JSON.stringify(manifest)}\n`);
    const payload = join(entryDir, PAYLOAD_DIR, rel);
    await mkdir(dirname(payload), { recursive: true });
    await moveEntry(abs, payload);
    ids.push(`${slug}/${name}`);
  }
  return ids;
}

async function readManifest(entryDir: string, trashId: string): Promise<TrashManifest> {
  let raw: string;
  try {
    raw = await readFile(join(entryDir, TRASH_MANIFEST), 'utf8');
  } catch (error) {
    if (isMissing(error)) throw explorerError('NOT_FOUND', `Trash entry ${trashId} does not exist`);
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw explorerError('NOT_FOUND', `Trash entry ${trashId} has an unreadable manifest`);
  }
  const m = parsed as Partial<TrashManifest> | null;
  if (typeof m?.rootId !== 'string' || typeof m.path !== 'string') {
    throw explorerError('NOT_FOUND', `Trash entry ${trashId} has an unreadable manifest`);
  }
  return { rootId: m.rootId, path: m.path, trashedAt: String(m.trashedAt ?? '') };
}

/** Move a trash entry back to the path it was deleted from. */
export async function restore(root: ExplorerRoot, trashId: string): Promise<ExplorerRestoreResult> {
  // Refuses a read-only (project) root before anything else is read.
  await resolveInsideRoot(root, '', { forWrite: true, allowRoot: true });

  const match = TRASH_ID.exec(trashId);
  if (!match || match[1] !== rootSlug(root.id)) {
    throw explorerError('NOT_FOUND', `Trash entry ${JSON.stringify(trashId)} does not exist for ${root.id}`);
  }
  const entryDir = join(trashDir(), match[1], match[2]!);
  const manifest = await readManifest(entryDir, trashId);
  if (manifest.rootId !== root.id) {
    throw explorerError('NOT_FOUND', `Trash entry ${trashId} does not belong to ${root.id}`);
  }

  const targetAbs = await resolveEntryInsideRoot(root, manifest.path);
  if (await exists(targetAbs)) {
    throw explorerError('ALREADY_EXISTS', `${JSON.stringify(manifest.path)} already exists`);
  }
  const payload = join(entryDir, PAYLOAD_DIR, manifest.path);
  if (!(await exists(payload))) throw explorerError('NOT_FOUND', `Trash entry ${trashId} has no files`);

  await mkdir(dirname(targetAbs), { recursive: true });
  await moveEntry(payload, targetAbs);
  await rm(entryDir, { recursive: true, force: true });
  return { path: manifest.path };
}
