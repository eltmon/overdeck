/** PAN-4499: turn `pan handoff --skill/--pack` requests into conversation skill-layer entries. */
import type { PackCatalogEntry, SkillCatalogEntry } from './catalog.js';
import { listPackCatalog, listSkillCatalog } from './catalog.js';
import { isCoreSkill, isPackSkillId } from './resolve.js';

export class ConversationSkillFlagError extends Error {}

const SKILL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
const PACK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A request-body list: absent → []; otherwise an array of id-shaped strings, else throws `Invalid <field>`. */
export function parseSkillFlagList(raw: unknown, field: 'skills' | 'packs'): string[] {
  if (raw === undefined) return [];
  const label = field === 'skills' ? 'Invalid skills' : 'Invalid packs';
  if (!Array.isArray(raw)) throw new ConversationSkillFlagError(label);
  const pattern = field === 'skills' ? SKILL_ID_PATTERN : PACK_ID_PATTERN;
  for (const value of raw) {
    if (typeof value !== 'string' || !pattern.test(value)) throw new ConversationSkillFlagError(label);
  }
  return raw as string[];
}

function knownSkillNames(catalog: { skills: readonly SkillCatalogEntry[]; packs: readonly PackCatalogEntry[] }): string[] {
  const native = catalog.skills.map(entry => entry.name);
  const packSkills = catalog.packs
    .filter(pack => pack.manifest !== null)
    .flatMap(pack => pack.manifest!.skills.map(skill => `${pack.id}/${skill.name}`));
  return [...native, ...packSkills].sort();
}

function unknownSkillError(name: string, catalog: { skills: readonly SkillCatalogEntry[]; packs: readonly PackCatalogEntry[] }): ConversationSkillFlagError {
  return new ConversationSkillFlagError(`unknown skill: ${name}. Known skills: ${knownSkillNames(catalog).join(', ')}`);
}

function addPackSkill(
  entries: Record<string, boolean>,
  packId: string,
  skillName: string,
  catalog: { skills: readonly SkillCatalogEntry[]; packs: readonly PackCatalogEntry[] },
): void {
  const pack = catalog.packs.find(entry => entry.id === packId);
  if (!pack) {
    const ids = catalog.packs.map(entry => entry.id);
    throw new ConversationSkillFlagError(`unknown pack: ${packId}. Known packs: ${ids.join(', ') || '(none registered)'}`);
  }
  if (pack.manifest === null) {
    throw new ConversationSkillFlagError(`pack ${packId} is not cached; run pan skills pack sync ${packId}`);
  }
  const skill = pack.manifest.skills.find(entry => entry.name === skillName);
  if (!skill) throw unknownSkillError(`${packId}/${skillName}`, catalog);
  entries[`${packId}/${skillName}`] = true;
}

/** Pure: the entries the flags add. Throws ConversationSkillFlagError naming the bad value and the known list. */
export function expandConversationSkillFlags(
  flags: { skills: readonly string[]; packs: readonly string[] },
  catalog: { skills: readonly SkillCatalogEntry[]; packs: readonly PackCatalogEntry[] },
): Record<string, boolean> {
  const entries: Record<string, boolean> = {};
  for (const packId of flags.packs) {
    const pack = catalog.packs.find(entry => entry.id === packId);
    if (!pack) {
      const ids = catalog.packs.map(entry => entry.id);
      throw new ConversationSkillFlagError(`unknown pack: ${packId}. Known packs: ${ids.join(', ') || '(none registered)'}`);
    }
    if (pack.manifest === null) {
      throw new ConversationSkillFlagError(`pack ${packId} is not cached; run pan skills pack sync ${packId}`);
    }
    for (const skill of pack.manifest.skills) {
      if (!skill.optIn) entries[`${packId}/${skill.name}`] = true;
    }
  }
  for (const name of flags.skills) {
    if (isPackSkillId(name)) {
      const slash = name.indexOf('/');
      addPackSkill(entries, name.slice(0, slash), name.slice(slash + 1), catalog);
      continue;
    }
    if (isCoreSkill(name)) continue;
    if (!catalog.skills.some(entry => entry.name === name)) throw unknownSkillError(name, catalog);
    entries[name] = true;
  }
  return entries;
}

/** Loads listSkillCatalog({ projectRoot }) and listPackCatalog(), then expands. */
export async function resolveConversationSkillFlags(
  flags: { skills: readonly string[]; packs: readonly string[] },
  projectRoot?: string,
): Promise<Record<string, boolean>> {
  const [skills, packs] = await Promise.all([listSkillCatalog({ projectRoot }), listPackCatalog()]);
  return expandConversationSkillFlags(flags, { skills, packs });
}
