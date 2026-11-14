/**
 * Skill catalog (PAN-3942): the skill names Overdeck can see, for override
 * listing and write validation. A skill is a directory holding a SKILL.md.
 *
 * Pack skills (PAN-4334) have their own catalog, `listPackCatalog()`, because
 * they default off while native skills default on. `listPackCatalog` reuses a
 * pack's manifest while its extract dir keeps the same inode, mtime and ctime
 * (PAN-5238).
 *
 * Each entry carries the root it was read from as `origin` (PAN-4528):
 * 'overdeck' for `~/.overdeck/skills`, 'personal' for `~/.claude/skills` and
 * `~/.agents/skills`, 'project' for `<projectRoot>/.pan/skills`.
 */
import type { Stats } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createPromiseConcurrencyLimiter } from '../concurrency.js';
import {
  detectAdapter,
  KNOWN_PACKS,
  readPackManifest,
  readSkillFrontmatter,
  type PackAdapterId,
  type PackManifest,
} from '../skill-packs/adapters.js';
import { isBrowserReady } from '../skill-packs/browser.js';
import { isRenderReady } from '../skill-packs/render.js';
import { listPacks, packExtractDir, packRenderDir } from '../skill-packs/sources.js';

const CATALOG_FS_CONCURRENCY = 32;
const limitFs = createPromiseConcurrencyLimiter(CATALOG_FS_CONCURRENCY);

export type SkillOrigin = 'overdeck' | 'personal' | 'project';

export interface SkillCatalogEntry {
  name: string;
  description: string;
  origin: SkillOrigin;
  /** True when the skill exists only under `<projectRoot>/.pan/skills` (a "project skill"). */
  projectSkill?: boolean;
}

/** First line of the SKILL.md frontmatter `description`, or '' when absent or unparseable. */
export function parseSkillDescription(content: string): string {
  return readSkillFrontmatter(content).description;
}

async function readRoot(root: string, origin: SkillOrigin): Promise<SkillCatalogEntry[]> {
  let dirents;
  try {
    dirents = await limitFs(() => readdir(root, { withFileTypes: true }));
  } catch {
    return [];
  }
  const read = await Promise.all(
    dirents
      .filter((dirent) => dirent.isDirectory() || dirent.isSymbolicLink())
      .map(async (dirent): Promise<SkillCatalogEntry | null> => {
        let content: string;
        try {
          content = await limitFs(() => readFile(join(root, dirent.name, 'SKILL.md'), 'utf8'));
        } catch {
          return null;
        }
        const entry: SkillCatalogEntry = { name: dirent.name, description: parseSkillDescription(content), origin };
        if (origin === 'project') entry.projectSkill = true;
        return entry;
      }),
  );
  return read.filter((entry): entry is SkillCatalogEntry => entry !== null);
}

export async function listSkillCatalog(
  opts: { projectRoot?: string; home?: string } = {},
): Promise<SkillCatalogEntry[]> {
  const home = opts.home ?? homedir();
  const roots: Array<[string, SkillOrigin]> = [
    [join(home, '.overdeck', 'skills'), 'overdeck'],
    [join(home, '.claude', 'skills'), 'personal'],
    [join(home, '.agents', 'skills'), 'personal'],
    ...(opts.projectRoot ? [[join(opts.projectRoot, '.pan', 'skills'), 'project'] as [string, SkillOrigin]] : []),
  ];
  const perRoot = await Promise.all(roots.map(([root, origin]) => readRoot(root, origin)));
  const byName = new Map<string, SkillCatalogEntry>();
  for (const entries of perRoot) {
    for (const entry of entries) {
      if (!byName.has(entry.name)) byName.set(entry.name, entry);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface PackCatalogEntry {
  id: string;
  url: string;
  ref: string;
  commit: string;
  adapter: PackAdapterId;
  /** The trusted commit is extracted, and for a `gstack-runtime` pack also rendered. */
  cached: boolean;
  /** Null when the pack is not cached (or its manifest cannot be read). */
  manifest: PackManifest | null;
  /** gstack-runtime: 'off' (no consent), 'ready', or 'missing' (consent recorded, runtime not built). PAN-4730. */
  browser?: 'off' | 'ready' | 'missing';
  /** The operator confirmed a preview that listed this pack's MCP servers (PAN-5165). */
  mcp?: true;
}

async function dirStats(path: string): Promise<Stats | null> {
  try {
    const stats = await lstat(path);
    return stats.isDirectory() ? stats : null;
  } catch {
    return null;
  }
}

/** Pack manifests by extract dir (PAN-5238); `stamp` is the dir identity plus the read options. */
const manifestCache = new Map<string, { stamp: string; manifest: PackManifest }>();

/**
 * Registered packs with the manifest of their trusted commit, sorted by id. Reads the
 * cache only; no git. Reuses a pack's manifest while its extract dir keeps the same
 * inode, mtime and ctime (PAN-5238).
 */
export async function listPackCatalog(): Promise<PackCatalogEntry[]> {
  const packs = await listPacks();
  return Promise.all(
    packs.map(async (entry): Promise<PackCatalogEntry> => {
      const dir = packExtractDir(entry.id, entry.commit);
      const stats = await dirStats(dir);
      const extracted = stats !== null;
      const known = KNOWN_PACKS[entry.id];
      const adapter = entry.adapter ?? known?.adapter ?? (extracted ? await detectAdapter(dir) : 'plain');
      // A runtime pack mounts from its render, so it is usable only once the render is ready (PAN-4727).
      const cached =
        extracted && (adapter !== 'gstack-runtime' || (await isRenderReady(packRenderDir(entry.id, entry.commit))));
      // Consent is stored, readiness is derived from the trusted commit's render (PAN-4730 D8).
      const browser =
        adapter !== 'gstack-runtime'
          ? undefined
          : !entry.browser
            ? 'off'
            : (await isBrowserReady(packRenderDir(entry.id, entry.commit)))
              ? 'ready'
              : 'missing';
      let manifest: PackManifest | null = null;
      if (cached && stats) {
        const readOpts = {
          optIn: known?.optIn ?? [],
          skillsRoot: known?.skillsRoot,
          pluginRoot: known?.pluginRoot,
          browser: browser === 'ready',
          skillsExclude: known?.skillsExclude,
        };
        const stamp = `${stats.ino}:${stats.mtimeMs}:${stats.ctimeMs}:${adapter}:${JSON.stringify(readOpts)}`;
        const hit = manifestCache.get(dir);
        if (hit?.stamp === stamp) {
          manifest = hit.manifest;
        } else {
          try {
            manifest = await readPackManifest(dir, adapter, readOpts);
            manifestCache.set(dir, { stamp, manifest });
          } catch {
            manifest = null;
            manifestCache.delete(dir);
          }
        }
      }
      return {
        id: entry.id,
        url: entry.url,
        ref: entry.ref,
        commit: entry.commit,
        adapter,
        cached,
        manifest,
        ...(browser ? { browser } : {}),
        ...(entry.mcp === true ? { mcp: true as const } : {}),
      };
    }),
  );
}

/** Plugin names from `~/.claude/plugins/installed_plugins.json` (the part before `@`); empty when missing or invalid. */
export async function readInstalledClaudePluginNames(opts: { home?: string } = {}): Promise<Set<string>> {
  const path = join(opts.home ?? homedir(), '.claude', 'plugins', 'installed_plugins.json');
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const plugins = (parsed as { plugins?: unknown } | null)?.plugins;
    if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return new Set();
    return new Set(Object.keys(plugins).map((key) => key.split('@')[0] ?? key).filter(Boolean));
  } catch {
    return new Set();
  }
}
