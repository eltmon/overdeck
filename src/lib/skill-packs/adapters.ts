/**
 * Skill pack adapters (PAN-4334): read a pack checkout at its trusted commit
 * and report which skills it holds and what else it carries. Only skill
 * directories are ever mounted; every other capability is reported as
 * "Not applied".
 *
 * Nothing here imports `src/lib/skill-overrides/` (madge counts type edges,
 * and catalog.ts will depend on this module).
 */
import { lstat, readdir, readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, posix } from 'node:path';
import { parse as parseYaml } from 'yaml';

export type PackAdapterId = 'plain' | 'claude-plugin';

export interface PackSkill {
  name: string;
  /** Repo-relative posix path of the skill directory. */
  dir: string;
  description: string;
  optIn: boolean;
}

export interface PackCapabilities {
  hooks: boolean;
  mcpServers: boolean;
  commands: boolean;
  agents: boolean;
  contextInjection: boolean;
  gitHooks: boolean;
  /** Repo-relative files inside included skill dirs that are executable or end in `.sh`. */
  executables: string[];
  /** Names of included opt-in skills. */
  projectMutatingSkills: string[];
  requiresCli: string[];
}

export interface PackManifest {
  skills: PackSkill[];
  capabilities: PackCapabilities;
  license: string | null;
  pluginName: string | null;
}

export interface KnownPack {
  id: string;
  kind: 'pack' | 'integration';
  url?: string;
  adapter?: PackAdapterId;
  optIn?: readonly string[];
  note?: string;
}

export const KNOWN_PACKS: Readonly<Record<string, KnownPack>> = {
  mattpocock: {
    id: 'mattpocock',
    kind: 'pack',
    url: 'https://github.com/mattpocock/skills',
    adapter: 'claude-plugin',
    optIn: ['setup-matt-pocock-skills'],
  },
  sageox: {
    id: 'sageox',
    kind: 'integration',
    note: 'SageOx is an integration, not a skill pack; see https://github.com/eltmon/overdeck/issues/2444',
  },
};

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const PLAIN_MAX_DEPTH = 4;
const PLUGIN_JSON = join('.claude-plugin', 'plugin.json');
const LICENSE_TOKENS = ['MIT', 'Apache', 'BSD', 'GPL'] as const;

/** Frontmatter `name` (null when absent) and the first line of `description` ('' when absent or unparseable). */
export function readSkillFrontmatter(content: string): { name: string | null; description: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { name: null, description: '' };
  try {
    const frontmatter: unknown = parseYaml(match[1]);
    if (!frontmatter || typeof frontmatter !== 'object') return { name: null, description: '' };
    const record = frontmatter as Record<string, unknown>;
    const rawName = record['name'];
    const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null;
    const rawDescription = record['description'];
    const description =
      typeof rawDescription === 'string' ? (rawDescription.trim().split('\n')[0]?.trim() ?? '') : '';
    return { name, description };
  } catch {
    return { name: null, description: '' };
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

async function readTextOrNull(path: string): Promise<string | null> {
  if (!(await isFile(path))) return null;
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function detectAdapter(root: string): Promise<PackAdapterId> {
  return (await isFile(join(root, PLUGIN_JSON))) ? 'claude-plugin' : 'plain';
}

/** `plugin.json` as an object, null when absent; throws on invalid JSON only when `strict`. */
async function readPluginJson(root: string, strict: boolean): Promise<Record<string, unknown> | null> {
  const text = await readTextOrNull(join(root, PLUGIN_JSON));
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (!strict) return null;
    throw new Error(`invalid ${PLUGIN_JSON}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (!strict) return null;
    throw new Error(`invalid ${PLUGIN_JSON}: expected a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Normalize a manifest path to a repo-relative posix dir, or null when it escapes the repo. */
function toRepoRelative(path: string): string | null {
  if (!path || isAbsolute(path) || posix.isAbsolute(path)) return null;
  const normalized = posix.normalize(path.replaceAll('\\', '/')).replace(/\/+$/, '');
  if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
}

/** Skill dirs (repo-relative) under `start`: a dir holding SKILL.md is a skill and is not descended into. */
async function scanSkillDirs(root: string, start: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (rel: string, depth: number): Promise<void> => {
    let dirents;
    try {
      dirents = await readdir(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of [...dirents].sort((a, b) => a.name.localeCompare(b.name))) {
      if (!dirent.isDirectory()) continue;
      const child = posix.join(rel, dirent.name);
      if (await isFile(join(root, child, 'SKILL.md'))) found.push(child);
      else if (depth < PLAIN_MAX_DEPTH) await walk(child, depth + 1);
    }
  };
  if (await isDir(join(root, start))) await walk(start, 1);
  return found;
}

async function claudePluginSkillDirs(root: string, plugin: Record<string, unknown>): Promise<string[]> {
  const skills = plugin['skills'];
  if (typeof skills === 'string') {
    const start = toRepoRelative(skills);
    return start ? scanSkillDirs(root, start) : [];
  }
  if (!Array.isArray(skills)) return scanSkillDirs(root, 'skills');
  const dirs: string[] = [];
  for (const entry of skills) {
    if (typeof entry !== 'string') continue;
    const dir = toRepoRelative(entry);
    if (dir && (await isDir(join(root, dir)))) dirs.push(dir);
  }
  return dirs;
}

async function listExecutables(root: string, skillDir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    let dirents;
    try {
      dirents = await readdir(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of [...dirents].sort((a, b) => a.name.localeCompare(b.name))) {
      const child = posix.join(rel, dirent.name);
      if (dirent.isDirectory()) {
        await walk(child);
        continue;
      }
      if (!dirent.isFile()) continue;
      const stats = await lstat(join(root, child));
      if (dirent.name.endsWith('.sh') || (stats.mode & 0o111) !== 0) found.push(child);
    }
  };
  await walk(skillDir);
  return found;
}

async function readLicense(root: string, plugin: Record<string, unknown> | null): Promise<string | null> {
  const declared = plugin?.['license'];
  if (typeof declared === 'string' && declared.trim()) return declared.trim();
  for (const file of ['LICENSE', 'LICENSE.md']) {
    const text = await readTextOrNull(join(root, file));
    if (text === null) continue;
    const firstLine = text.split('\n').find((line) => line.trim());
    if (!firstLine) continue;
    return LICENSE_TOKENS.find((token) => firstLine.includes(token)) ?? null;
  }
  return null;
}

export async function readPackManifest(
  root: string,
  adapter: PackAdapterId,
  opts: { optIn?: readonly string[] } = {},
): Promise<PackManifest> {
  const plugin = await readPluginJson(root, adapter === 'claude-plugin');
  const skillDirs =
    adapter === 'claude-plugin'
      ? await claudePluginSkillDirs(root, plugin ?? {})
      : await scanSkillDirs(root, 'skills');
  const optIn = new Set(opts.optIn ?? []);

  const skills: PackSkill[] = [];
  const seen = new Set<string>();
  const executables: string[] = [];
  for (const dir of skillDirs) {
    const content = await readTextOrNull(join(root, dir, 'SKILL.md'));
    if (content === null) continue;
    const frontmatter = readSkillFrontmatter(content);
    const name = frontmatter.name ?? basename(dir);
    if (!SKILL_NAME_PATTERN.test(name) || seen.has(name)) continue;
    seen.add(name);
    skills.push({ name, dir, description: frontmatter.description, optIn: optIn.has(name) });
    executables.push(...(await listExecutables(root, dir)));
  }

  const capabilities: PackCapabilities = {
    hooks: (await isFile(join(root, 'hooks', 'hooks.json'))) || plugin?.['hooks'] !== undefined,
    mcpServers: (await isFile(join(root, '.mcp.json'))) || plugin?.['mcpServers'] !== undefined,
    commands: await isDir(join(root, 'commands')),
    agents: await isDir(join(root, 'agents')),
    contextInjection: false,
    gitHooks: false,
    executables,
    projectMutatingSkills: skills.filter((skill) => skill.optIn).map((skill) => skill.name),
    requiresCli: [],
  };
  const pluginName = typeof plugin?.['name'] === 'string' ? plugin['name'] : null;
  return { skills, capabilities, license: await readLicense(root, plugin), pluginName };
}

/** Human labels for every capability a mount leaves out, e.g. `['hooks', 'MCP servers', 'executables (2)']`. */
export function notAppliedLabels(capabilities: PackCapabilities): string[] {
  const labels: string[] = [];
  if (capabilities.hooks) labels.push('hooks');
  if (capabilities.mcpServers) labels.push('MCP servers');
  if (capabilities.commands) labels.push('commands');
  if (capabilities.agents) labels.push('agents');
  if (capabilities.contextInjection) labels.push('context injection');
  if (capabilities.gitHooks) labels.push('git hooks');
  if (capabilities.executables.length > 0) labels.push(`executables (${capabilities.executables.length})`);
  if (capabilities.projectMutatingSkills.length > 0) {
    labels.push(`project-mutating skills (${capabilities.projectMutatingSkills.length})`);
  }
  if (capabilities.requiresCli.length > 0) labels.push(`requires CLI (${capabilities.requiresCli.join(', ')})`);
  return labels;
}
