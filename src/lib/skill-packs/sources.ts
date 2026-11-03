/**
 * Skill pack sources (PAN-4334): the pack registry and the pack cache paths.
 *
 * - registry: `~/.overdeck/config.yaml` → `skills.packs.<id>: { url, ref, commit, adapter?, browser? }`
 *   (the trusted commit and the browser-runtime consent are operator decisions, so they are stored)
 * - cache:    `~/.overdeck/packs/<id>/` (derived; deletable at any time)
 *
 * Server-reachable: every fs and git call is async. Nothing here imports
 * `src/lib/skill-overrides/` (that module will import this one).
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
import {
  assertBrowserBuildable,
  BrowserError,
  browserCommand,
  browserDownloads,
  buildBrowserRuntime,
  isBrowserReady,
} from './browser.js';
import { assertGoAvailable, buildOx, isOxBuildReady, OxBuildError, oxBuildCommands, oxBuildDownloads } from './ox-build.js';
import { assertRenderable, isRenderReady, RenderError, renderCommand, renderRuntimePack } from './render.js';

export const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const ADAPTERS: readonly PackAdapterId[] = ['plain', 'claude-plugin', 'deft-readonly', 'gstack-runtime'];
const LS_REMOTE_TIMEOUT_MS = 5000;

const execFileAsync = promisify(execFile);

export interface PackRegistryEntry {
  id: string;
  url: string;
  ref: string;
  commit: string;
  adapter?: PackAdapterId;
  /** gstack-runtime only: the operator trusted the browser runtime (PAN-4730). */
  browser?: true;
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

/** PAN-4852 AD-5: Go's caches and config for the sageox build. */
export function packGoDir(id: string): string {
  return join(packCacheDir(id), 'go');
}

export function packExtractDir(id: string, commit: string): string {
  assertCommit(commit);
  return join(packCacheDir(id), commit);
}

/** A gstack-runtime pack's render of one commit (eltmon/gstack pack mode). */
export function packRenderDir(id: string, commit: string): string {
  assertCommit(commit);
  return join(packCacheDir(id), 'render', commit);
}

/** A runtime pack's state root, shared across commits; removed with the pack. */
export function packStateDir(id: string): string {
  return join(packCacheDir(id), 'state');
}

/** A runtime pack's browser cache (bun package cache and Chromium), shared across commits; removed with the pack. */
export function packBrowserDir(id: string): string {
  return join(packCacheDir(id), 'browser');
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
  const { url, ref, commit, adapter, browser } = raw as Record<string, unknown>;
  if (typeof url !== 'string' || !url || typeof ref !== 'string' || !ref) return null;
  if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) return null;
  if (adapter !== undefined && !ADAPTERS.includes(adapter as PackAdapterId)) return null;
  // Only `browser: true` records consent; any other value is ignored, not a malformed entry.
  return {
    id,
    url,
    ref,
    commit,
    ...(adapter ? { adapter: adapter as PackAdapterId } : {}),
    ...(browser === true ? { browser: true as const } : {}),
  };
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

/**
 * The registry as gc must read it (PAN-4727): every `skills.packs` key counts as registered, with its
 * trusted commit, or null when the entry is malformed; `readable` is false when config.yaml cannot be
 * read or parsed, or `skills.packs` is not a map. Unlike listPacks, nothing is silently dropped, so gc
 * never mistakes a registered pack for an orphan.
 */
export async function readPackRegistry(): Promise<{ readable: boolean; packs: Map<string, string | null> }> {
  const packs = new Map<string, string | null>();
  let doc: Document;
  try {
    doc = parseDocument(await readTextOrEmpty(getGlobalConfigPath()));
  } catch {
    return { readable: false, packs };
  }
  if (doc.errors.length > 0) return { readable: false, packs };
  const raw = (doc.toJS() as { skills?: { packs?: unknown } } | null)?.skills?.packs;
  if (raw === undefined || raw === null) return { readable: true, packs };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { readable: false, packs };
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    packs.set(id, toEntry(id, value)?.commit ?? null);
  }
  return { readable: true, packs };
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
    ...(entry.browser === true ? { browser: true } : {}),
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

async function isDirAt(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Extract a commit into `packs/<id>/<commit>/` (temp dir, then rename);
 * reuses an existing extraction, unless `pluginRoot` is given and missing
 * from it, in which case the stale extraction is removed and rebuilt.
 */
export async function extractCommit(id: string, commit: string, pluginRoot?: string): Promise<string> {
  if (pluginRoot !== undefined) assertOperand('plugin root', pluginRoot);
  const dir = packExtractDir(id, commit);
  if (await exists(dir)) {
    if (!pluginRoot || (await isDirAt(join(dir, pluginRoot)))) return dir;
    await rm(dir, { recursive: true, force: true });
  }
  const tmp = `${dir}.tmp-${randomBytes(6).toString('hex')}`;
  const tar = `${tmp}.tar`;
  try {
    await mkdir(tmp, { recursive: true });
    await git([
      '--git-dir',
      packRepoDir(id),
      'archive',
      '--format=tar',
      '-o',
      tar,
      commit,
      ...(pluginRoot ? ['--', pluginRoot] : []),
    ]);
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

export type PackSourceErrorCode = 'bad-id' | 'exists' | 'unknown-pack' | 'git' | 'render';

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
  pluginRoot?: string;
  previousCommit?: string;
  diff?: { added: string[]; removed: string[]; changed: string[]; newCapabilities: string[] };
  /** Runtime packs: the render command trusting runs once, with `cwd` = the extraction. */
  runtime?: { command: string[] };
  /** gstack browser runtime (PAN-4730): the build command, every download, and every path it writes. */
  browser?: { command: string[]; downloads: string[]; writes: string[] };
  /** sageox (PAN-4852 AD-8): the `go build` commands, every path they write, and what they download. */
  oxBuild?: { commands: string[][]; writes: string[]; downloads: string[] };
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

const pluginRootOf = (id: string): string | undefined => KNOWN_PACKS[id]?.pluginRoot;

async function manifestAt(id: string, dir: string, adapter: PackAdapterId, browser = false): Promise<PackManifest> {
  return gitStep(id, () =>
    readPackManifest(dir, adapter, {
      optIn: KNOWN_PACKS[id]?.optIn ?? [],
      skillsRoot: KNOWN_PACKS[id]?.skillsRoot,
      pluginRoot: pluginRootOf(id),
      browser,
    }),
  );
}

async function renderStep<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof RenderError || error instanceof BrowserError || error instanceof OxBuildError) {
      throw new PackSourceError('render', error.message);
    }
    throw error;
  }
}

/** Before consent: the commit supports pack mode and bun is on PATH; returns the command trusting runs. */
async function runtimePreview(id: string, dir: string, commit: string): Promise<{ command: string[] }> {
  await renderStep(() => assertRenderable(dir, commit));
  return { command: renderCommand(packRenderDir(id, commit), packStateDir(id)) };
}

/** After consent, before the registry write: render the commit unless its render is already ready. */
async function renderPack(id: string, dir: string, commit: string): Promise<void> {
  const renderDir = packRenderDir(id, commit);
  if (await isRenderReady(renderDir)) return;
  await renderStep(() => renderRuntimePack({ extractDir: dir, commit, renderDir, stateDir: packStateDir(id) }));
}

/** Before consent: the commit has the browser step and bun is on PATH; returns what trusting runs, downloads and writes. */
async function browserPreview(id: string, dir: string, commit: string): Promise<NonNullable<PackPreview['browser']>> {
  await renderStep(() => assertBrowserBuildable(dir, commit));
  const renderDir = packRenderDir(id, commit);
  const cacheDir = packBrowserDir(id);
  return {
    command: browserCommand(renderDir, cacheDir),
    downloads: await browserDownloads(dir),
    writes: [
      `${renderDir}/node_modules`,
      `${renderDir}/browse/dist`,
      `${renderDir}/design/dist`,
      `${renderDir}/make-pdf/dist`,
      `${cacheDir}/bun-cache`,
      `${cacheDir}/playwright`,
      `${cacheDir}/xdg-cache`,
    ],
  };
}

/** After consent: build the browser runtime into the commit's ready render. */
async function buildPackBrowser(id: string, dir: string, commit: string): Promise<void> {
  await renderStep(() =>
    buildBrowserRuntime({ extractDir: dir, commit, renderDir: packRenderDir(id, commit), cacheDir: packBrowserDir(id) }),
  );
}

/** PAN-4852 D5: Overdeck builds `ox` (and its session adapters) for the sageox pack. */
const buildsOx = (id: string): boolean => id === 'sageox';

/** Before consent (AD-8/AD-9): go is on PATH; returns the build commands, writes and downloads. */
async function oxBuildPreview(id: string, dir: string): Promise<NonNullable<PackPreview['oxBuild']>> {
  const goDir = packGoDir(id);
  await renderStep(() => assertGoAvailable(undefined, goDir));
  const binDir = join(dir, 'bin');
  return {
    commands: oxBuildCommands(binDir),
    writes: [`${binDir}/`, `${goDir}/`],
    downloads: await oxBuildDownloads(dir, undefined, goDir),
  };
}

/** After consent, before the registry write: build the commit unless its build is already ready. */
async function buildPackOx(id: string, dir: string, commit: string): Promise<void> {
  if (await isOxBuildReady(dir, commit)) return;
  await renderStep(() => buildOx({ extractDir: dir, commit, goDir: packGoDir(id) }));
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
  const dir = await gitStep(id, () => extractCommit(id, commit, pluginRootOf(id)));
  const adapter = await packAdapter(id, dir, input.adapter);
  const runtime = adapter === 'gstack-runtime' ? await runtimePreview(id, dir, commit) : undefined;
  const preview: PackPreview = {
    id,
    url,
    ref,
    commit,
    adapter,
    manifest: await manifestAt(id, dir, adapter),
    ...(runtime ? { runtime } : {}),
    ...(pluginRootOf(id) ? { pluginRoot: pluginRootOf(id) } : {}),
  };
  if (buildsOx(id)) preview.oxBuild = await oxBuildPreview(id, dir);
  if (!(await confirm(preview))) return { written: false, preview };
  if (runtime) await renderPack(id, dir, commit);
  if (buildsOx(id)) await buildPackOx(id, dir, commit);
  await writePackEntry({ id, url, ref, commit, ...(input.adapter ? { adapter: input.adapter } : {}) });
  return { written: true, preview };
}

/**
 * Fetch the pack's ref (or a new one), preview the difference from the
 * trusted commit, and move the trusted commit only when `confirm` resolves
 * true. Nothing is asked or written when the commit and ref are unchanged.
 * With browser consent recorded, the new commit's browser runtime is built too,
 * and the commit moves only when both the render and the build succeed.
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
  const dir = await gitStep(id, () => extractCommit(id, commit, pluginRootOf(id)));
  const oldDir = await gitStep(id, () => extractCommit(id, entry.commit, pluginRootOf(id)));
  const adapter = await packAdapter(id, dir, entry.adapter);
  // With browser consent recorded, both sides list the browser skills that mount.
  const browser = adapter === 'gstack-runtime' && entry.browser === true;
  const manifest = await manifestAt(id, dir, adapter, browser);
  const oldManifest = await manifestAt(id, oldDir, adapter, browser);

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
    ...(pluginRootOf(id) ? { pluginRoot: pluginRootOf(id) } : {}),
    previousCommit: entry.commit,
    diff: {
      added: manifest.skills.map((skill) => skill.name).filter((name) => !oldByName.has(name)),
      removed: oldManifest.skills.map((skill) => skill.name).filter((name) => !newNames.has(name)),
      changed,
      newCapabilities: notAppliedLabels(manifest.capabilities).filter((label) => !oldLabels.has(label)),
    },
  };
  if (commit === entry.commit && ref === entry.ref) return { written: false, preview };
  // Checked only when there is something to move to, so an up-to-date pack needs no bun.
  const runtime = adapter === 'gstack-runtime' ? await runtimePreview(id, dir, commit) : undefined;
  if (runtime) preview.runtime = runtime;
  // PAN-4730 D10: consent is recorded, so the new commit's browser runtime joins the same preview and confirmation.
  if (browser) preview.browser = await browserPreview(id, dir, commit);
  if (buildsOx(id)) preview.oxBuild = await oxBuildPreview(id, dir);
  if (!(await confirm(preview))) return { written: false, preview };
  if (runtime) await renderPack(id, dir, commit);
  if (browser && !(await isBrowserReady(packRenderDir(id, commit)))) await buildPackBrowser(id, dir, commit);
  if (buildsOx(id)) await buildPackOx(id, dir, commit);
  await writePackEntry({ ...entry, ref, commit });
  return { written: true, preview };
}

async function requireBrowserPack(id: string): Promise<PackRegistryEntry> {
  const entry = await requirePack(id);
  if ((entry.adapter ?? KNOWN_PACKS[id]?.adapter) !== 'gstack-runtime') {
    throw new PackSourceError('bad-id', `pack ${id} has no browser runtime`);
  }
  return entry;
}

/**
 * PAN-4730 D8/D10: preview the browser runtime for the trusted commit's ready
 * render and build it only when `confirm` resolves true; record consent
 * (`browser: true`) only after the build succeeded. Nothing is asked when
 * consent is recorded and the runtime is ready.
 */
export async function enablePackBrowser(
  id: string,
  confirm: ConfirmPack,
): Promise<{ written: boolean; preview?: PackPreview; alreadyOn?: boolean }> {
  const entry = await requireBrowserPack(id);
  const dir = await gitStep(id, () => extractCommit(id, entry.commit, pluginRootOf(id)));
  const renderDir = packRenderDir(id, entry.commit);
  if (!(await isRenderReady(renderDir))) {
    throw new PackSourceError('render', `pack ${id} is not rendered; run pan skills pack sync ${id}`);
  }
  if (entry.browser && (await isBrowserReady(renderDir))) return { written: false, alreadyOn: true };
  const browser = await browserPreview(id, dir, entry.commit);
  const preview: PackPreview = {
    id,
    url: entry.url,
    ref: entry.ref,
    commit: entry.commit,
    adapter: 'gstack-runtime',
    manifest: await manifestAt(id, dir, 'gstack-runtime', true),
    browser,
  };
  if (!(await confirm(preview))) return { written: false, preview };
  await buildPackBrowser(id, dir, entry.commit);
  await writePackEntry({ ...entry, browser: true });
  return { written: true, preview };
}

/**
 * PAN-4730 D11: clear the consent, render the trusted commit again without the
 * browser runtime, and delete the browser cache. Browse daemons are left
 * running (the CLI reports them).
 */
export async function disablePackBrowser(id: string): Promise<{ changed: boolean; renderDir: string; cacheDir: string }> {
  const entry = await requireBrowserPack(id);
  const renderDir = packRenderDir(id, entry.commit);
  const changed = entry.browser === true || (await isBrowserReady(renderDir));
  if (entry.browser) {
    const { url, ref, commit, adapter } = entry;
    await writePackEntry({ id, url, ref, commit, ...(adapter ? { adapter } : {}) });
  }
  const dir = await gitStep(id, () => extractCommit(id, entry.commit, pluginRootOf(id)));
  await rm(renderDir, { recursive: true, force: true });
  await renderPack(id, dir, entry.commit);
  const cacheDir = packBrowserDir(id);
  await rm(cacheDir, { recursive: true, force: true });
  return { changed, renderDir, cacheDir };
}

/**
 * Give the owner write access to every directory under `path` (never following
 * symlinks), so a recursive rm can unlink their entries. The Go toolchain that
 * GOTOOLCHAIN=auto unpacks into the sageox pack's module cache has read-only
 * directories even with -modcacherw.
 */
async function makeDirsWritable(path: string): Promise<void> {
  const stats = await lstat(path).catch(() => null);
  if (!stats?.isDirectory()) return;
  if ((stats.mode & 0o700) !== 0o700) await chmod(path, stats.mode | 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) await makeDirsWritable(join(path, entry.name));
  }
}

async function rmPackTree(path: string): Promise<void> {
  await makeDirsWritable(path);
  await rm(path, { recursive: true, force: true });
}

/**
 * PD-11: unregister a pack, clear its global toggle and global per-skill
 * overrides, and delete its cache. Project and issue entries stay (inert).
 * PAN-4852 AD-10: the sageox cache keeps its `bindings/` (SageOx link files need `ox login` and the
 * network to recreate); everything else in it is derived and goes.
 */
export async function removePack(id: string): Promise<{ removed: boolean; keptBindings?: string }> {
  if (!PACK_ID_PATTERN.test(id)) throw new PackSourceError('bad-id', `invalid pack id: ${JSON.stringify(id)}`);
  const removed = (await getPack(id)) !== null;
  if (removed) await deletePackEntry(id);
  const cacheDir = packCacheDir(id);
  const bindings = join(cacheDir, 'bindings');
  if (id === 'sageox' && (await lstat(bindings).then((s) => s.isDirectory(), () => false))) {
    for (const child of await readdir(cacheDir)) {
      if (child !== 'bindings') await rmPackTree(join(cacheDir, child));
    }
    return { removed, keptBindings: bindings };
  }
  await rmPackTree(cacheDir);
  return { removed };
}

/**
 * Re-fetch a registered pack and make sure its trusted commit is extracted, and for a runtime pack
 * rendered (and, with browser consent, its browser runtime built). Never moves the commit.
 */
export async function syncPack(id: string): Promise<{ commit: string; dir: string }> {
  const entry = await requirePack(id);
  const dir = await gitStep(id, async () => {
    await fetchPackSource(id, entry.url);
    await resolveRef(id, entry.commit);
    return extractCommit(id, entry.commit, pluginRootOf(id));
  });
  if ((entry.adapter ?? KNOWN_PACKS[id]?.adapter) === 'gstack-runtime') {
    await renderPack(id, dir, entry.commit);
    // PAN-4730 D8: consent is recorded, so sync builds a missing browser runtime without asking.
    if (entry.browser && !(await isBrowserReady(packRenderDir(id, entry.commit)))) await buildPackBrowser(id, dir, entry.commit);
  }
  // PAN-4852 AD-8: sync builds the already-trusted commit without asking.
  if (buildsOx(id)) await buildPackOx(id, dir, entry.commit);
  return { commit: entry.commit, dir };
}
