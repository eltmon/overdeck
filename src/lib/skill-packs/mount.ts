/**
 * Skill pack mounts (PAN-4334): the content-addressed wrapper that exposes the
 * enabled pack skills to Claude Code (`--plugin-dir`) and Codex (local
 * marketplace) for one launch.
 *
 *   ~/.overdeck/packs/mounts/<sha256>/
 *     .agents/plugins/marketplace.json          Codex local marketplace
 *     plugins/<pack>/.claude-plugin/plugin.json
 *     plugins/<pack>/.codex-plugin/plugin.json
 *     plugins/<pack>/skills/<skill>/…           verbatim copies, never symlinks
 *
 * The wrapper holds only skill directories, so upstream hooks, MCP servers
 * and commands are left out by construction. Mounts are derived and immutable
 * once renamed into place. Nothing here imports `src/lib/skill-overrides/`.
 */
import { createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix } from 'node:path';
import { PACK_ID_PATTERN, packsHome } from './sources.js';

export const MOUNT_FORMAT_VERSION = 1;
export const CODEX_PACK_MARKETPLACE = 'overdeck-packs';
export const CODEX_PACK_BLOCK_BEGIN = '# overdeck:skill-packs:begin';
export const CODEX_PACK_BLOCK_END = '# overdeck:skill-packs:end';

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export interface MountPack {
  id: string;
  commit: string;
  /** Extraction dir of the pack at `commit`. */
  root: string;
  skills: Array<{ name: string; dir: string }>;
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
    .flatMap((pack) => pack.skills.map((skill) => `${pack.id}@${pack.commit}:${skill.name}`))
    .sort();
  return createHash('sha256').update(JSON.stringify({ v: MOUNT_FORMAT_VERSION, s: entries })).digest('hex');
}

function assertMountPack(pack: MountPack): void {
  if (!PACK_ID_PATTERN.test(pack.id)) throw new Error(`invalid pack id: ${JSON.stringify(pack.id)}`);
  if (!COMMIT_PATTERN.test(pack.commit)) throw new Error(`invalid pack commit: ${JSON.stringify(pack.commit)}`);
  for (const skill of pack.skills) {
    if (!SKILL_NAME_PATTERN.test(skill.name)) throw new Error(`invalid skill name: ${JSON.stringify(skill.name)}`);
    const normalized = posix.normalize(skill.dir);
    if (isAbsolute(skill.dir) || normalized === '..' || normalized.startsWith('../')) {
      throw new Error(`skill dir escapes pack ${pack.id}: ${JSON.stringify(skill.dir)}`);
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
      await copyWithoutSymlinks(join(pack.root, skill.dir), join(pluginDir, 'skills', skill.name));
    }
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
