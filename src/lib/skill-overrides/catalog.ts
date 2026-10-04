/**
 * Skill catalog (PAN-3942): the skill names Overdeck can see, for override
 * listing and write validation. A skill is a directory holding a SKILL.md.
 *
 * Pack skills (PAN-4334) have their own catalog, `listPackCatalog()`, because
 * they default off while native skills default on.
 *
 * Each entry carries the root it was read from as `origin` (PAN-4528):
 * 'overdeck' for `~/.overdeck/skills`, 'personal' for `~/.claude/skills` and
 * `~/.agents/skills`, 'project' for `<projectRoot>/.pan/skills`.
 */
import { lstat, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  detectAdapter,
  KNOWN_PACKS,
  readPackManifest,
  readSkillFrontmatter,
  type PackAdapterId,
  type PackManifest,
} from '../skill-packs/adapters.js';
import { listPacks, packExtractDir } from '../skill-packs/sources.js';

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
    dirents = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries: SkillCatalogEntry[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
    let content: string;
    try {
      content = await readFile(join(root, dirent.name, 'SKILL.md'), 'utf8');
    } catch {
      continue;
    }
    const entry: SkillCatalogEntry = { name: dirent.name, description: parseSkillDescription(content), origin };
    if (origin === 'project') entry.projectSkill = true;
    entries.push(entry);
  }
  return entries;
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
  const byName = new Map<string, SkillCatalogEntry>();
  for (const [root, origin] of roots) {
    for (const entry of await readRoot(root, origin)) {
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
  cached: boolean;
  /** Null when the trusted commit is not extracted (or its manifest cannot be read). */
  manifest: PackManifest | null;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Registered packs with the manifest of their trusted commit, sorted by id. Reads the cache only; no git. */
export async function listPackCatalog(): Promise<PackCatalogEntry[]> {
  const packs = await listPacks();
  return Promise.all(
    packs.map(async (entry): Promise<PackCatalogEntry> => {
      const dir = packExtractDir(entry.id, entry.commit);
      const cached = await isDirectory(dir);
      const known = KNOWN_PACKS[entry.id];
      const adapter = entry.adapter ?? known?.adapter ?? (cached ? await detectAdapter(dir) : 'plain');
      let manifest: PackManifest | null = null;
      if (cached) {
        try {
          manifest = await readPackManifest(dir, adapter, { optIn: known?.optIn ?? [], skillsRoot: known?.skillsRoot });
        } catch {
          manifest = null;
        }
      }
      return { id: entry.id, url: entry.url, ref: entry.ref, commit: entry.commit, adapter, cached, manifest };
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
