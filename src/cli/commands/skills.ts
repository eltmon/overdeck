import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { SKILLS_DIR } from '../../lib/paths.js';

export interface SkillMeta {
  name: string;
  description: string;
  path: string;
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontmatter = match[1];
  const name = frontmatter.match(/name:\s*(.+)/)?.[1]?.trim();
  const description = frontmatter.match(/description:\s*(.+)/)?.[1]?.trim();

  return { name, description };
}

export function listSkills(): SkillMeta[] {
  if (!existsSync(SKILLS_DIR)) return [];

  const skills: SkillMeta[] = [];
  const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    const skillFile = join(SKILLS_DIR, dir.name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;

    const content = readFileSync(skillFile, 'utf8');
    const { name, description } = parseSkillFrontmatter(content);

    skills.push({
      name: name || dir.name,
      description: description || '(no description)',
      path: skillFile,
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function skillsCommand(options: { json?: boolean }): Promise<void> {
  const skills = listSkills();

  if (options.json) {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  console.log(chalk.bold(`\nOverdeck Skills (${skills.length})\n`));

  if (skills.length === 0) {
    console.log(chalk.yellow('No skills found.'));
    console.log(chalk.dim('Skills should be in ~/.panopticon/skills/<name>/SKILL.md'));
    return;
  }

  for (const skill of skills) {
    console.log(chalk.cyan(skill.name));
    console.log(chalk.dim(`  ${skill.description}`));
  }

  console.log(`\n${chalk.dim('Run "pan sync" to sync skills to Claude Code')}`);
}
