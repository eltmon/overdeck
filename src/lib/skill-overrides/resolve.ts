/**
 * Per-skill on/off resolution (PAN-3942).
 *
 * Pure, no I/O. A skill's effective state is the narrowest defined override:
 * issue > project > global > default (on). Core workflow skills that the
 * pipeline depends on are always on and ignore every override.
 */
import type { SkillCatalogEntry } from './catalog.js';

export const CORE_SKILLS: readonly string[] = [
  'pan', 'pan-done', 'pan-flywheel', 'pan-foreman', 'pan-plan', 'pan-start',
  'pan-task', 'pan-tell', 'pan-worker', 'work-complete', 'write-xbrief',
];

export type SkillOverrideLevel = 'global' | 'project' | 'issue';
export type SkillStateSource = 'core' | SkillOverrideLevel | 'default';
export type SkillOverrideMap = Readonly<Record<string, boolean>>;

export interface SkillOverrideLayers {
  global: SkillOverrideMap;
  project?: SkillOverrideMap;
  issue?: SkillOverrideMap;
}

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
  for (const level of ['issue', 'project', 'global'] as const) {
    const value = overrideValue(layers[level], name);
    if (value !== null) return { enabled: value, source: level };
  }
  return { enabled: true, source: 'default' };
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
 * copy still hides.
 */
export function disabledSkillNames(layers: SkillOverrideLayers): string[] {
  const names = new Set([
    ...Object.keys(layers.global),
    ...Object.keys(layers.project ?? {}),
    ...Object.keys(layers.issue ?? {}),
  ]);
  return [...names]
    .filter(name => !resolveOne(name, layers).enabled)
    .sort((a, b) => a.localeCompare(b));
}
