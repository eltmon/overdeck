/**
 * Skill pack mounts (PAN-4334): the content-addressed wrapper that exposes the
 * enabled pack skills to Claude Code (`--plugin-dir`) and Codex (local
 * marketplace) for one launch.
 *
 *   ~/.overdeck/packs/mounts/<sha256>/
 *     .agents/plugins/marketplace.json          Codex local marketplace
 *     plugins/<pack>/.claude-plugin/plugin.json
 *     plugins/<pack>/.codex-plugin/plugin.json
 *     plugins/<pack>/skills/<skill>/…           copies, never symlinks; verbatim unless
 *                                               the pack has a transform (PAN-3943)
 *
 * The wrapper holds only skill directories, so upstream hooks, MCP servers
 * and commands are left out by construction. Mounts are derived and immutable
 * once renamed into place. Nothing here imports `src/lib/skill-overrides/`.
 */
import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix } from 'node:path';
import { removeCodexPluginCaches } from '../agents/state-dir-removal.js';
import { getOverdeckHome } from '../paths.js';
import { applyDeftHostNotice, DEFT_HOST_NOTICE_VERSION } from './deft.js';
import { GSTACK_RENDER_VERSION } from './gstack.js';
import { PACK_ID_PATTERN, packsHome } from './sources.js';

export const MOUNT_FORMAT_VERSION = 2;
export const CODEX_PACK_MARKETPLACE = 'overdeck-packs';
export const CODEX_PACK_BLOCK_BEGIN = '# overdeck:skill-packs:begin';
export const CODEX_PACK_BLOCK_END = '# overdeck:skill-packs:end';
/**
 * Written into `plugins/<pack>/` of a mount built from a `gstack-runtime` render: the render
 * root its skills call by absolute path, so gc keeps that render while the mount is linked.
 */
export const MOUNT_RENDER_ROOT_FILE = '.overdeck-render-root';
/** Name of the per-launch Claude plugin link under `<OVERDECK_HOME>/launch/<launchKey>/`. */
export const CLAUDE_PLUGIN_LINK_NAME = 'skill-packs';

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

/**
 * `deft-readonly`: rename each SKILL.md to the stripped name and insert the Deft host notice.
 * `gstack-runtime`: copy verbatim from the gstack render root (PAN-4727); the tag keys the hash on
 * GSTACK_RENDER_VERSION.
 */
export type MountTransform = 'deft-readonly' | 'gstack-runtime';

/** The transform's part of a mount hash entry, versioned so a contract change yields new mounts. */
function transformTag(transform: MountTransform | undefined): string {
  if (transform === 'deft-readonly') return `deft-readonly.${DEFT_HOST_NOTICE_VERSION}`;
  if (transform === 'gstack-runtime') return `gstack-runtime.${GSTACK_RENDER_VERSION}`;
  return '';
}

export interface MountPack {
  id: string;
  commit: string;
  /** Extraction dir of the pack at `commit` (the render dir for `gstack-runtime`). */
  root: string;
  transform?: MountTransform;
  skills: Array<{ name: string; dir: string }>;
  /** Repo-relative plugin root the extras are read from (default: the repo root). */
  pluginRoot?: string;
  /** Plugin-root-relative files or dirs copied to plugins/<pack>/<extra>. */
  extras?: string[];
}

export interface MountSelection {
  packs: MountPack[];
}

export interface Mount {
  path: string;
  hash: string;
  packIds: string[];
}

export function mountsDir(): string {
  return join(packsHome(), 'mounts');
}

export function mountHash(selection: MountSelection): string {
  const entries = selection.packs
    .flatMap((pack) =>
      pack.skills.map((skill) => `${pack.id}@${pack.commit}:${skill.name}:${transformTag(pack.transform)}`),
    )
    .concat(
      selection.packs.flatMap((pack) =>
        (pack.extras ?? []).map((extra) => `${pack.id}@${pack.commit}:+${pack.pluginRoot ?? ''}/${extra}`),
      ),
    )
    .sort();
  return createHash('sha256').update(JSON.stringify({ v: MOUNT_FORMAT_VERSION, s: entries })).digest('hex');
}

function assertMountPack(pack: MountPack): void {
  if (!PACK_ID_PATTERN.test(pack.id)) throw new Error(`invalid pack id: ${JSON.stringify(pack.id)}`);
  if (!COMMIT_PATTERN.test(pack.commit)) throw new Error(`invalid pack commit: ${JSON.stringify(pack.commit)}`);
  if (pack.transform !== undefined && pack.transform !== 'deft-readonly' && pack.transform !== 'gstack-runtime') {
    throw new Error(`invalid pack transform: ${JSON.stringify(pack.transform)}`);
  }
  for (const skill of pack.skills) {
    if (!SKILL_NAME_PATTERN.test(skill.name)) throw new Error(`invalid skill name: ${JSON.stringify(skill.name)}`);
    const normalized = posix.normalize(skill.dir);
    if (isAbsolute(skill.dir) || normalized === '..' || normalized.startsWith('../')) {
      throw new Error(`skill dir escapes pack ${pack.id}: ${JSON.stringify(skill.dir)}`);
    }
  }
  for (const extra of pack.extras ?? []) {
    const normalized = posix.normalize(extra);
    if (isAbsolute(extra) || normalized === '..' || normalized.startsWith('../')) {
      throw new Error(`mount path escapes pack ${pack.id}: ${JSON.stringify(extra)}`);
    }
    if (normalized === 'skills' || normalized === '.claude-plugin' || normalized === '.codex-plugin') {
      throw new Error(`mount extra collides with generated content in pack ${pack.id}: ${JSON.stringify(extra)}`);
    }
    if (normalized.startsWith('skills/') || normalized.startsWith('.claude-plugin/') || normalized.startsWith('.codex-plugin/')) {
      throw new Error(`mount extra collides with generated content in pack ${pack.id}: ${JSON.stringify(extra)}`);
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function touch(path: string): Promise<void> {
  const now = new Date();
  await utimes(path, now, now);
}

/** PD-8: copy a directory tree, skipping every symlink so nothing outside the pack can enter the mount. */
async function copyWithoutSymlinks(src: string, dst: string): Promise<void> {
  await cp(src, dst, {
    recursive: true,
    filter: async (path) => !(await lstat(path)).isSymbolicLink(),
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function populateMount(dir: string, packs: MountPack[], hash: string): Promise<void> {
  await writeJson(join(dir, '.agents', 'plugins', 'marketplace.json'), {
    name: CODEX_PACK_MARKETPLACE,
    plugins: packs.map((pack) => ({ name: pack.id, source: { source: 'local', path: `./plugins/${pack.id}` } })),
  });
  for (const pack of packs) {
    const pluginDir = join(dir, 'plugins', pack.id);
    const description = `Overdeck skill pack ${pack.id} @ ${pack.commit.slice(0, 12)}`;
    const skills = [...pack.skills].sort((a, b) => a.name.localeCompare(b.name));
    await writeJson(join(pluginDir, '.claude-plugin', 'plugin.json'), {
      name: pack.id,
      version: hash,
      description,
      skills: skills.map((skill) => `./skills/${skill.name}`),
    });
    await writeJson(join(pluginDir, '.codex-plugin', 'plugin.json'), {
      name: pack.id,
      version: hash,
      description,
      skills: './skills/',
    });
    for (const skill of skills) {
      const dst = join(pluginDir, 'skills', skill.name);
      await copyWithoutSymlinks(join(pack.root, skill.dir), dst);
      if (pack.transform === 'deft-readonly') {
        const skillMd = join(dst, 'SKILL.md');
        await writeFile(skillMd, applyDeftHostNotice(await readFile(skillMd, 'utf8'), skill.name), 'utf8');
      }
    }
    for (const extra of pack.extras ?? []) {
      const src = join(pack.root, pack.pluginRoot ?? '', extra);
      if (!(await exists(src))) continue;
      await copyWithoutSymlinks(src, join(pluginDir, extra));
    }
    if (pack.transform === 'gstack-runtime') await writeFile(join(pluginDir, MOUNT_RENDER_ROOT_FILE), `${pack.root}\n`, 'utf8');
  }
}

/** A runtime pack's render ages like its mount: using the mount touches the render too. */
async function touchRenderRoots(packs: MountPack[]): Promise<void> {
  for (const pack of packs) {
    if (pack.transform === 'gstack-runtime') await touch(pack.root).catch(() => undefined);
  }
}

/** Build (or reuse and touch) the mount for a selection; null when it holds no skills. */
export async function buildMount(selection: MountSelection): Promise<Mount | null> {
  const packs = selection.packs.filter((pack) => pack.skills.length > 0).sort((a, b) => a.id.localeCompare(b.id));
  if (packs.length === 0) return null;
  packs.forEach(assertMountPack);
  const hash = mountHash({ packs });
  const path = join(mountsDir(), hash);
  const mount: Mount = { path, hash, packIds: packs.map((pack) => pack.id) };
  await touchRenderRoots(packs);
  if (await exists(path)) {
    await touch(path);
    return mount;
  }
  await mkdir(mountsDir(), { recursive: true });
  const tmp = await mkdtemp(join(mountsDir(), '.tmp-'));
  try {
    await populateMount(tmp, packs, hash);
    await rename(tmp, path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if ((code !== 'EEXIST' && code !== 'ENOTEMPTY') || !(await exists(path))) throw error;
    await touch(path);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return mount;
}

/** Point the per-launch plugin link at `<mount>/plugins` (atomic replace), or remove it when there is no mount. */
export async function linkClaudeMount(link: string, mount: Mount | null): Promise<void> {
  if (mount === null) {
    await rm(link, { force: true });
    return;
  }
  await mkdir(dirname(link), { recursive: true });
  const tmp = `${link}.tmp-${process.pid}`;
  await rm(tmp, { force: true });
  await symlink(join(mount.path, 'plugins'), tmp);
  await rename(tmp, link);
}

function escapeTomlBasicString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stripPackBlock(content: string): string {
  const begin = content.indexOf(CODEX_PACK_BLOCK_BEGIN);
  if (begin === -1) return content;
  const end = content.indexOf(CODEX_PACK_BLOCK_END, begin);
  const after = end === -1 ? content.length : end + CODEX_PACK_BLOCK_END.length;
  return stripPackBlock(content.slice(0, begin) + content.slice(after));
}

async function listDirNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).map((dirent) => dirent.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Copy each mounted plugin into the Codex plugin cache and remove every other `overdeck-packs` entry. */
async function syncCodexPackCache(codexHome: string, mount: Mount | null): Promise<void> {
  const cacheRoot = join(codexHome, 'plugins', 'cache', CODEX_PACK_MARKETPLACE);
  if (mount === null) {
    await rm(cacheRoot, { recursive: true, force: true });
    return;
  }
  for (const id of mount.packIds) {
    const target = join(cacheRoot, id, mount.hash);
    if (await exists(target)) continue;
    const tmp = `${target}.tmp-${process.pid}`;
    await rm(tmp, { recursive: true, force: true });
    await mkdir(dirname(target), { recursive: true });
    await copyWithoutSymlinks(join(mount.path, 'plugins', id), tmp);
    try {
      await rename(tmp, target);
    } catch (error) {
      await rm(tmp, { recursive: true, force: true });
      if (!(await exists(target))) throw error;
    }
  }
  for (const id of await listDirNames(cacheRoot)) {
    if (!mount.packIds.includes(id)) {
      await rm(join(cacheRoot, id), { recursive: true, force: true });
      continue;
    }
    for (const version of await listDirNames(join(cacheRoot, id))) {
      if (version !== mount.hash) await rm(join(cacheRoot, id, version), { recursive: true, force: true });
    }
  }
}

/**
 * Replace the managed skill-pack block in `<codexHome>/config.toml` and sync
 * the Codex plugin cache. Idempotent; a null mount removes both.
 */
export async function writeCodexPackBlock(codexHome: string, mount: Mount | null): Promise<void> {
  const path = join(codexHome, 'config.toml');
  let existing = '';
  try {
    existing = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const base = stripPackBlock(existing).trimEnd();
  const block =
    mount === null
      ? ''
      : [
          CODEX_PACK_BLOCK_BEGIN,
          `[marketplaces.${CODEX_PACK_MARKETPLACE}]`,
          'source_type = "local"',
          `source = "${escapeTomlBasicString(mount.path)}"`,
          ...mount.packIds.flatMap((id) => ['', `[plugins."${id}@${CODEX_PACK_MARKETPLACE}"]`, 'enabled = true']),
          CODEX_PACK_BLOCK_END,
        ].join('\n');
  const next = [base, block].filter(Boolean).join('\n\n');
  await mkdir(codexHome, { recursive: true });
  await writeFile(path, next ? `${next}\n` : '', { mode: 0o600 });
  await chmod(path, 0o600);
  await syncCodexPackCache(codexHome, mount);
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

/**
 * Remove launch plugin links whose target is gone; return them and the mounts
 * the remaining links reference.
 */
async function sweepLaunchLinks(): Promise<{ removedLinks: string[]; referenced: Set<string> }> {
  const removedLinks: string[] = [];
  const referenced = new Set<string>();
  const launchRoot = join(getOverdeckHome(), 'launch');
  for (const key of await listDirNames(launchRoot)) {
    const link = join(launchRoot, key, CLAUDE_PLUGIN_LINK_NAME);
    let stats;
    try {
      stats = await lstat(link);
    } catch {
      continue;
    }
    if (!stats.isSymbolicLink()) continue;
    const target = await realpathOrNull(link);
    if (target === null) {
      await rm(link, { force: true });
      removedLinks.push(link);
    } else {
      referenced.add(dirname(target));
    }
  }
  return { removedLinks, referenced };
}

/**
 * PD-12: remove launch plugin links whose target is gone, then mounts that no
 * link references and whose mtime is older than `maxAgeMs`, plus stray
 * `.tmp-*` build dirs of the same age. Reusing a mount touches it, so a mount
 * in active use stays young.
 */
export async function gcMounts(
  opts: { maxAgeMs: number; now?: number },
): Promise<{ removedMounts: string[]; removedLinks: string[]; referencedMounts: string[] }> {
  const now = opts.now ?? Date.now();
  const { removedLinks, referenced } = await sweepLaunchLinks();

  const removedMounts: string[] = [];
  const root = mountsDir();
  for (const name of await listDirNames(root)) {
    const path = join(root, name);
    let stats;
    try {
      stats = await lstat(path);
    } catch {
      continue;
    }
    if (now - stats.mtimeMs <= opts.maxAgeMs) continue;
    if (!name.startsWith('.tmp-')) {
      const resolved = await realpathOrNull(path);
      if (resolved !== null && referenced.has(resolved)) continue;
    }
    await rm(path, { recursive: true, force: true });
    removedMounts.push(path);
  }
  return { removedMounts, removedLinks, referencedMounts: [...referenced] };
}

/**
 * PAN-4727 D8: remove every trace of a pack outside its cache dir: each mount
 * that holds `plugins/<id>`, the launch links that left dangling, and
 * `plugins/cache/overdeck-packs/<id>` in every Codex home under
 * `<OVERDECK_HOME>/agents/<agent>/codex-home*`. A running agent that used a
 * removed mount loses the pack's skills until its next launch.
 */
export async function removePackFromMounts(
  id: string,
): Promise<{ removedMounts: string[]; removedLinks: string[]; removedCodexCaches: string[]; failures: string[] }> {
  if (!PACK_ID_PATTERN.test(id)) throw new Error(`invalid pack id: ${JSON.stringify(id)}`);
  // One failed removal must not stop the rest of the sweep; failures are reported, and rerunning remove retries them.
  const failures: string[] = [];
  const describe = (path: string, error: unknown) => `${path}: ${error instanceof Error ? error.message : String(error)}`;
  const removedMounts: string[] = [];
  const root = mountsDir();
  for (const name of await listDirNames(root)) {
    if (name.startsWith('.tmp-')) continue;
    const path = join(root, name);
    if (!(await exists(join(path, 'plugins', id)))) continue;
    try {
      await rm(path, { recursive: true, force: true });
      removedMounts.push(path);
    } catch (error) {
      failures.push(describe(path, error));
    }
  }
  let removedLinks: string[] = [];
  try {
    ({ removedLinks } = await sweepLaunchLinks());
  } catch (error) {
    failures.push(describe(join(getOverdeckHome(), 'launch'), error));
  }

  // Agent dirs have one deletion door (PAN-3357), which also refuses symlinks and escapes.
  const agentsRoot = join(getOverdeckHome(), 'agents');
  let removedCodexCaches: string[] = [];
  try {
    removedCodexCaches = await removeCodexPluginCaches(CODEX_PACK_MARKETPLACE, id, agentsRoot);
  } catch (error) {
    failures.push(describe(agentsRoot, error));
  }
  return { removedMounts, removedLinks, removedCodexCaches, failures };
}

/** Render roots that the given mounts' runtime packs call into (read from MOUNT_RENDER_ROOT_FILE). */
export async function renderRootsUsedBy(mounts: readonly string[]): Promise<Set<string>> {
  const roots = new Set<string>();
  for (const mount of mounts) {
    for (const id of await listDirNames(join(mount, 'plugins'))) {
      try {
        const root = (await readFile(join(mount, 'plugins', id, MOUNT_RENDER_ROOT_FILE), 'utf8')).trim();
        if (root) roots.add(root);
      } catch {
        // Not a runtime pack.
      }
    }
  }
  return roots;
}
