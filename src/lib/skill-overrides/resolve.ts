/**
 * Per-skill on/off resolution (PAN-3942).
 *
 * Pure, no I/O. A skill's effective state is the narrowest defined override:
 * conversation > issue > project > global > default (on). Core workflow skills that the
 * pipeline depends on are always on and ignore every override.
 *
 * Pack skills (PAN-4334) have ids `pack/skill` and resolve differently: at
 * each level a per-skill value beats that level's pack toggle, and with no
 * value anywhere they are off. They are never hidden by name.
 */
import type { SkillCatalogEntry } from './catalog.js';

export const CORE_SKILLS: readonly string[] = [
  'pan', 'pan-done', 'pan-flywheel', 'pan-foreman', 'pan-plan', 'pan-start',
  'pan-task', 'pan-tell', 'pan-worker', 'work-complete', 'write-xbrief',
];

export type SkillOverrideLevel = 'global' | 'project' | 'issue';
export type SkillStateSource = 'core' | SkillOverrideLevel | 'conversation' | 'default';
export type SkillOverrideMap = Readonly<Record<string, boolean>>;

export interface PackToggleLayers {
  global?: SkillOverrideMap;
  project?: SkillOverrideMap;
  issue?: SkillOverrideMap;
}

export interface SkillOverrideLayers {
  global: SkillOverrideMap;
  project?: SkillOverrideMap;
  issue?: SkillOverrideMap;
  /** Per-conversation values (PAN-4486); narrowest of all, set at creation only. */
  conversation?: SkillOverrideMap;
  /** Pack toggles keyed by pack id (PAN-4334). */
  packs?: PackToggleLayers;
}

export type PackSkillSource = SkillOverrideLevel | 'conversation' | 'issue-pack' | 'project-pack' | 'global-pack' | 'default';

export interface SkillState {
  name: string;
  description: string;
  core: boolean;
  /** Exists only under the project's `.pan/skills`; never shown on the global page. */
  projectSkill: boolean;
  global: boolean | null;
  project: boolean | null;
  issue: boolean | null;
  enabled: boolean;
  source: SkillStateSource;
}

const CORE_SKILL_SET = new Set(CORE_SKILLS);

export function isCoreSkill(name: string): boolean {
  return CORE_SKILL_SET.has(name);
}

function overrideValue(map: SkillOverrideMap | undefined, name: string): boolean | null {
  if (!map || !Object.prototype.hasOwnProperty.call(map, name)) return null;
  const value = map[name];
  return typeof value === 'boolean' ? value : null;
}

function resolveOne(name: string, layers: SkillOverrideLayers): { enabled: boolean; source: SkillStateSource } {
  if (isCoreSkill(name)) return { enabled: true, source: 'core' };
  const conv = overrideValue(layers.conversation, name);
  if (conv !== null) return { enabled: conv, source: 'conversation' };
  for (const level of ['issue', 'project', 'global'] as const) {
    const value = overrideValue(layers[level], name);
    if (value !== null) return { enabled: value, source: level };
  }
  return { enabled: true, source: 'default' };
}

const LEVELS_NARROWEST_FIRST = ['issue', 'project', 'global'] as const;

export function isPackSkillId(id: string): boolean {
  return id.includes('/');
}

/**
 * §4.3: narrowest level first; at each level a per-skill value beats the pack
 * toggle; the first level with either wins; otherwise off. Opt-in skills
 * ignore pack toggles. `skip` ignores that level's per-skill value only, so
 * the UI can show what "inherit" would resolve to.
 */
export function resolvePackSkill(
  id: string,
  optIn: boolean,
  layers: SkillOverrideLayers,
  skip?: SkillOverrideLevel,
): { enabled: boolean; source: PackSkillSource } {
  const pack = id.slice(0, id.indexOf('/'));
  const conv = overrideValue(layers.conversation, id);
  if (conv !== null) return { enabled: conv, source: 'conversation' };
  for (const level of LEVELS_NARROWEST_FIRST) {
    const value = level === skip ? null : overrideValue(layers[level], id);
    if (value !== null) return { enabled: value, source: level };
    if (optIn) continue;
    const toggle = overrideValue(layers.packs?.[level], pack);
    if (toggle !== null) return { enabled: toggle, source: `${level}-pack` };
  }
  return { enabled: false, source: 'default' };
}

/** The narrowest defined pack toggle (skipping `skip`), else off. */
export function resolvePackToggle(
  pack: string,
  layers: SkillOverrideLayers,
  skip?: SkillOverrideLevel,
): { enabled: boolean; source: SkillOverrideLevel | 'default' } {
  for (const level of LEVELS_NARROWEST_FIRST) {
    if (level === skip) continue;
    const toggle = overrideValue(layers.packs?.[level], pack);
    if (toggle !== null) return { enabled: toggle, source: level };
  }
  return { enabled: false, source: 'default' };
}

export function resolveSkillStates(
  catalog: readonly SkillCatalogEntry[],
  layers: SkillOverrideLayers,
): SkillState[] {
  return catalog
    .map((entry): SkillState => ({
      name: entry.name,
      description: entry.description,
      core: isCoreSkill(entry.name),
      projectSkill: entry.projectSkill === true,
      global: overrideValue(layers.global, entry.name),
      project: overrideValue(layers.project, entry.name),
      issue: overrideValue(layers.issue, entry.name),
      ...resolveOne(entry.name, layers),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every non-core skill name whose resolved value is off, sorted. Names absent
 * from any catalog are included, so a skill that exists only in a workspace
 * copy still hides. Pack skill ids are never included: pack skills are
 * filtered when the mount is built.
 */
export function disabledSkillNames(layers: SkillOverrideLayers): string[] {
  const names = new Set([
    ...Object.keys(layers.global),
    ...Object.keys(layers.project ?? {}),
    ...Object.keys(layers.issue ?? {}),
    ...Object.keys(layers.conversation ?? {}),
  ]);
  return [...names]
    .filter(name => !isPackSkillId(name) && !resolveOne(name, layers).enabled)
    .sort((a, b) => a.localeCompare(b));
}
