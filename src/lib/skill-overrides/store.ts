/**
 * Per-skill override storage (PAN-3942).
 *
 * - global:  `~/.overdeck/config.yaml` → `skills.overrides.<name>: false`
 *            (global is two-state: on is the default, so "on" clears the key)
 * - project: `projects.yaml` → `projects.<key>.skill_overrides.<name>: true|false`
 * - issue:   `<planHome>/.pan/skill-overrides/<ISSUE>.yaml`, committed and
 *            pushed on the plan home's branch through the plan-artifact door
 *
 * Pack toggles (PAN-4334) sit beside them: global `skills.pack_overrides`,
 * project `skill_pack_overrides`, and the issue file's `packs:` map. Pack
 * skills use the same per-skill maps with `pack/skill` keys.
 *
 * Server-reachable: every config read here is async. Writes validate against
 * the skill catalog and reject core skills.
 */
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { isMap, parse as parseYaml, parseDocument, stringify as stringifyYaml, type Document } from 'yaml';
import { getGlobalConfigPath } from '../config-yaml/load.js';
import { commitPlanArtifacts, pushPlanArtifacts } from '../overdeck/plan-artifact-commit.js';
import { PAN_DIRNAME } from '../pan-dir/types.js';
import {
  listProjectsAsync,
  resolveInfraRepo,
  resolveProjectFromIssueSync,
  updateProjectsConfigAsync,
  type ProjectConfig,
} from '../projects.js';
import { runSettingsWriteSerialized } from '../settings-api.js';
import { KNOWN_PACKS, notAppliedLabels, type PackAdapterId } from '../skill-packs/adapters.js';
import { listPacks, packUpdateAvailable } from '../skill-packs/sources.js';
import { listPackCatalog, listSkillCatalog, readInstalledClaudePluginNames, type PackCatalogEntry } from './catalog.js';
import {
  isCoreSkill,
  isPackSkillId,
  resolvePackSkill,
  resolvePackToggle,
  resolveSkillStates,
  type PackSkillSource,
  type SkillOverrideLayers,
  type SkillOverrideLevel,
  type SkillOverrideMap,
  type SkillState,
} from './resolve.js';

export type SkillOverrideErrorCode =
  | 'core-skill' | 'unknown-skill' | 'unknown-pack' | 'unknown-project' | 'unknown-issue' | 'bad-request';

export class SkillOverrideError extends Error {
  constructor(readonly code: SkillOverrideErrorCode, message: string) {
    super(message);
    this.name = 'SkillOverrideError';
  }
}

export interface SkillOverrideUpdate {
  level: SkillOverrideLevel;
  skill: string;
  /** true = on, false = off, null = inherit (remove the key). */
  enabled: boolean | null;
  projectKey?: string;
  issueId?: string;
}

/** A pack toggle write (PAN-4334). Global is two-state: `false` and `null` both clear the key. */
export interface PackOverrideUpdate {
  level: SkillOverrideLevel;
  pack: string;
  enabled: boolean | null;
  projectKey?: string;
  issueId?: string;
}

export interface SkillOverrideWriteResult {
  committed?: boolean;
  sha?: string;
  pushed?: boolean;
  reason?: string;
}

type ProjectWithSkillOverrides = ProjectConfig & {
  skill_overrides?: Record<string, boolean>;
  skill_pack_overrides?: Record<string, boolean>;
};

interface IssueOverrides {
  skills: Record<string, boolean>;
  packs: Record<string, boolean>;
}

const execFileAsync = promisify(execFile);

const ISSUE_FILE_HEADER = '# Overdeck per-issue skill overrides (PAN-3942). true = on, false = off; absent = inherit.\n';

function booleanEntries(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [name, enabled] of Object.entries(value as Record<string, unknown>)) {
    if (typeof enabled === 'boolean') out[name] = enabled;
  }
  return out;
}

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

function parseYamlOrNull(text: string): unknown {
  try {
    return parseYaml(text);
  } catch {
    return null;
  }
}

// ── reads ────────────────────────────────────────────────────────────────

export async function readGlobalSkillOverrides(): Promise<Record<string, boolean>> {
  const config = parseYamlOrNull(await readTextOrEmpty(getGlobalConfigPath())) as
    { skills?: { overrides?: unknown } } | null;
  return booleanEntries(config?.skills?.overrides);
}

export async function readGlobalPackOverrides(): Promise<Record<string, boolean>> {
  const config = parseYamlOrNull(await readTextOrEmpty(getGlobalConfigPath())) as
    { skills?: { pack_overrides?: unknown } } | null;
  return booleanEntries(config?.skills?.pack_overrides);
}

async function findProject(projectKey: string): Promise<ProjectWithSkillOverrides | null> {
  const match = (await listProjectsAsync()).find(project => project.key === projectKey);
  return (match?.config as ProjectWithSkillOverrides | undefined) ?? null;
}

export async function readProjectSkillOverrides(projectKey: string): Promise<Record<string, boolean>> {
  return booleanEntries((await findProject(projectKey))?.skill_overrides);
}

export async function readProjectPackOverrides(projectKey: string): Promise<Record<string, boolean>> {
  return booleanEntries((await findProject(projectKey))?.skill_pack_overrides);
}

/** `<planHome>/.pan/skill-overrides/<ISSUE>.yaml` */
export function issueSkillOverridesPath(planHome: string, issueId: string): string {
  return join(planHome, PAN_DIRNAME, 'skill-overrides', `${issueId.toUpperCase()}.yaml`);
}

/**
 * The checkout holding a registered project's `.pan/` — what `resolvePlanHome`
 * returns for the project root, computed from the config without re-reading
 * projects.yaml.
 */
function planHomeFor(project: ProjectConfig): string {
  try {
    return resolveInfraRepo(project, resolve(project.path)).repoPath;
  } catch {
    return resolve(project.path);
  }
}

/** The registered project that owns an issue, with its key. */
async function projectForIssue(issueId: string): Promise<{ projectKey: string; project: ProjectConfig } | null> {
  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) return null;
  const project = await findProject(resolved.projectKey);
  return project ? { projectKey: resolved.projectKey, project } : null;
}

async function readIssueFile(path: string): Promise<IssueOverrides> {
  const parsed = parseYamlOrNull(await readTextOrEmpty(path)) as { skills?: unknown; packs?: unknown } | null;
  return { skills: booleanEntries(parsed?.skills), packs: booleanEntries(parsed?.packs) };
}

async function readIssueOverrides(issueId: string): Promise<IssueOverrides> {
  const owner = await projectForIssue(issueId);
  if (!owner) return { skills: {}, packs: {} };
  return readIssueFile(issueSkillOverridesPath(planHomeFor(owner.project), issueId));
}

export async function readIssueSkillOverrides(issueId: string): Promise<Record<string, boolean>> {
  return (await readIssueOverrides(issueId)).skills;
}

/**
 * Load every level that applies to a context. An issue without an explicit
 * project resolves its own project, so CLI, routes, and launches agree.
 */
export async function loadSkillOverrideLayers(ctx: { projectKey?: string; issueId?: string }): Promise<SkillOverrideLayers> {
  const projectKey = ctx.projectKey ?? (ctx.issueId ? (await projectForIssue(ctx.issueId))?.projectKey : undefined);
  const [global, globalPacks, project, projectPacks, issue] = await Promise.all([
    readGlobalSkillOverrides(),
    readGlobalPackOverrides(),
    projectKey ? readProjectSkillOverrides(projectKey) : Promise.resolve(undefined),
    projectKey ? readProjectPackOverrides(projectKey) : Promise.resolve(undefined),
    ctx.issueId ? readIssueOverrides(ctx.issueId) : Promise.resolve(undefined),
  ]);
  return {
    global,
    ...(project ? { project } : {}),
    ...(issue ? { issue: issue.skills } : {}),
    packs: {
      global: globalPacks,
      ...(projectPacks ? { project: projectPacks } : {}),
      ...(issue ? { issue: issue.packs } : {}),
    },
  };
}

export interface PackSkillState {
  /** `pack/skill`. */
  id: string;
  name: string;
  description: string;
  optIn: boolean;
  /** A native skill with the same name exists (the harness shows both, as `name` and `pack:name`). */
  bundledOverlap: boolean;
  global: boolean | null;
  project: boolean | null;
  issue: boolean | null;
  enabled: boolean;
  source: PackSkillSource;
  /** What the narrowest context level would resolve to without its own per-skill value. */
  inherited: { enabled: boolean; source: PackSkillSource };
}

export interface PackState {
  id: string;
  url: string;
  ref: string;
  commit: string;
  adapter: PackAdapterId;
  license: string | null;
  cached: boolean;
  notApplied: string[];
  /** What leaves the machine when the pack is on (PAN-2444), or null. */
  disclosure: string | null;
  /** The same upstream plugin is also installed in Claude Code, so its skills would appear twice. */
  duplicatePluginInstall: boolean;
  /** Filled only when asked (`checkUpdates`): the newer remote commit, or null. */
  updateAvailable?: string | null;
  global: boolean | null;
  project: boolean | null;
  issue: boolean | null;
  enabled: boolean;
  source: SkillOverrideLevel | 'default';
  inherited: { enabled: boolean; source: SkillOverrideLevel | 'default' };
  /** Empty when the pack is not cached. */
  skills: PackSkillState[];
}

export interface SkillStateList {
  project: string | null;
  issue: string | null;
  skills: SkillState[];
  packs: PackState[];
}

function valueAt(map: SkillOverrideMap | undefined, key: string): boolean | null {
  if (!map || !Object.prototype.hasOwnProperty.call(map, key)) return null;
  const value = map[key];
  return typeof value === 'boolean' ? value : null;
}

function resolvePackStates(
  packs: readonly PackCatalogEntry[],
  layers: SkillOverrideLayers,
  narrowest: SkillOverrideLevel,
  nativeNames: ReadonlySet<string>,
  installedPlugins: ReadonlySet<string>,
): PackState[] {
  return packs.map((pack): PackState => {
    const manifest = pack.manifest;
    const skills = (manifest?.skills ?? [])
      .map((skill): PackSkillState => {
        const id = `${pack.id}/${skill.name}`;
        return {
          id,
          name: skill.name,
          description: skill.description,
          optIn: skill.optIn,
          bundledOverlap: nativeNames.has(skill.name),
          global: valueAt(layers.global, id),
          project: valueAt(layers.project, id),
          issue: valueAt(layers.issue, id),
          ...resolvePackSkill(id, skill.optIn, layers),
          inherited: resolvePackSkill(id, skill.optIn, layers, narrowest),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      id: pack.id,
      url: pack.url,
      ref: pack.ref,
      commit: pack.commit,
      adapter: pack.adapter,
      license: manifest?.license ?? null,
      cached: pack.cached,
      notApplied: manifest ? notAppliedLabels(manifest.capabilities) : [],
      disclosure: KNOWN_PACKS[pack.id]?.disclosure ?? null,
      duplicatePluginInstall: manifest?.pluginName ? installedPlugins.has(manifest.pluginName) : false,
      global: valueAt(layers.packs?.global, pack.id),
      project: valueAt(layers.packs?.project, pack.id),
      issue: valueAt(layers.packs?.issue, pack.id),
      ...resolvePackToggle(pack.id, layers),
      inherited: resolvePackToggle(pack.id, layers, narrowest),
      skills,
    };
  });
}

/**
 * Effective state of every catalog skill for a context. An issue alone
 * resolves its own project; the catalog includes that project's
 * `.pan/skills`, so project skills appear only in project and issue context.
 */
export async function listSkillStates(
  ctx: { projectKey?: string; issueId?: string },
  opts: { checkUpdates?: boolean } = {},
): Promise<SkillStateList> {
  const issueId = ctx.issueId?.toUpperCase();
  let projectKey = ctx.projectKey;
  let project: ProjectConfig | null = null;
  if (projectKey) {
    project = await findProject(projectKey);
    if (!project) throw new SkillOverrideError('unknown-project', `unknown project: ${projectKey}`);
  } else if (issueId) {
    const owner = await projectForIssue(issueId);
    if (!owner) throw new SkillOverrideError('unknown-issue', `no registered project owns issue ${issueId}`);
    projectKey = owner.projectKey;
    project = owner.project;
  }
  const [catalog, layers, packCatalog, installedPlugins] = await Promise.all([
    listSkillCatalog(project ? { projectRoot: project.path } : {}),
    loadSkillOverrideLayers({ projectKey, issueId }),
    listPackCatalog(),
    readInstalledClaudePluginNames(),
  ]);
  const narrowest: SkillOverrideLevel = issueId ? 'issue' : projectKey ? 'project' : 'global';
  const nativeNames = new Set(catalog.map(entry => entry.name));
  const packs = resolvePackStates(packCatalog, layers, narrowest, nativeNames, installedPlugins);
  if (opts.checkUpdates) {
    await Promise.all(packs.map(async (pack) => {
      pack.updateAvailable = await packUpdateAvailable(pack);
    }));
  }
  return { project: projectKey ?? null, issue: issueId ?? null, skills: resolveSkillStates(catalog, layers), packs };
}

export interface LowerLevelOverrides {
  projects: string[];
  issues: string[];
}

async function collectLowerLevel(
  projectMap: (config: ProjectWithSkillOverrides) => unknown,
  issueMap: (overrides: IssueOverrides) => Record<string, boolean>,
): Promise<Record<string, LowerLevelOverrides>> {
  const out: Record<string, LowerLevelOverrides> = {};
  const entry = (name: string): LowerLevelOverrides => (out[name] ??= { projects: [], issues: [] });
  const planHomes = new Set<string>();
  for (const { key, config } of await listProjectsAsync()) {
    if (!config.path) continue;
    for (const name of Object.keys(booleanEntries(projectMap(config as ProjectWithSkillOverrides)))) {
      entry(name).projects.push(key);
    }
    planHomes.add(planHomeFor(config));
  }
  for (const planHome of planHomes) {
    const dir = join(planHome, PAN_DIRNAME, 'skill-overrides');
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files.filter(name => name.endsWith('.yaml')).sort()) {
      const issue = file.slice(0, -'.yaml'.length);
      for (const name of Object.keys(issueMap(await readIssueFile(join(dir, file))))) entry(name).issues.push(issue);
    }
  }
  for (const value of Object.values(out)) value.projects.sort();
  return out;
}

/**
 * For each skill, the projects and issues that override it (either way).
 * Answers "why is this off for my agent" on the global page.
 */
export async function listLowerLevelOverrides(): Promise<Record<string, LowerLevelOverrides>> {
  return collectLowerLevel(config => config.skill_overrides, overrides => overrides.skills);
}

/** For each pack id, the projects and issues that set its pack toggle (either way). */
export async function listLowerLevelPackOverrides(): Promise<Record<string, LowerLevelOverrides>> {
  return collectLowerLevel(config => config.skill_pack_overrides, overrides => overrides.packs);
}

// ── writes ───────────────────────────────────────────────────────────────

export function parseSkillOverrideUpdate(body: unknown): SkillOverrideUpdate | PackOverrideUpdate {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SkillOverrideError('bad-request', 'request body must be an object');
  }
  const { level, skill, pack, enabled, projectKey, issueId } = body as Record<string, unknown>;
  if (level !== 'global' && level !== 'project' && level !== 'issue') {
    throw new SkillOverrideError('bad-request', 'level must be global, project, or issue');
  }
  const hasSkill = typeof skill === 'string' && skill.trim() !== '';
  const hasPack = typeof pack === 'string' && pack.trim() !== '';
  if (hasSkill === hasPack || (skill !== undefined && !hasSkill) || (pack !== undefined && !hasPack)) {
    throw new SkillOverrideError('bad-request', 'provide exactly one of skill or pack');
  }
  if (enabled !== true && enabled !== false && enabled !== null) {
    throw new SkillOverrideError('bad-request', 'enabled must be true, false, or null');
  }
  if (level === 'project' && (typeof projectKey !== 'string' || projectKey === '')) {
    throw new SkillOverrideError('bad-request', 'projectKey is required for level project');
  }
  if (level === 'issue' && (typeof issueId !== 'string' || issueId === '')) {
    throw new SkillOverrideError('bad-request', 'issueId is required for level issue');
  }
  return {
    level,
    ...(hasPack ? { pack: (pack as string).trim() } : { skill: (skill as string).trim() }),
    enabled,
    ...(level === 'project' ? { projectKey: projectKey as string } : {}),
    ...(level === 'issue' ? { issueId: (issueId as string).toUpperCase() } : {}),
  };
}

/** PD-7: a `pack/skill` id must name a skill in a registered, cached pack's manifest. */
async function packSkillEntry(id: string): Promise<{ optIn: boolean }> {
  const slash = id.indexOf('/');
  const packId = id.slice(0, slash);
  const name = id.slice(slash + 1);
  const pack = (await listPackCatalog()).find(entry => entry.id === packId);
  if (!pack) throw new SkillOverrideError('unknown-skill', `unknown skill: ${id}`);
  if (!pack.manifest) {
    throw new SkillOverrideError('bad-request', `pack ${packId} is not cached; run pan skills pack sync ${packId}`);
  }
  const skill = pack.manifest.skills.find(entry => entry.name === name);
  if (!skill) throw new SkillOverrideError('unknown-skill', `unknown skill: ${id}`);
  return { optIn: skill.optIn };
}

async function assertInCatalog(skill: string, projectRoot?: string): Promise<void> {
  if (isPackSkillId(skill)) {
    await packSkillEntry(skill);
    return;
  }
  const catalog = await listSkillCatalog(projectRoot ? { projectRoot } : {});
  if (!catalog.some(entry => entry.name === skill)) {
    throw new SkillOverrideError('unknown-skill', `unknown skill: ${skill}`);
  }
}

/** Delete a key and prune the maps above it that became empty. */
function deletePruning(doc: Document, path: string[]): void {
  doc.deleteIn(path);
  for (let depth = path.length - 1; depth > 0; depth--) {
    const parent = doc.getIn(path.slice(0, depth));
    if (isMap(parent) && parent.items.length === 0) doc.deleteIn(path.slice(0, depth));
  }
}

async function setGlobal(skill: string, enabled: boolean | null): Promise<SkillOverrideWriteResult> {
  const packSkill = isPackSkillId(skill) && enabled !== null ? await packSkillEntry(skill) : null;
  return runSettingsWriteSerialized(async () => {
    const path = getGlobalConfigPath();
    const doc = parseDocument(await readTextOrEmpty(path));
    if (doc.errors.length > 0) {
      throw new SkillOverrideError('bad-request', `cannot parse ${path}: ${doc.errors[0]?.message ?? 'invalid YAML'}`);
    }
    // Native skills: global is two-state; "on" is the default, so it is stored as no key.
    // Pack skills (PD-6): store only the deviation from the resting state, which is
    // off for opt-in skills and the global pack toggle otherwise.
    let value: boolean | null = enabled === false ? false : null;
    if (packSkill) {
      const resting = packSkill.optIn ? false : doc.getIn(['skills', 'pack_overrides', skill.slice(0, skill.indexOf('/'))]) === true;
      value = enabled === resting ? null : enabled;
    }
    const keyPath = ['skills', 'overrides', skill];
    if (value === null) {
      if (!doc.hasIn(keyPath)) return {};
      deletePruning(doc, keyPath);
    } else {
      if (!packSkill) await assertInCatalog(skill);
      doc.setIn(keyPath, value);
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, doc.toString(), 'utf8');
    return {};
  });
}

async function setProject(projectKey: string, skill: string, enabled: boolean | null): Promise<SkillOverrideWriteResult> {
  const project = await findProject(projectKey);
  if (!project) throw new SkillOverrideError('unknown-project', `unknown project: ${projectKey}`);
  if (enabled === null && !(skill in booleanEntries(project.skill_overrides))) return {};
  if (enabled !== null) await assertInCatalog(skill, project.path);

  await updateProjectsConfigAsync(config => {
    const current = config.projects[projectKey] as ProjectWithSkillOverrides | undefined;
    if (!current) throw new SkillOverrideError('unknown-project', `unknown project: ${projectKey}`);
    const overrides = { ...(current.skill_overrides ?? {}) };
    const had = Object.prototype.hasOwnProperty.call(overrides, skill);
    if (enabled === null) {
      if (!had) return { config, result: undefined, changed: false };
      delete overrides[skill];
    } else {
      if (had && overrides[skill] === enabled) return { config, result: undefined, changed: false };
      overrides[skill] = enabled;
    }
    if (Object.keys(overrides).length === 0) delete current.skill_overrides;
    else current.skill_overrides = overrides;
    return { config, result: undefined, changed: true };
  });
  return {};
}

async function isTracked(cwd: string, path: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['ls-files', '--error-unmatch', '--', path], { cwd });
    return true;
  } catch {
    return false;
  }
}

function sortedEntries(map: Record<string, boolean>): Record<string, boolean> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
}

function renderIssueFile(issueId: string, skills: Record<string, boolean>, packs: Record<string, boolean>): string {
  const body = {
    issue: issueId,
    ...(Object.keys(skills).length > 0 ? { skills: sortedEntries(skills) } : {}),
    ...(Object.keys(packs).length > 0 ? { packs: sortedEntries(packs) } : {}),
  };
  return ISSUE_FILE_HEADER + stringifyYaml(body, { indent: 2 });
}

/** Write (or delete, when both maps are empty) the issue file and commit it through the plan-artifact door. */
async function persistIssueFile(
  planHome: string,
  path: string,
  issue: string,
  overrides: IssueOverrides,
): Promise<SkillOverrideWriteResult> {
  if (Object.keys(overrides.skills).length === 0 && Object.keys(overrides.packs).length === 0) {
    await rm(path, { force: true });
    // A file that was never committed leaves nothing to record.
    if (!(await isTracked(planHome, path))) return { committed: false, reason: 'nothing to commit' };
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderIssueFile(issue, overrides.skills, overrides.packs), 'utf8');
  }

  const commit = await commitPlanArtifacts({
    cwd: planHome,
    paths: [path],
    message: `chore(workspace): skill overrides for ${issue}`,
  });
  if (!commit.committed) {
    // A clean tree means the same content was already committed.
    if (commit.reason === 'nothing to commit') return { committed: false, reason: commit.reason };
    throw new SkillOverrideError('bad-request', `could not commit ${path}: ${commit.reason}`);
  }
  const push = await pushPlanArtifacts(planHome);
  return push.pushed
    ? { committed: true, sha: commit.sha, pushed: true }
    : { committed: true, sha: commit.sha, pushed: false, reason: push.reason };
}

async function setIssue(issueId: string, skill: string, enabled: boolean | null): Promise<SkillOverrideWriteResult> {
  const issue = issueId.toUpperCase();
  const owner = await projectForIssue(issue);
  if (!owner) throw new SkillOverrideError('unknown-issue', `no registered project owns issue ${issue}`);
  const planHome = planHomeFor(owner.project);
  const path = issueSkillOverridesPath(planHome, issue);
  const overrides = await readIssueFile(path);
  const { skills } = overrides;
  const had = Object.prototype.hasOwnProperty.call(skills, skill);

  if (enabled === null) {
    if (!had) return {};
    delete skills[skill];
  } else {
    await assertInCatalog(skill, owner.project.path);
    if (had && skills[skill] === enabled) return {};
    skills[skill] = enabled;
  }
  return persistIssueFile(planHome, path, issue, overrides);
}

async function setPackOverride(update: PackOverrideUpdate): Promise<SkillOverrideWriteResult> {
  const { pack, enabled } = update;
  if (!(await listPacks()).some(entry => entry.id === pack)) {
    throw new SkillOverrideError('unknown-pack', `unknown pack: ${pack}`);
  }
  switch (update.level) {
    case 'global':
      // Global is two-state: packs are off by default, so "off" is stored as no key.
      return runSettingsWriteSerialized(async () => {
        const path = getGlobalConfigPath();
        const doc = parseDocument(await readTextOrEmpty(path));
        if (doc.errors.length > 0) {
          throw new SkillOverrideError('bad-request', `cannot parse ${path}: ${doc.errors[0]?.message ?? 'invalid YAML'}`);
        }
        const keyPath = ['skills', 'pack_overrides', pack];
        if (enabled === true) {
          if (doc.getIn(keyPath) === true) return {};
          doc.setIn(keyPath, true);
        } else {
          if (!doc.hasIn(keyPath)) return {};
          deletePruning(doc, keyPath);
        }
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, doc.toString(), 'utf8');
        return {};
      });
    case 'project': {
      const projectKey = update.projectKey;
      if (!projectKey) throw new SkillOverrideError('bad-request', 'projectKey is required for level project');
      if (!(await findProject(projectKey))) throw new SkillOverrideError('unknown-project', `unknown project: ${projectKey}`);
      await updateProjectsConfigAsync(config => {
        const current = config.projects[projectKey] as ProjectWithSkillOverrides | undefined;
        if (!current) throw new SkillOverrideError('unknown-project', `unknown project: ${projectKey}`);
        const toggles = { ...(current.skill_pack_overrides ?? {}) };
        const had = Object.prototype.hasOwnProperty.call(toggles, pack);
        if (enabled === null) {
          if (!had) return { config, result: undefined, changed: false };
          delete toggles[pack];
        } else {
          if (had && toggles[pack] === enabled) return { config, result: undefined, changed: false };
          toggles[pack] = enabled;
        }
        if (Object.keys(toggles).length === 0) delete current.skill_pack_overrides;
        else current.skill_pack_overrides = toggles;
        return { config, result: undefined, changed: true };
      });
      return {};
    }
    case 'issue': {
      if (!update.issueId) throw new SkillOverrideError('bad-request', 'issueId is required for level issue');
      const issue = update.issueId.toUpperCase();
      const owner = await projectForIssue(issue);
      if (!owner) throw new SkillOverrideError('unknown-issue', `no registered project owns issue ${issue}`);
      const planHome = planHomeFor(owner.project);
      const path = issueSkillOverridesPath(planHome, issue);
      const overrides = await readIssueFile(path);
      const had = Object.prototype.hasOwnProperty.call(overrides.packs, pack);
      if (enabled === null) {
        if (!had) return {};
        delete overrides.packs[pack];
      } else {
        if (had && overrides.packs[pack] === enabled) return {};
        overrides.packs[pack] = enabled;
      }
      return persistIssueFile(planHome, path, issue, overrides);
    }
  }
}

export async function setSkillOverride(update: SkillOverrideUpdate | PackOverrideUpdate): Promise<SkillOverrideWriteResult> {
  if ('pack' in update) return setPackOverride(update);
  if (isCoreSkill(update.skill)) {
    throw new SkillOverrideError('core-skill', `core skill cannot be overridden: ${update.skill}`);
  }
  switch (update.level) {
    case 'global':
      return setGlobal(update.skill, update.enabled);
    case 'project':
      if (!update.projectKey) throw new SkillOverrideError('bad-request', 'projectKey is required for level project');
      return setProject(update.projectKey, update.skill, update.enabled);
    case 'issue':
      if (!update.issueId) throw new SkillOverrideError('bad-request', 'issueId is required for level issue');
      return setIssue(update.issueId, update.skill, update.enabled);
  }
}
