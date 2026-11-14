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
import { createPromiseConcurrencyLimiter } from '../concurrency.js';
import { SAGEOX_DISCLOSURE } from '../sageox/disclosure.js';
import { ATLASSIAN_DISCLOSURE, ATLASSIAN_OPT_IN_SKILLS, ATLASSIAN_PACK_COMMIT, ATLASSIAN_PACK_ID, ATLASSIAN_PACK_URL } from './atlassian.js';
import { DEFT_READONLY_SKILLS, DEFT_SKILL_PREFIX, DEFT_SKILLS_DIR } from './deft.js';
import {
  GSTACK_BROWSER_NEEDED,
  GSTACK_BROWSER_OPT_IN_SKILLS,
  GSTACK_BROWSER_SKILLS,
  GSTACK_DISCLOSURE,
  GSTACK_MOUNTED_SKILLS,
  GSTACK_OPT_IN_SKILLS,
  classifyGstackSkill,
} from './gstack.js';

export type PackAdapterId = 'plain' | 'claude-plugin' | 'deft-readonly' | 'gstack-runtime';

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
  /**
   * Repo-relative files that are executable or end in `.sh`: inside included skill dirs, or for a runtime
   * pack anywhere in the runtime.
   */
  executables: string[];
  /** Names of included opt-in skills. */
  projectMutatingSkills: string[];
  requiresCli: string[];
  /** True when the pack's runtime is mounted and its executables run (gstack). */
  runtime?: boolean;
}

export interface PackManifest {
  skills: PackSkill[];
  capabilities: PackCapabilities;
  license: string | null;
  pluginName: string | null;
  /** Top-level skills the adapter never mounts, with the reason (gstack-runtime). */
  excluded?: Array<{ name: string; reason: string }>;
  /** Applied MCP servers (PAN-5165 D-2/D-3): `claude-plugin` packs only, https `type: "http"` entries only. */
  mcpServers?: Record<string, PackMcpServer>;
}

/** An MCP server a pack declares that Overdeck applies (PAN-5165 D-2): remote https only, no ${} references. */
export interface PackMcpServer {
  type: 'http';
  url: string;
  headers: Record<string, string>;
}

export interface KnownPack {
  id: string;
  url?: string;
  adapter?: PackAdapterId;
  /** Directory the `plain` adapter scans instead of `skills/`, relative to the plugin root. */
  skillsRoot?: string;
  /** Repo-relative dir that holds the plugin (manifest, skills, agents, hooks, LICENSE); default the repo root. */
  pluginRoot?: string;
  /** Ref `pan skills pack add <id>` pins when --ref is omitted (a tag, branch or 40-hex commit). */
  ref?: string;
  /** Plugin-root-relative files or dirs the mount copies next to skills/ (reference docs skills link to). */
  mountExtras?: readonly string[];
  optIn?: readonly string[];
  /** One-line statement of what leaves the machine, shown on the pack row. */
  disclosure?: string;
  /** Plugin-root-relative dirs the skill scan skips (archived copies). */
  skillsExclude?: readonly string[];
}

export const KNOWN_PACKS: Readonly<Record<string, KnownPack>> = {
  mattpocock: {
    id: 'mattpocock',
    url: 'https://github.com/eltmon/skills',
    adapter: 'claude-plugin',
    optIn: ['setup-matt-pocock-skills'],
  },
  deft: { id: 'deft', url: 'https://github.com/eltmon/directive', adapter: 'deft-readonly' },
  sageox: {
    id: 'sageox',
    url: 'https://github.com/eltmon/ox',
    adapter: 'plain',
    skillsRoot: 'extensions/skills',
    // eltmon/ox overdeck/host-managed-v0.25.0 (PAN-4852); see docs/SAGEOX-FORK.md
    ref: '0e6c7e2df8fd89638a2d40db08cc45d4cff05fdc',
    optIn: [
      'ox-cli-init',
      'ox-cli-attest',
      'ox-cli-skill-manager',
      'ox-cli-pr-header',
      'ox-cli-plan',
      'ox-cli-cart',
      'ox-cli-cart-start',
      'ox-cli-cart-done',
      'ox-cli-cart-drop',
    ],
    disclosure: SAGEOX_DISCLOSURE,
  },
  gstack: {
    id: 'gstack',
    url: 'https://github.com/eltmon/gstack',
    adapter: 'gstack-runtime',
    optIn: GSTACK_OPT_IN_SKILLS,
    disclosure: GSTACK_DISCLOSURE,
  },
  // Cursor's generated Claude Code build of poteto's pstack, from the eltmon/plugins fork (PAN-4728).
  pstack: {
    id: 'pstack',
    url: 'https://github.com/eltmon/plugins',
    ref: 'ae5650febf4320793844c12c4adaa937f417f8da',
    adapter: 'claude-plugin',
    pluginRoot: 'harness/pstack/claude-code',
    mountExtras: ['docs', 'README.md'],
    optIn: [
      'automate-me',
      'create-formal-verification-skill',
      'create-verification-skill',
      'maintain-verification-skill',
      'make-bot-ui',
      'reflect',
      'setup-pstack',
    ],
  },
  // Atlassian's official Rovo MCP plugin, upstream and commit-pinned (PAN-5165); skills/v1 holds archived v1 skills.
  atlassian: {
    id: ATLASSIAN_PACK_ID,
    url: ATLASSIAN_PACK_URL,
    adapter: 'claude-plugin',
    ref: ATLASSIAN_PACK_COMMIT,
    skillsExclude: ['skills/v1'],
    optIn: ATLASSIAN_OPT_IN_SKILLS,
    disclosure: ATLASSIAN_DISCLOSURE,
  },
};

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const PLAIN_MAX_DEPTH = 4;
const PLUGIN_JSON = join('.claude-plugin', 'plugin.json');
const LICENSE_TOKENS = ['MIT', 'Apache', 'BSD', 'GPL'] as const;
const MANIFEST_FS_CONCURRENCY = 32;
const limitFs = createPromiseConcurrencyLimiter(MANIFEST_FS_CONCURRENCY);

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

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
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

/** True when `dir` is excluded directly, or is a descendant of an excluded directory. */
function isUnderExcluded(dir: string, exclude: ReadonlySet<string>): boolean {
  if (exclude.has(dir)) return true;
  for (const excluded of exclude) {
    if (dir.startsWith(`${excluded}/`)) return true;
  }
  return false;
}

/** Skill dirs (repo-relative) under `start`: a dir holding SKILL.md is a skill and is not descended into. */
async function scanSkillDirs(root: string, start: string, exclude: ReadonlySet<string> = new Set()): Promise<string[]> {
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
      if (isUnderExcluded(child, exclude)) continue;
      if (await isFile(join(root, child, 'SKILL.md'))) found.push(child);
      else if (depth < PLAIN_MAX_DEPTH) await walk(child, depth + 1);
    }
  };
  if (await isDir(join(root, start))) await walk(start, 1);
  return found;
}

async function claudePluginSkillDirs(
  root: string,
  plugin: Record<string, unknown>,
  exclude: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const skills = plugin['skills'];
  if (typeof skills === 'string') {
    const start = toRepoRelative(skills);
    return start ? scanSkillDirs(root, start, exclude) : [];
  }
  if (!Array.isArray(skills)) return scanSkillDirs(root, 'skills', exclude);
  const dirs: string[] = [];
  for (const entry of skills) {
    if (typeof entry !== 'string') continue;
    const dir = toRepoRelative(entry);
    if (dir && !isUnderExcluded(dir, exclude) && (await isDir(join(root, dir)))) dirs.push(dir);
  }
  return dirs;
}

/** Read-only allowlist dirs (`content/skills/deft-directive-<name>`) that hold a SKILL.md (PAN-3943). */
async function deftReadonlySkillDirs(root: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const name of DEFT_READONLY_SKILLS) {
    const dir = posix.join(DEFT_SKILLS_DIR, DEFT_SKILL_PREFIX + name);
    if (await isFile(join(root, dir, 'SKILL.md'))) dirs.push(dir);
  }
  return dirs;
}

/**
 * Mounted gstack skills (`<name>/SKILL.md` a regular file) and every other top-level skill dir with its reason.
 * Browser-class skills mount only when `browser` (the operator consented and the runtime is built, PAN-4730).
 */
async function gstackSkillDirs(
  root: string,
  browser: boolean,
): Promise<{ dirs: string[]; excluded: Array<{ name: string; reason: string }> }> {
  const dirs: string[] = [];
  const candidates = browser ? [...GSTACK_MOUNTED_SKILLS, ...GSTACK_BROWSER_SKILLS].sort() : GSTACK_MOUNTED_SKILLS;
  for (const name of candidates) {
    if (await isFile(join(root, name, 'SKILL.md'))) dirs.push(name);
  }
  const excluded: Array<{ name: string; reason: string }> = [];
  const mounted = new Set(dirs);
  for (const name of (await readdir(root).catch(() => [] as string[])).sort()) {
    if (mounted.has(name)) continue;
    // A symlinked skill dir (connect-chrome) counts: it is listed as not mounted.
    if (!(await exists(join(root, name, 'SKILL.md')))) continue;
    const entry = classifyGstackSkill(name);
    const browserClass = entry.class === 'browser' || entry.class === 'browser-opt-in';
    const mountable = entry.class === 'default' || entry.class === 'opt-in' || (browserClass && browser);
    const reason = mountable ? 'SKILL.md is not a regular file' : browserClass ? GSTACK_BROWSER_NEEDED : entry.reason;
    excluded.push({ name, reason });
  }
  return { dirs, excluded };
}

/** Top-level runtime dirs a pack render never copies (pack mode, eltmon/gstack docs/pack-mode.md). */
const RUNTIME_SKIP_DIRS = new Set(['.git', '.github', 'node_modules', 'test']);

async function listExecutables(root: string, skillDir: string, skipTopLevel: ReadonlySet<string> = new Set()): Promise<string[]> {
  const walk = async (rel: string): Promise<string[]> => {
    let dirents;
    try {
      dirents = await limitFs(() => readdir(join(root, rel), { withFileTypes: true }));
    } catch {
      return [];
    }
    const sorted = [...dirents].sort((a, b) => a.name.localeCompare(b.name));
    const parts = await Promise.all(
      sorted.map(async (dirent): Promise<string[]> => {
        const child = posix.join(rel, dirent.name);
        if (dirent.isDirectory()) {
          return rel === skillDir && skipTopLevel.has(dirent.name) ? [] : walk(child);
        }
        if (!dirent.isFile()) return [];
        const stats = await limitFs(() => lstat(join(root, child)));
        return dirent.name.endsWith('.sh') || (stats.mode & 0o111) !== 0 ? [child] : [];
      }),
    );
    return parts.flat();
  };
  return walk(skillDir);
}

const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Parsed JSON's `mcpServers` key as an object, or null when the text is unreadable, invalid, or lacks one. */
function parseMcpServersMap(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const mcpServers = (parsed as Record<string, unknown>)['mcpServers'];
    if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) return null;
    return mcpServers as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** True when `value` is an entry this issue applies (PAN-5165 D-2): remote https, no `${}` references. */
function isAppliedMcpServerEntry(
  name: string,
  value: unknown,
): value is { type: 'http'; url: string; headers?: Record<string, string> } {
  if (!MCP_SERVER_NAME_PATTERN.test(name) || name === 'overdeck') return false;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (entry['type'] !== 'http') return false;
  const url = entry['url'];
  if (typeof url !== 'string' || url.includes('${')) return false;
  try {
    if (new URL(url).protocol !== 'https:') return false;
  } catch {
    return false;
  }
  const headers = entry['headers'];
  if (headers === undefined) return true;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return false;
  for (const headerValue of Object.values(headers as Record<string, unknown>)) {
    if (typeof headerValue !== 'string' || headerValue.includes('${')) return false;
  }
  return true;
}

/** Applied servers by name, plus how many declared entries were not applied. */
export async function readPackMcpServers(
  base: string,
  plugin: Record<string, unknown> | null,
): Promise<{ applied: Record<string, PackMcpServer>; notApplied: number; declared: boolean }> {
  const declaredValue = plugin?.['mcpServers'];
  let declared = false;
  let serversMap: Record<string, unknown> | null = null;

  if (typeof declaredValue === 'string') {
    declared = true;
    const rel = toRepoRelative(declaredValue);
    serversMap = rel ? parseMcpServersMap(await readTextOrNull(join(base, rel))) : null;
  } else if (declaredValue && typeof declaredValue === 'object' && !Array.isArray(declaredValue)) {
    declared = true;
    const obj = declaredValue as Record<string, unknown>;
    const nested = obj['mcpServers'];
    serversMap = nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as Record<string, unknown>) : obj;
  } else {
    const mcpJsonPath = join(base, '.mcp.json');
    if (await isFile(mcpJsonPath)) {
      declared = true;
      serversMap = parseMcpServersMap(await readTextOrNull(mcpJsonPath));
    }
  }

  if (!declared) return { applied: {}, notApplied: 0, declared: false };
  if (serversMap === null) return { applied: {}, notApplied: 1, declared: true };

  const applied: Record<string, PackMcpServer> = {};
  let notApplied = 0;
  for (const [name, value] of Object.entries(serversMap)) {
    if (isAppliedMcpServerEntry(name, value)) {
      // Normalize through URL so no raw control character from the pack's JSON survives into a display row.
      applied[name] = { type: 'http', url: new URL(value.url).href, headers: value.headers ?? {} };
    } else {
      notApplied += 1;
    }
  }
  return { applied, notApplied, declared: true };
}

/** `MCP server <name> (<url>)` for each applied server, sorted by name; empty when the manifest has none. */
export function mcpServerLabels(manifest: PackManifest): string[] {
  if (!manifest.mcpServers) return [];
  return Object.entries(manifest.mcpServers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, server]) => `MCP server ${name} (${server.url})`);
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
  opts: {
    optIn?: readonly string[];
    skillsRoot?: string;
    pluginRoot?: string;
    browser?: boolean;
    skillsExclude?: readonly string[];
  } = {},
): Promise<PackManifest> {
  let prefix = '';
  if (opts.pluginRoot !== undefined) {
    const rel = toRepoRelative(opts.pluginRoot);
    if (!rel) throw new Error(`invalid pack plugin root: ${JSON.stringify(opts.pluginRoot)}`);
    prefix = rel;
  }
  const base = prefix ? join(root, prefix) : root;
  const plugin = await readPluginJson(base, adapter === 'claude-plugin');
  const mcp = adapter === 'claude-plugin' ? await readPackMcpServers(base, plugin) : null;
  const deft = adapter === 'deft-readonly';
  const gstack = adapter === 'gstack-runtime' ? await gstackSkillDirs(base, opts.browser === true) : null;
  const excludeDirs = new Set((opts.skillsExclude ?? []).map(toRepoRelative).filter((dir): dir is string => dir !== null));
  const skillDirs =
    adapter === 'claude-plugin'
      ? await claudePluginSkillDirs(base, plugin ?? {}, excludeDirs)
      : deft
        ? await deftReadonlySkillDirs(base)
        : gstack
          ? gstack.dirs
          : await scanSkillDirs(base, opts.skillsRoot ?? 'skills', excludeDirs);
  // gstack opt-in comes from the skill map, so a stale registry entry cannot turn an opt-in skill into a default one.
  // A browser-opt-in skill is only present when the browser runtime is mounted.
  const optIn = new Set(gstack ? [...GSTACK_OPT_IN_SKILLS, ...GSTACK_BROWSER_OPT_IN_SKILLS] : (opts.optIn ?? []));

  const skills: PackSkill[] = [];
  const seen = new Set<string>();
  const executables: string[] = [];
  const contents = await Promise.all(skillDirs.map((dir) => limitFs(() => readTextOrNull(join(base, dir, 'SKILL.md')))));
  const executableDirs: string[] = [];
  skillDirs.forEach((dir, index) => {
    const content = contents[index] ?? null;
    if (content === null) return;
    const frontmatter = readSkillFrontmatter(content);
    // Deft skills are named by the stripped dir name, never the `deft-directive-*` frontmatter name;
    // gstack skills by their dir name, which is what the skill map classifies.
    const name = deft
      ? basename(dir).slice(DEFT_SKILL_PREFIX.length)
      : gstack
        ? dir
        : (frontmatter.name ?? basename(dir));
    if (!SKILL_NAME_PATTERN.test(name) || seen.has(name)) return;
    seen.add(name);
    const repoDir = prefix ? posix.join(prefix, dir) : dir;
    skills.push({ name, dir: repoDir, description: frontmatter.description, optIn: optIn.has(name) });
    if (!gstack) executableDirs.push(dir);
  });
  for (const dirExecutables of await Promise.all(executableDirs.map((dir) => listExecutables(base, dir)))) {
    executables.push(...(prefix ? dirExecutables.map((e) => posix.join(prefix, e)) : dirExecutables));
  }
  // A runtime pack runs scripts from anywhere in its tree, so every runtime executable is listed.
  if (gstack) {
    const runtimeExecutables = await listExecutables(base, '', RUNTIME_SKIP_DIRS);
    executables.push(...(prefix ? runtimeExecutables.map((e) => posix.join(prefix, e)) : runtimeExecutables));
  }

  // Deft always carries agent hooks, an AGENTS.md section, and .githooks, and its skills call the directive CLI.
  const capabilities: PackCapabilities = {
    hooks: deft || gstack !== null || (await isFile(join(base, 'hooks', 'hooks.json'))) || plugin?.['hooks'] !== undefined,
    // PAN-5165: claude-plugin packs apply their https MCP servers; anything else they declare stays Not applied.
    mcpServers: mcp ? mcp.notApplied > 0 : (await isFile(join(base, '.mcp.json'))) || plugin?.['mcpServers'] !== undefined,
    commands: await isDir(join(base, 'commands')),
    agents: await isDir(join(base, 'agents')),
    contextInjection: deft,
    gitHooks: deft,
    executables,
    projectMutatingSkills: skills.filter((skill) => skill.optIn).map((skill) => skill.name),
    requiresCli: deft ? ['directive'] : gstack ? ['bun'] : [],
    ...(gstack ? { runtime: true } : {}),
  };
  const pluginName = typeof plugin?.['name'] === 'string' ? plugin['name'] : null;
  const manifest: PackManifest = {
    skills,
    capabilities,
    license: await readLicense(base, plugin),
    pluginName,
    ...(mcp && Object.keys(mcp.applied).length > 0 ? { mcpServers: mcp.applied } : {}),
  };
  return gstack ? { ...manifest, excluded: gstack.excluded } : manifest;
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
  // A runtime pack's executables are mounted and run, so they are not "not applied".
  if (capabilities.executables.length > 0 && !capabilities.runtime) {
    labels.push(`executables (${capabilities.executables.length})`);
  }
  if (capabilities.projectMutatingSkills.length > 0) {
    labels.push(`project-mutating skills (${capabilities.projectMutatingSkills.length})`);
  }
  if (capabilities.requiresCli.length > 0) labels.push(`requires CLI (${capabilities.requiresCli.join(', ')})`);
  return labels;
}
