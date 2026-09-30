/**
 * Skill pack sources (PAN-4334): the pack registry and the pack cache paths.
 *
 * - registry: `~/.overdeck/config.yaml` → `skills.packs.<id>: { url, ref, commit, adapter? }`
 *   (the trusted commit is an operator decision, so it is stored)
 * - cache:    `~/.overdeck/packs/<id>/` (derived; deletable at any time)
 *
 * Server-reachable: every fs and git call is async. Nothing here imports
 * `src/lib/skill-overrides/` (that module will import this one).
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { isMap, isScalar, parse as parseYaml, parseDocument, type Document } from 'yaml';
import { getGlobalConfigPath } from '../config-yaml/load.js';
import { getOverdeckHome } from '../paths.js';
import { runSettingsWriteSerialized } from '../settings-api.js';
import {
  detectAdapter,
  KNOWN_PACKS,
  notAppliedLabels,
  readPackManifest,
  type PackAdapterId,
  type PackManifest,
} from './adapters.js';

export const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const ADAPTERS: readonly PackAdapterId[] = ['plain', 'claude-plugin', 'deft-readonly'];
const LS_REMOTE_TIMEOUT_MS = 5000;

const execFileAsync = promisify(execFile);

export interface PackRegistryEntry {
  id: string;
  url: string;
  ref: string;
  commit: string;
  adapter?: PackAdapterId;
}

function assertPackId(id: string): void {
  if (!PACK_ID_PATTERN.test(id)) throw new Error(`invalid pack id: ${JSON.stringify(id)}`);
}

function assertCommit(commit: string): void {
  if (!COMMIT_PATTERN.test(commit)) throw new Error(`invalid pack commit: ${JSON.stringify(commit)}`);
}

export function packsHome(): string {
  return join(getOverdeckHome(), 'packs');
}

export function packCacheDir(id: string): string {
  assertPackId(id);
  return join(packsHome(), id);
}

export function packRepoDir(id: string): string {
  return join(packCacheDir(id), 'repo.git');
}

export function packExtractDir(id: string, commit: string): string {
  assertCommit(commit);
  return join(packCacheDir(id), commit);
}

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

function toEntry(id: string, raw: unknown): PackRegistryEntry | null {
  if (!PACK_ID_PATTERN.test(id) || !raw || typeof raw !== 'object') return null;
  const { url, ref, commit, adapter } = raw as Record<string, unknown>;
  if (typeof url !== 'string' || !url || typeof ref !== 'string' || !ref) return null;
  if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) return null;
  if (adapter !== undefined && !ADAPTERS.includes(adapter as PackAdapterId)) return null;
  return { id, url, ref, commit, ...(adapter ? { adapter: adapter as PackAdapterId } : {}) };
}

/** Registered packs sorted by id; malformed entries are skipped. */
export async function listPacks(): Promise<PackRegistryEntry[]> {
  let config: unknown;
  try {
    config = parseYaml(await readTextOrEmpty(getGlobalConfigPath()));
  } catch {
    return [];
  }
  const packs = (config as { skills?: { packs?: unknown } } | null)?.skills?.packs;
  if (!packs || typeof packs !== 'object') return [];
  return Object.entries(packs as Record<string, unknown>)
    .map(([id, raw]) => toEntry(id, raw))
    .filter((entry): entry is PackRegistryEntry => entry !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function getPack(id: string): Promise<PackRegistryEntry | null> {
  return (await listPacks()).find((entry) => entry.id === id) ?? null;
}

async function editGlobalConfig(edit: (doc: Document) => boolean): Promise<void> {
  await runSettingsWriteSerialized(async () => {
    const path = getGlobalConfigPath();
    const doc = parseDocument(await readTextOrEmpty(path));
    if (doc.errors.length > 0) throw new Error(`cannot parse ${path}: ${doc.errors[0]?.message ?? 'invalid YAML'}`);
    if (!edit(doc)) return;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, doc.toString(), 'utf8');
  });
}

/** Delete a key and prune the maps above it that became empty. */
function deletePruning(doc: Document, path: string[]): void {
  doc.deleteIn(path);
  for (let depth = path.length - 1; depth > 0; depth--) {
    const parent = doc.getIn(path.slice(0, depth));
    if (isMap(parent) && parent.items.length === 0) doc.deleteIn(path.slice(0, depth));
  }
}

export async function writePackEntry(entry: PackRegistryEntry): Promise<void> {
  assertPackId(entry.id);
  assertCommit(entry.commit);
  if (!entry.url || !entry.ref) throw new Error(`pack ${entry.id} needs a url and a ref`);
  if (entry.adapter !== undefined && !ADAPTERS.includes(entry.adapter)) {
    throw new Error(`invalid pack adapter: ${JSON.stringify(entry.adapter)}`);
  }
  const value = {
    url: entry.url,
    ref: entry.ref,
    commit: entry.commit,
    ...(entry.adapter ? { adapter: entry.adapter } : {}),
  };
  await editGlobalConfig((doc) => {
    doc.setIn(['skills', 'packs', entry.id], doc.createNode(value));
    return true;
  });
}

/** Remove the registry entry, the global pack toggle, and global `<id>/…` skill overrides. */
export async function deletePackEntry(id: string): Promise<void> {
  assertPackId(id);
  await editGlobalConfig((doc) => {
    let changed = false;
    for (const path of [['skills', 'packs', id], ['skills', 'pack_overrides', id]]) {
      if (!doc.hasIn(path)) continue;
      deletePruning(doc, path);
      changed = true;
    }
    const overrides = doc.getIn(['skills', 'overrides']);
    if (isMap(overrides)) {
      const keys = overrides.items
        .map((pair) => String(isScalar(pair.key) ? pair.key.value : pair.key))
        .filter((key) => key.startsWith(`${id}/`));
      for (const key of keys) {
        deletePruning(doc, ['skills', 'overrides', key]);
        changed = true;
      }
    }
    return changed;
  });
}

async function git(args: string[], opts: { timeout?: number } = {}): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 16 * 1024 * 1024,
    ...opts,
  });
  return stdout;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function assertOperand(kind: string, value: string): void {
  if (!value || value.startsWith('-')) throw new Error(`invalid pack ${kind}: ${JSON.stringify(value)}`);
}

/** Clone the pack as a blobless bare repo, or fetch every branch and tag into the existing clone. */
export async function fetchPackSource(id: string, url: string): Promise<void> {
  assertOperand('url', url);
  const repo = packRepoDir(id);
  if (await exists(repo)) {
    await git(['--git-dir', repo, 'remote', 'set-url', 'origin', url]);
    await git(['--git-dir', repo, 'fetch', '--force', '--tags', 'origin', '+refs/heads/*:refs/heads/*']);
    return;
  }
  await mkdir(dirname(repo), { recursive: true });
  try {
    await git(['clone', '--bare', '--filter=blob:none', '--quiet', '--', url, repo]);
  } catch (error) {
    await rm(repo, { recursive: true, force: true });
    throw error;
  }
}

/** The 40-hex commit a ref (tag, branch, or SHA) names in the cached clone. */
export async function resolveRef(id: string, ref: string): Promise<string> {
  assertOperand('ref', ref);
  let commit: string;
  try {
    commit = (await git(['--git-dir', packRepoDir(id), 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim();
  } catch {
    throw new Error(`pack ${id}: ref ${ref} does not name a commit`);
  }
  assertCommit(commit);
  return commit;
}

/** Extract a commit into `packs/<id>/<commit>/` (temp dir, then rename); reuses an existing extraction. */
export async function extractCommit(id: string, commit: string): Promise<string> {
  const dir = packExtractDir(id, commit);
  if (await exists(dir)) return dir;
  const tmp = `${dir}.tmp-${randomBytes(6).toString('hex')}`;
  const tar = `${tmp}.tar`;
  try {
    await mkdir(tmp, { recursive: true });
    await git(['--git-dir', packRepoDir(id), 'archive', '--format=tar', '-o', tar, commit]);
    await execFileAsync('tar', ['-xf', tar, '-C', tmp]);
    try {
      await rename(tmp, dir);
    } catch (error) {
      if (!(await exists(dir))) throw error;
    }
    return dir;
  } finally {
    await rm(tmp, { recursive: true, force: true });
    await rm(tar, { force: true });
  }
}

/** Git object id of `path` at `commit` (a tree for a skill dir), or null when the path is absent. */
export async function treeHash(id: string, commit: string, path: string): Promise<string | null> {
  assertCommit(commit);
  try {
    return (await git(['--git-dir', packRepoDir(id), 'rev-parse', '--verify', '--quiet', `${commit}:${path}`])).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The remote commit `entry.ref` points at when it differs from the trusted
 * commit; null when up to date, pinned to a SHA, or the remote is unreachable.
 * Derived on demand, never stored.
 */
export async function packUpdateAvailable(entry: PackRegistryEntry): Promise<string | null> {
  if (COMMIT_PATTERN.test(entry.ref) || entry.ref === entry.commit) return null;
  if (!entry.url || entry.url.startsWith('-') || entry.ref.startsWith('-')) return null;
  let stdout: string;
  try {
    stdout = await git(['ls-remote', '--', entry.url, entry.ref, `${entry.ref}^{}`], { timeout: LS_REMOTE_TIMEOUT_MS });
  } catch {
    return null;
  }
  const refs = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const [sha, name] = line.trim().split('\t');
    if (sha && name && COMMIT_PATTERN.test(sha)) refs.set(name, sha);
  }
  const remote =
    refs.get(`refs/tags/${entry.ref}^{}`) ??
    refs.get(`refs/tags/${entry.ref}`) ??
    refs.get(`refs/heads/${entry.ref}`) ??
    refs.get(entry.ref) ??
    null;
  return remote && remote !== entry.commit ? remote : null;
}

export type PackSourceErrorCode = 'bad-id' | 'exists' | 'unknown-pack' | 'git';

export class PackSourceError extends Error {
  constructor(
    readonly code: PackSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PackSourceError';
  }
}

export interface PackPreview {
  id: string;
  url: string;
  ref: string;
  commit: string;
  adapter: PackAdapterId;
  manifest: PackManifest;
  previousCommit?: string;
  diff?: { added: string[]; removed: string[]; changed: string[]; newCapabilities: string[] };
}

export type ConfirmPack = (preview: PackPreview) => Promise<boolean>;

async function gitStep<T>(id: string, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof PackSourceError) throw error;
    const detail = (error as { stderr?: unknown }).stderr;
    const message = typeof detail === 'string' && detail.trim() ? detail.trim() : (error as Error).message;
    throw new PackSourceError('git', `pack ${id}: ${message}`);
  }
}

/** PD-13: registry adapter, then the known-pack default, then detection. */
async function packAdapter(id: string, dir: string, explicit?: PackAdapterId): Promise<PackAdapterId> {
  return explicit ?? KNOWN_PACKS[id]?.adapter ?? (await detectAdapter(dir));
}

async function manifestAt(id: string, dir: string, adapter: PackAdapterId): Promise<PackManifest> {
  return gitStep(id, () => readPackManifest(dir, adapter, { optIn: KNOWN_PACKS[id]?.optIn ?? [], skillsRoot: KNOWN_PACKS[id]?.skillsRoot }));
}

async function requirePack(id: string): Promise<PackRegistryEntry> {
  if (!PACK_ID_PATTERN.test(id)) throw new PackSourceError('bad-id', `invalid pack id: ${JSON.stringify(id)}`);
  const entry = await getPack(id);
  if (!entry) throw new PackSourceError('unknown-pack', `unknown pack: ${id}`);
  return entry;
}

/**
 * Fetch, resolve and preview a new pack; register it only when `confirm`
 * resolves true. Adding enables nothing.
 */
export async function addPack(
  input: { id: string; url: string; ref: string; adapter?: PackAdapterId; reservedIds?: readonly string[] },
  confirm: ConfirmPack,
): Promise<{ written: boolean; preview: PackPreview }> {
  const { id, url, ref } = input;
  if (!PACK_ID_PATTERN.test(id)) throw new PackSourceError('bad-id', `invalid pack id: ${JSON.stringify(id)}`);
  if (input.reservedIds?.includes(id)) {
    throw new PackSourceError('bad-id', `pack id ${id} is reserved by a core skill; choose another id`);
  }
  if (await getPack(id)) throw new PackSourceError('exists', `pack ${id} is already registered; use pan skills pack update ${id}`);

  const commit = await gitStep(id, async () => {
    await fetchPackSource(id, url);
    return resolveRef(id, ref);
  });
  const dir = await gitStep(id, () => extractCommit(id, commit));
  const adapter = await packAdapter(id, dir, input.adapter);
  const preview: PackPreview = { id, url, ref, commit, adapter, manifest: await manifestAt(id, dir, adapter) };
  if (!(await confirm(preview))) return { written: false, preview };
  await writePackEntry({ id, url, ref, commit, ...(input.adapter ? { adapter: input.adapter } : {}) });
  return { written: true, preview };
}

/**
 * Fetch the pack's ref (or a new one), preview the difference from the
 * trusted commit, and move the trusted commit only when `confirm` resolves
 * true. Nothing is asked or written when the commit and ref are unchanged.
 */
export async function updatePack(
  id: string,
  opts: { ref?: string },
  confirm: ConfirmPack,
): Promise<{ written: boolean; preview: PackPreview }> {
  const entry = await requirePack(id);
  const ref = opts.ref ?? entry.ref;
  const commit = await gitStep(id, async () => {
    await fetchPackSource(id, entry.url);
    return resolveRef(id, ref);
  });
  const dir = await gitStep(id, () => extractCommit(id, commit));
  const oldDir = await gitStep(id, () => extractCommit(id, entry.commit));
  const adapter = await packAdapter(id, dir, entry.adapter);
  const manifest = await manifestAt(id, dir, adapter);
  const oldManifest = await manifestAt(id, oldDir, adapter);

  const oldByName = new Map(oldManifest.skills.map((skill) => [skill.name, skill]));
  const newNames = new Set(manifest.skills.map((skill) => skill.name));
  const changed: string[] = [];
  for (const skill of manifest.skills) {
    const before = oldByName.get(skill.name);
    if (!before) continue;
    const [oldHash, newHash] = await Promise.all([treeHash(id, entry.commit, before.dir), treeHash(id, commit, skill.dir)]);
    if (oldHash !== newHash) changed.push(skill.name);
  }
  const oldLabels = new Set(notAppliedLabels(oldManifest.capabilities));
  const preview: PackPreview = {
    id,
    url: entry.url,
    ref,
    commit,
    adapter,
    manifest,
    previousCommit: entry.commit,
    diff: {
      added: manifest.skills.map((skill) => skill.name).filter((name) => !oldByName.has(name)),
      removed: oldManifest.skills.map((skill) => skill.name).filter((name) => !newNames.has(name)),
      changed,
      newCapabilities: notAppliedLabels(manifest.capabilities).filter((label) => !oldLabels.has(label)),
    },
  };
  if (commit === entry.commit && ref === entry.ref) return { written: false, preview };
  if (!(await confirm(preview))) return { written: false, preview };
  await writePackEntry({ ...entry, ref, commit });
  return { written: true, preview };
}

/**
 * PD-11: unregister a pack, clear its global toggle and global per-skill
 * overrides, and delete its cache. Project and issue entries stay (inert).
 */
export async function removePack(id: string): Promise<{ removed: boolean }> {
  if (!PACK_ID_PATTERN.test(id)) throw new PackSourceError('bad-id', `invalid pack id: ${JSON.stringify(id)}`);
  const removed = (await getPack(id)) !== null;
  if (removed) await deletePackEntry(id);
  await rm(packCacheDir(id), { recursive: true, force: true });
  return { removed };
}

/** Re-fetch a registered pack and make sure its trusted commit is extracted. Never moves the commit. */
export async function syncPack(id: string): Promise<{ commit: string; dir: string }> {
  const entry = await requirePack(id);
  const dir = await gitStep(id, async () => {
    await fetchPackSource(id, entry.url);
    await resolveRef(id, entry.commit);
    return extractCommit(id, entry.commit);
  });
  return { commit: entry.commit, dir };
}
