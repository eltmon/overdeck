/**
 * Skill pack groups (PAN-5464): a named list of pack ids that one command expands.
 *
 * A group is an alias, not a pack: it has no registry entry, no mount and no toggle of its own.
 * Built-in groups live in KNOWN_PACK_GROUPS; operators add or replace groups in
 * `~/.overdeck/config.yaml` → `skills.pack_groups.<name>: [<pack id>, …]`. A config group with a
 * built-in name replaces the built-in.
 *
 * Server-reachable: every fs call is async.
 */
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { getGlobalConfigPath } from '../config-yaml/load.js';
import { PACK_ID_PATTERN } from './sources.js';

export const KNOWN_PACK_GROUPS: Readonly<Record<string, readonly string[]>> = {
  video: ['remotion', 'hyperframes', 'openmontage', 'video-use'],
};

export class PackGroupError extends Error {}

export interface PackGroup {
  name: string;
  packs: readonly string[];
  source: 'built-in' | 'config';
}

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

/** `skills.pack_groups` from config.yaml; entries that are not arrays of pack ids are dropped silently. */
async function readConfigGroups(): Promise<Map<string, readonly string[]>> {
  const groups = new Map<string, readonly string[]>();
  let config: unknown;
  try {
    config = parseYaml(await readTextOrEmpty(getGlobalConfigPath()));
  } catch {
    return groups;
  }
  const raw = (config as { skills?: { pack_groups?: unknown } } | null)?.skills?.pack_groups;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return groups;
  for (const [name, packs] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(packs)) continue;
    if (!packs.every((id): id is string => typeof id === 'string' && PACK_ID_PATTERN.test(id))) continue;
    groups.set(name, packs);
  }
  return groups;
}

/** Built-in groups overridden by config groups of the same name, plus config-only groups, sorted by name. */
export async function listPackGroups(): Promise<PackGroup[]> {
  const config = await readConfigGroups();
  const groups = new Map<string, PackGroup>();
  for (const [name, packs] of Object.entries(KNOWN_PACK_GROUPS)) groups.set(name, { name, packs, source: 'built-in' });
  for (const [name, packs] of config) groups.set(name, { name, packs, source: 'config' });
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Member pack ids of a group. Config groups (skills.pack_groups) override built-ins by name. Unknown name → PackGroupError naming the known groups. */
export async function resolvePackGroup(name: string): Promise<readonly string[]> {
  const groups = await listPackGroups();
  const group = groups.find((candidate) => candidate.name === name);
  if (!group) {
    throw new PackGroupError(`unknown pack group: ${name} (known: ${groups.map((g) => g.name).join(', ')})`);
  }
  return group.packs;
}
