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
import type { PackAdapterId } from './adapters.js';

export const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const ADAPTERS: readonly PackAdapterId[] = ['plain', 'claude-plugin'];
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
