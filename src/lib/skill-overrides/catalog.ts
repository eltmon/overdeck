/**
 * Skill catalog (PAN-3942): the skill names Overdeck can see, for override
 * listing and write validation. A skill is a directory holding a SKILL.md.
 */
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface SkillCatalogEntry {
  name: string;
  description: string;
  /** True when the skill exists only under `<projectRoot>/.pan/skills` (a "project skill"). */
  projectSkill?: boolean;
}

/** First line of the SKILL.md frontmatter `description`, or '' when absent or unparseable. */
export function parseSkillDescription(content: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return '';
  try {
    const frontmatter: unknown = parseYaml(match[1]);
    if (!frontmatter || typeof frontmatter !== 'object') return '';
    const description = (frontmatter as Record<string, unknown>)['description'];
    if (typeof description !== 'string') return '';
    return description.trim().split('\n')[0]?.trim() ?? '';
  } catch {
    return '';
  }
}

async function readRoot(root: string, projectSkill: boolean): Promise<SkillCatalogEntry[]> {
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
    const entry: SkillCatalogEntry = { name: dirent.name, description: parseSkillDescription(content) };
    if (projectSkill) entry.projectSkill = true;
    entries.push(entry);
  }
  return entries;
}

export async function listSkillCatalog(
  opts: { projectRoot?: string; home?: string } = {},
): Promise<SkillCatalogEntry[]> {
  const home = opts.home ?? homedir();
  const roots: Array<[string, boolean]> = [
    [join(home, '.overdeck', 'skills'), false],
    [join(home, '.claude', 'skills'), false],
    [join(home, '.agents', 'skills'), false],
    ...(opts.projectRoot ? [[join(opts.projectRoot, '.pan', 'skills'), true] as [string, boolean]] : []),
  ];
  const byName = new Map<string, SkillCatalogEntry>();
  for (const [root, projectSkill] of roots) {
    for (const entry of await readRoot(root, projectSkill)) {
      if (!byName.has(entry.name)) byName.set(entry.name, entry);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
