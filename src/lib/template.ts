import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { CLAUDE_MD_TEMPLATES } from './paths.js';

/**
 * Parse a SKILL.md file and return its frontmatter fields.
 * Returns null if the file cannot be parsed.
 */
function parseSkillFrontmatter(skillPath: string): { name?: string; audience?: string; description?: string } | null {
  try {
    const content = readFileSync(skillPath, 'utf-8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const fm = fmMatch[1];
    const get = (key: string) => fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim();
    return {
      name: get('name'),
      audience: get('audience'),
      description: get('description')?.replace(/^["'>]/, '').replace(/["']$/, '').trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Generate the `## Available Skills (agent audience)` section for CLAUDE.md.
 * Lists every skill in the skills/ directory with audience 'agent' or 'both'.
 * Includes name, description, and a relative path link to the SKILL.md.
 *
 * @param projectPath - Absolute path to the project root (contains skills/)
 * @returns Markdown section string, or empty string if no agent skills found
 */
export function generateAgentSkillsSection(projectPath: string): string {
  const skillsDir = join(projectPath, 'skills');
  if (!existsSync(skillsDir)) return '';

  let entries: Array<{ name: string; description: string; relPath: string }> = [];

  try {
    const dirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== '_template')
      .map(d => d.name)
      .sort();

    for (const dir of dirs) {
      const skillPath = join(skillsDir, dir, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      const fm = parseSkillFrontmatter(skillPath);
      if (!fm) continue;
      if (fm.audience !== 'agent' && fm.audience !== 'both') continue;

      entries.push({
        name: fm.name || dir,
        description: fm.description || '',
        relPath: `skills/${dir}/SKILL.md`,
      });
    }
  } catch {
    return '';
  }

  if (entries.length === 0) return '';

  const lines = [
    '## Available Skills (agent audience)',
    '',
    'These skills are available for autonomous agent use. Invoke them with `/skill-name` or read them directly.',
    '',
    '| Skill | Description |',
    '|-------|-------------|',
    ...entries.map(e => `| [${e.name}](${e.relPath}) | ${e.description} |`),
    '',
  ];

  return lines.join('\n');
}

export interface TemplateVariables {
  FEATURE_FOLDER: string;
  BRANCH_NAME: string;
  ISSUE_ID: string;
  WORKSPACE_PATH: string;
  FRONTEND_URL?: string;
  API_URL?: string;
  PROJECT_NAME?: string;
  PROJECT_DOMAIN?: string;
  [key: string]: string | undefined;
}

function loadSection(path: string, variables: TemplateVariables): string {
  let result = readFileSync(path, 'utf8');
  for (const [key, value] of Object.entries(variables)) {
    if (value !== undefined) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }
  }
  return result;
}

export function generateClaudeMd(
  projectPath: string,
  variables: TemplateVariables
): string {
  const sections: string[] = [];

  const defaultOrder = [
    'workspace-info.md',
    'beads.md',
    'commands-skills.md',
    'warnings.md',
  ];

  for (const section of defaultOrder) {
    const sectionPath = join(CLAUDE_MD_TEMPLATES, section);
    if (existsSync(sectionPath)) {
      sections.push(loadSection(sectionPath, variables));
    }
  }

  const projectSections = join(projectPath, '.panopticon', 'claude-md', 'sections');
  if (existsSync(projectSections)) {
    const projectFiles = readdirSync(projectSections)
      .filter((f) => f.endsWith('.md'))
      .sort();

    for (const file of projectFiles) {
      sections.push(loadSection(join(projectSections, file), variables));
    }
  }

  if (sections.length === 0) {
    return `# Workspace: ${variables.FEATURE_FOLDER}

**Issue:** ${variables.ISSUE_ID}
**Branch:** ${variables.BRANCH_NAME}
**Path:** ${variables.WORKSPACE_PATH}

## Getting Started

This workspace was created by Panopticon. Use \`bd\` commands to track your work.
`;
  }

  return sections.join('\n\n---\n\n');
}
